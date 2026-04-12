#! /usr/bin/python3
# -*- coding: utf-8 -*-
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_

from bot import LOGGER, admins, save_config, user_p, admin_p, owner_p, _open, webapp as webapp_config
from bot.func_helper.emby import emby
from bot.sql_helper import Session
from bot.sql_helper.sql_emby import (
    Emby,
    sql_add_emby,
    sql_count_emby,
    sql_get_emby,
    sql_update_emby,
)
from .webapp_security import require_admin, require_owner

router = APIRouter()

WEBAPP_INTEGRATED_COMMANDS = {
    "start",
    "myinfo",
    "count",
    "renew",
    "rmemby",
    "prouser",
    "revuser",
    "proadmin",
    "revadmin",
    "auditip",
    "auditdevice",
    "auditclient",
}


class OpenUserRequest(BaseModel):
    tg: int
    name: str
    days: int = Field(default=30, ge=1, le=3650)


class QueryDaysRequest(BaseModel):
    query: str
    days: float


class QueryBoolRequest(BaseModel):
    query: str
    enable: bool = True


class ToggleAdminRequest(BaseModel):
    tg: int
    enable: bool


class CheckinSettingsRequest(BaseModel):
    enabled: bool
    level: str = Field(default="d", pattern="^[abcd]$")


class BannerSettingsRequest(BaseModel):
    enabled: bool
    title: str = ""
    subtitle: str = ""
    image_url: Optional[str] = None
    link_url: Optional[str] = None


def _command_to_dict(command_obj):
    cmd = getattr(command_obj, "command", "")
    desc = getattr(command_obj, "description", "")
    return {
        "command": cmd,
        "description": desc,
        "web_integrated": cmd in WEBAPP_INTEGRATED_COMMANDS,
    }


@router.get("/overview")
async def admin_overview(user=Depends(require_admin)):
    tg_count, emby_count, whitelist_count = sql_count_emby()
    playing_count = await emby.get_current_playing_count()
    if not isinstance(playing_count, int) or playing_count < 0:
        playing_count = 0
    return {
        "code": 200,
        "data": {
            "operator": user["tg_id"],
            "tg_count": tg_count or 0,
            "emby_count": emby_count or 0,
            "whitelist_count": whitelist_count or 0,
            "playing_count": playing_count,
        },
    }


@router.get("/commands")
async def command_catalog(user=Depends(require_admin)):
    data = {
        "user": [_command_to_dict(i) for i in user_p],
        "admin": [_command_to_dict(i) for i in admin_p],
        "owner": [_command_to_dict(i) for i in owner_p],
    }
    return {"code": 200, "data": data}


