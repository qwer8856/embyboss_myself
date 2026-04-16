#! /usr/bin/python3
# -*- coding: utf-8 -*-
from datetime import datetime, timedelta
import re
from typing import Optional

from pyrogram import enums
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_

from bot import LOGGER, admins, save_config, user_p, admin_p, owner_p, _open, webapp as webapp_config, bot, group
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


def _normalize_group_chat_id(raw):
    if isinstance(raw, int):
        return raw

    text = str(raw or "").strip()
    if not text:
        return None

    text = (
        text.replace("－", "-")
        .replace("–", "-")
        .replace("—", "-")
        .replace("﹣", "-")
    )
    for prefix in ("https://t.me/", "http://t.me/", "t.me/"):
        if text.startswith(prefix):
            text = text[len(prefix):]
            break
    text = text.strip().strip("/")

    if re.fullmatch(r"-?\d+", text):
        return int(text)
    if text.startswith("@"):
        return text
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{3,}", text):
        return f"@{text}"
    return None


def _escape_markdown_text(text: str) -> str:
    return (
        str(text or "")
        .replace("\\", "\\\\")
        .replace("`", "\\`")
        .replace("*", "\\*")
        .replace("_", "\\_")
        .replace("[", "\\[")
        .replace("]", "\\]")
        .replace("(", "\\(")
        .replace(")", "\\)")
    )


def _format_user_mention(display_name: str, tg_id: int) -> str:
    safe_name = _escape_markdown_text(display_name or tg_id)
    safe_name = str(safe_name).strip() or str(tg_id)
    return f"[{safe_name}](tg://user?id={tg_id})"


async def _resolve_user_display_name(tg_id: int) -> str:
    try:
        chat = await bot.get_chat(tg_id)
        name = (getattr(chat, "first_name", None) or getattr(chat, "title", None) or "").strip()
        return name or str(tg_id)
    except Exception as exc:
        LOGGER.warning(f"WebApp admin notify resolve display name failed: tg={tg_id} err={exc}")
        return str(tg_id)


async def _notify_group_message(text: str) -> None:
    if not text:
        return
    if not group:
        LOGGER.warning("WebApp admin notify skipped: group list is empty")
        return
    chat_id = _normalize_group_chat_id(group[0])
    if chat_id is None:
        LOGGER.warning(f"WebApp admin notify skipped: invalid group identifier: {group[0]!r}")
        return
    try:
        await bot.send_message(chat_id=chat_id, text=text, parse_mode=enums.ParseMode.MARKDOWN)
    except Exception as exc:
        LOGGER.warning(f"WebApp admin notify failed: {exc}")


def _build_admin_open_text(operator_name: str, operator_tg: int, target_name: str, target_tg: int, days: int, ex_text: str) -> str:
    return (
        f"· \U0001f195 管理员开通账号 - {_format_user_mention(operator_name, operator_tg)} 为 "
        f"{_format_user_mention(target_name, target_tg)} [{target_tg}] 开通 {days} 天\n"
        f"· \U0001f4c5 实时到期 - {ex_text}"
    )


def _build_admin_renew_text(operator_name: str, operator_tg: int, target_name: str, target_tg: int, days: int, ex_text: str) -> str:
    return (
        f"· \U0001f4c6 管理员手动续期 - {_format_user_mention(operator_name, operator_tg)} 为 "
        f"{_format_user_mention(target_name, target_tg)} [{target_tg}] 续期 {days} 天\n"
        f"· \U0001f4c5 实时到期 - {ex_text}"
    )


def _build_admin_ban_text(operator_name: str, operator_tg: int, target_name: str, target_tg: int, disabled: bool) -> str:
    action = "封禁" if disabled else "解封"
    return (
        f"· \U0001f6ab 管理员{action}账号 - {_format_user_mention(operator_name, operator_tg)} 将 "
        f"{_format_user_mention(target_name, target_tg)} [{target_tg}] 设为{action}"
    )


def _build_admin_delete_text(operator_name: str, operator_tg: int, target_name: str, target_tg: int) -> str:
    return (
        f"· \U0001f5d1\ufe0f 管理员删除账号 - {_format_user_mention(operator_name, operator_tg)} 删除了 "
        f"{_format_user_mention(target_name, target_tg)} [{target_tg}]"
    )


def _build_admin_whitelist_text(operator_name: str, operator_tg: int, target_name: str, target_tg: int, enabled: bool) -> str:
    status = "白名单" if enabled else "普通线路"
    return (
        f"· \u2b50 白名单状态变更 - {_format_user_mention(operator_name, operator_tg)} 将 "
        f"{_format_user_mention(target_name, target_tg)} [{target_tg}] 调整为{status}"
    )


def _build_admin_toggle_text(operator_name: str, operator_tg: int, target_name: str, target_tg: int, enabled: bool) -> str:
    action = "添加管理员" if enabled else "取消管理员"
    return (
        f"· \U0001f477 管理员权限变更 - {_format_user_mention(operator_name, operator_tg)} 对 "
        f"{_format_user_mention(target_name, target_tg)} [{target_tg}] 执行{action}"
    )


def _build_checkin_settings_text(operator_name: str, operator_tg: int, enabled: bool, level: str) -> str:
    status = "开启" if enabled else "关闭"
    return (
        f"· \u2699\ufe0f 签到配置变更 - {_format_user_mention(operator_name, operator_tg)} 将签到功能设为{status}\n"
        f"· \U0001f3af 允许最低等级 - {level}"
    )


def _build_banner_settings_text(operator_name: str, operator_tg: int, enabled: bool, title: str, subtitle: str) -> str:
    status = "开启" if enabled else "关闭"
    title_text = _escape_markdown_text(title or "未填写")
    subtitle_text = _escape_markdown_text(subtitle or "未填写")
    return (
        f"· \U0001f5e7 主页横幅变更 - {_format_user_mention(operator_name, operator_tg)} 更新了首页横幅\n"
        f"· \U0001f6a7 状态 - {status}\n"
        f"· \U0001f4dd 标题 - {title_text}\n"
        f"· \U0001f4dd 副标题 - {subtitle_text}"
    )


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
    operator_name = await _resolve_user_display_name(user["tg_id"])
    await _notify_group_message(
        _build_admin_open_text(operator_name, user["tg_id"], body.name, body.tg, body.days, ex.strftime("%Y-%m-%d %H:%M:%S"))
    )
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
    operator_name = await _resolve_user_display_name(user["tg_id"])
    target_name = record.name or record.embyid or str(record.tg)
    await _notify_group_message(
        _build_admin_renew_text(
            operator_name,
            user["tg_id"],
            target_name,
            record.tg,
            int(body.days),
            ex_new.strftime("%Y-%m-%d %H:%M:%S"),
        )
    )
    return {
        "code": 200,
        "data": {
            "tg": record.tg,
            "name": record.name or record.embyid or str(record.tg),
            "days": body.days,
            "expires_at": ex_new,
            "lv": lv,
        },
    }


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
    operator_name = await _resolve_user_display_name(user["tg_id"])
    target_name = record.name or record.embyid or str(record.tg)
    await _notify_group_message(
        _build_admin_ban_text(operator_name, user["tg_id"], target_name, record.tg, disable)
    )
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
    operator_name = await _resolve_user_display_name(user["tg_id"])
    target_name = record.name or record.embyid or str(record.tg)
    await _notify_group_message(
        _build_admin_delete_text(operator_name, user["tg_id"], target_name, record.tg)
    )
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
    operator_name = await _resolve_user_display_name(user["tg_id"])
    target_name = record.name or record.embyid or str(record.tg)
    await _notify_group_message(
        _build_admin_whitelist_text(operator_name, user["tg_id"], target_name, record.tg, body.enable)
    )
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
        operator_name = await _resolve_user_display_name(user["tg_id"])
        target_name = await _resolve_user_display_name(body.tg)
        await _notify_group_message(
            _build_admin_toggle_text(operator_name, user["tg_id"], target_name, body.tg, body.enable)
        )
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
    operator_name = await _resolve_user_display_name(user["tg_id"])
    await _notify_group_message(_build_checkin_settings_text(operator_name, user["tg_id"], body.enabled, body.level))
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
    operator_name = await _resolve_user_display_name(user["tg_id"])
    await _notify_group_message(
        _build_banner_settings_text(operator_name, user["tg_id"], body.enabled, body.title, body.subtitle)
    )
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