@router.get("/users")
async def list_users(
    query: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    user=Depends(require_admin),
):
    _ = user
    with Session() as session:
        q = session.query(Emby)
        if query:
            if query.isdigit():
                q = q.filter(
                    or_(
                        Emby.tg == int(query),
                        Emby.name.like(f"%{query}%"),
                        Emby.embyid.like(f"%{query}%"),
                    )
                )
            else:
                q = q.filter(or_(Emby.name.like(f"%{query}%"), Emby.embyid.like(f"%{query}%")))

        total = q.with_entities(func.count(Emby.tg)).scalar() or 0
        rows = (
            q.order_by(Emby.tg.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        items = [
            {
                "tg": row.tg,
                "name": row.name,
                "embyid": row.embyid,
                "lv": row.lv,
                "created_at": row.cr,
                "expires_at": row.ex,
                "points": row.iv,
                "register_credits": row.us,
            }
            for row in rows
        ]
        return {"code": 200, "data": {"total": total, "page": page, "page_size": page_size, "items": items}}


@router.post("/users/open")
async def open_user_account(body: OpenUserRequest, user=Depends(require_admin)):
    old = sql_get_emby(body.tg)
    if not old:
        sql_add_emby(body.tg)
        old = sql_get_emby(body.tg)
    if old and old.embyid:
        raise HTTPException(status_code=400, detail="user_already_has_emby")

    result = await emby.emby_create(name=body.name, days=body.days)
    if not result:
        raise HTTPException(status_code=500, detail="emby_create_failed")
    embyid, pwd, ex = result
    ok = sql_update_emby(Emby.tg == body.tg, name=body.name, embyid=embyid, pwd=pwd, pwd2=pwd, cr=datetime.now(), ex=ex, lv="b")
    if not ok:
        raise HTTPException(status_code=500, detail="db_update_failed")
    LOGGER.info(f"WebApp admin {user['tg_id']} opened account for tg={body.tg}, name={body.name}")
    return {"code": 200, "data": {"tg": body.tg, "name": body.name, "embyid": embyid, "expires_at": ex}}


@router.post("/users/renew")
async def renew_user_account(body: QueryDaysRequest, user=Depends(require_admin)):
    record = sql_get_emby(body.query)
    if not record or not record.embyid:
        raise HTTPException(status_code=404, detail="user_not_found")

    now = datetime.now()
    ex_base = record.ex if isinstance(record.ex, datetime) else None
    start_from = ex_base if (ex_base and ex_base > now) else now
    ex_new = start_from + timedelta(days=body.days)
    lv = record.lv
    if ex_new > now:
        lv = "a" if record.lv == "a" else "b"
        changed = await emby.emby_change_policy(emby_id=record.embyid, disable=False)
        if not changed:
            raise HTTPException(status_code=500, detail="emby_policy_update_failed")
    elif record.lv != "a":
        lv = "c"
        changed = await emby.emby_change_policy(emby_id=record.embyid, disable=True)
        if not changed:
            raise HTTPException(status_code=500, detail="emby_policy_update_failed")

    ok = sql_update_emby(Emby.tg == record.tg, ex=ex_new, lv=lv)
    if not ok:
        raise HTTPException(status_code=500, detail="db_update_failed")
    LOGGER.info(f"WebApp admin {user['tg_id']} renewed {record.tg} by {body.days} days")
    return {"code": 200, "data": {"tg": record.tg, "expires_at": ex_new, "lv": lv}}


@router.post("/users/ban")
async def ban_or_unban_user(body: QueryBoolRequest, user=Depends(require_admin)):
    record = sql_get_emby(body.query)
    if not record or not record.embyid:
        raise HTTPException(status_code=404, detail="user_not_found")

    disable = body.enable
    changed = await emby.emby_change_policy(emby_id=record.embyid, disable=disable)
    if not changed:
        raise HTTPException(status_code=500, detail="emby_policy_update_failed")

    new_lv = "c" if disable else ("a" if record.lv == "a" else "b")
    sql_update_emby(Emby.tg == record.tg, lv=new_lv)
    LOGGER.info(f"WebApp admin {user['tg_id']} set ban={disable} for tg={record.tg}")
    return {"code": 200, "data": {"tg": record.tg, "lv": new_lv, "disabled": disable}}


@router.delete("/users/{query}")
async def delete_user_account(query: str, user=Depends(require_admin)):
    record = sql_get_emby(query)
    if not record or not record.embyid:
        raise HTTPException(status_code=404, detail="user_not_found")

    ok = await emby.emby_del(emby_id=record.embyid)
    if not ok:
        raise HTTPException(status_code=500, detail="emby_delete_failed")
    sql_update_emby(Emby.tg == record.tg, lv="d", name=None, embyid=None, cr=None, ex=None)
    LOGGER.info(f"WebApp admin {user['tg_id']} deleted emby for tg={record.tg}")
    return {"code": 200, "data": {"tg": record.tg, "deleted": True}}


@router.post("/users/whitelist")
async def whitelist_user(body: QueryBoolRequest, user=Depends(require_admin)):
    record = sql_get_emby(body.query)
    if not record:
        raise HTTPException(status_code=404, detail="user_not_found")
    new_lv = "a" if body.enable else "b"
    ok = sql_update_emby(Emby.tg == record.tg, lv=new_lv)
    if not ok:
        raise HTTPException(status_code=500, detail="db_update_failed")
    LOGGER.info(f"WebApp admin {user['tg_id']} set whitelist={body.enable} for tg={record.tg}")
    return {"code": 200, "data": {"tg": record.tg, "lv": new_lv}}


@router.post("/admins/toggle")
async def toggle_admin(body: ToggleAdminRequest, user=Depends(require_owner)):
    changed = False
    if body.enable and body.tg not in admins:
        admins.append(body.tg)
        changed = True
    if (not body.enable) and body.tg in admins:
        admins.remove(body.tg)
        changed = True
    if changed:
        save_config()
        LOGGER.info(f"WebApp owner {user['tg_id']} changed admin list for {body.tg} -> {body.enable}")
    return {"code": 200, "data": {"changed": changed, "admins": admins}}


@router.get("/settings/checkin")
async def get_checkin_settings(user=Depends(require_admin)):
    return {
        "code": 200,
        "data": {
            "enabled": bool(_open.checkin),
            "level": _open.checkin_lv or "d",
            "reward_range": _open.checkin_reward or [1, 10],
            "can_edit": user["role"] == "owner",
        },
    }


@router.post("/settings/checkin")
async def update_checkin_settings(body: CheckinSettingsRequest, user=Depends(require_owner)):
    _open.checkin = body.enabled
    _open.checkin_lv = body.level
    save_config()
    LOGGER.info(
        f"WebApp owner {user['tg_id']} updated checkin settings: enabled={body.enabled}, level={body.level}"
    )
    return {
        "code": 200,
        "data": {
            "enabled": bool(_open.checkin),
            "level": _open.checkin_lv,
            "reward_range": _open.checkin_reward or [1, 10],
        },
    }


@router.get("/settings/banner")
async def get_banner_settings(user=Depends(require_owner)):
    banner = getattr(webapp_config, "banner", None)
    return {
        "code": 200,
        "data": {
            "enabled": bool(getattr(banner, "enabled", False)),
            "title": getattr(banner, "title", ""),
            "subtitle": getattr(banner, "subtitle", ""),
            "image_url": getattr(banner, "image_url", None),
            "link_url": getattr(banner, "link_url", None),
        },
    }


@router.post("/settings/banner")
async def update_banner_settings(body: BannerSettingsRequest, user=Depends(require_owner)):
    webapp_config.banner.enabled = body.enabled
    webapp_config.banner.title = body.title
    webapp_config.banner.subtitle = body.subtitle
    webapp_config.banner.image_url = body.image_url
    webapp_config.banner.link_url = body.link_url
    save_config()
    LOGGER.info(f"WebApp owner {user['tg_id']} updated homepage banner settings")
    return {
        "code": 200,
        "data": {
            "enabled": bool(webapp_config.banner.enabled),
            "title": webapp_config.banner.title,
            "subtitle": webapp_config.banner.subtitle,
            "image_url": webapp_config.banner.image_url,
            "link_url": webapp_config.banner.link_url,
        },
    }
