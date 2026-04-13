#! /usr/bin/python3
# -*- coding: utf-8 -*-
import asyncio
import re
import random
import math
from datetime import datetime, timedelta, timezone
from typing import Optional

import aiohttp

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from bot import _open, LOGGER, webapp as webapp_config, sakura_b, config as bot_config, bot_name, ranks, save_config, schedall
from bot.func_helper.emby import emby, Embyservice
from bot.func_helper.utils import pwd_create
from bot.sql_helper import Session
from bot.sql_helper.sql_code import Code
from bot.sql_helper.sql_emby import Emby, sql_get_emby, sql_update_emby, sql_add_emby
from .webapp_security import get_current_webapp_user

router = APIRouter()
_activate_lock = asyncio.Lock()


class RedeemCodeRequest(BaseModel):
    code: str
    turnstile_token: Optional[str] = None


class CheckinRequest(BaseModel):
    turnstile_token: Optional[str] = None


class RenewPointsRequest(BaseModel):
    turnstile_token: Optional[str] = None


class InviteExchangeRequest(BaseModel):
    period: str = "mon"  # mon / sea / half / year
    count: int = 1
    mode: str = "code"  # code / link


class ActivateAccountRequest(BaseModel):
    method: str  # public / credit / points
    name: str = ""
    safe_code: str = ""


class ChangePasswordRequest(BaseModel):
    password: str


def _is_renew_code(input_string: str) -> bool:
    return "Renew" in input_string


def _normalize_emby_name(raw: str, tg_id: int) -> str:
    text = (raw or "").strip()
    if not text:
        return f"tg{tg_id}"
    text = re.sub(r"\s+", "", text)
    return text or f"tg{tg_id}"


def _normalize_requested_emby_name(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="missing_activate_name")
    if re.search(r"\s", text):
        raise HTTPException(status_code=400, detail="invalid_activate_name")
    return text


def _normalize_safe_code(raw: str) -> str:
    text = (raw or "").strip()
    if not text or re.search(r"\s", text):
        raise HTTPException(status_code=400, detail="invalid_safe_code")
    return text


def _get_renew_config() -> dict:
    points_enabled = bool(getattr(_open, "exchange", False))
    check_ex_enabled = bool(getattr(schedall, "check_ex", False))
    low_activity_enabled = bool(getattr(schedall, "low_activity", False))
    activity_days = int(getattr(bot_config, "activity_check_days", 30) or 30)
    points_cost = int(getattr(_open, "exchange_cost", 300) or 300)
    return {
        # legacy field kept for compatibility with older frontend logic
        "mode": "code",
        "code_enabled": True,
        "points_enabled": points_enabled,
        "points_cost": points_cost,
        "points_days": 30,
        "check_ex_enabled": check_ex_enabled,
        "low_activity_enabled": low_activity_enabled,
        "activity_check_days": activity_days,
    }


async def _create_emby_account_with_retry(tg_id: int, candidate_base: str, days: int):
    for idx in range(6):
        if idx == 0:
            candidate = candidate_base
        else:
            suffix = await pwd_create(4, chars="0123456789")
            candidate = f"{candidate_base}_{suffix}"
        data = await emby.emby_create(name=candidate, days=days)
        if data:
            return candidate, data
    return None, None


async def _verify_turnstile(turnstile_token: Optional[str]) -> None:
    config = getattr(webapp_config, "turnstile", None)
    if not config or not getattr(config, "enabled", False):
        return

    site_key = getattr(config, "site_key", None)
    secret_key = getattr(config, "secret_key", None)
    if not site_key or not secret_key:
        raise HTTPException(status_code=500, detail="turnstile_not_configured")
    if not turnstile_token:
        raise HTTPException(status_code=400, detail="turnstile_required")

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data={
                    "secret": secret_key,
                    "response": turnstile_token,
                },
                timeout=aiohttp.ClientTimeout(total=10),
            ) as response:
                payload = await response.json()
    except Exception as exc:
        LOGGER.error(f"Turnstile verify request failed: {exc}")
        raise HTTPException(status_code=502, detail="turnstile_verify_failed")

    if not payload.get("success"):
        error_codes = payload.get("error-codes") or []
        detail = error_codes[0] if error_codes else "turnstile_failed"
        raise HTTPException(status_code=400, detail=detail)


@router.get("/status")
async def user_status(user=Depends(get_current_webapp_user)):
    record = sql_get_emby(user["tg_id"])
    if not record:
        sql_add_emby(user["tg_id"])
        record = sql_get_emby(user["tg_id"])
    if not record:
        raise HTTPException(status_code=500, detail="user_profile_init_failed")
    renew = _get_renew_config()
    return {
        "code": 200,
        "data": {
            "tg": record.tg,
            "name": record.name,
            "embyid": record.embyid,
            "password": record.pwd,
            "lv": record.lv,
            "created_at": record.cr,
            "expires_at": record.ex,
            "points": record.iv,
            "money_label": sakura_b,
            "register_credits": record.us,
            "checkin_at": record.ch,
            "has_account": bool(record.embyid),
            "emby_line": bot_config.emby_line,
            "emby_whitelist_line": bot_config.emby_whitelist_line,
            "invite_enabled": bool(_open.invite),
            "invite_level": _open.invite_lv or "b",
            "invite_cost": int(_open.invite_cost or 1000),
            "public_open_enabled": bool(_open.stat),
            "public_open_days": int(_open.open_us or 30),
            "public_open_total": int(_open.all_user or 0),
            "public_open_used": int(_open.tem or 0),
            "public_open_left": max(int(_open.all_user or 0) - int(_open.tem or 0), 0),
            "renew_mode": renew["mode"],
            "renew_code_enabled": renew["code_enabled"],
            "renew_points_enabled": renew["points_enabled"],
            "renew_points_cost": renew["points_cost"],
            "renew_points_days": renew["points_days"],
            "renew_check_ex_enabled": renew["check_ex_enabled"],
            "renew_low_activity_enabled": renew["low_activity_enabled"],
            "renew_activity_check_days": renew["activity_check_days"],
        },
    }


@router.get("/media-count")
async def media_count(user=Depends(get_current_webapp_user)):
    _ = user
    text = await Embyservice.get_medias_count()
    return {"code": 200, "data": {"text": text}}


@router.get("/homepage-config")
async def homepage_config(user=Depends(get_current_webapp_user)):
    _ = user
    banner = getattr(webapp_config, "banner", None)
    renew = _get_renew_config()
    return {
        "code": 200,
        "data": {
            "title": webapp_config.title,
            "banner": {
                "enabled": bool(getattr(banner, "enabled", False)),
                "title": getattr(banner, "title", ""),
                "subtitle": getattr(banner, "subtitle", ""),
                "image_url": getattr(banner, "image_url", None),
                "link_url": getattr(banner, "link_url", None),
            },
            "turnstile": {
                "enabled": bool(getattr(getattr(webapp_config, "turnstile", None), "enabled", False)),
                "site_key": getattr(getattr(webapp_config, "turnstile", None), "site_key", None),
            },
            "invite": {
                "enabled": bool(_open.invite),
                "level": _open.invite_lv or "b",
                "cost": int(_open.invite_cost or 1000),
                "ratio_days": 30,
            },
            "public_open": {
                "enabled": bool(_open.stat),
                "days": int(_open.open_us or 30),
                "total": int(_open.all_user or 0),
                "used": int(_open.tem or 0),
                "left": max(int(_open.all_user or 0) - int(_open.tem or 0), 0),
            },
            "renew": {
                "mode": renew["mode"],
                "code_enabled": renew["code_enabled"],
                "points_enabled": renew["points_enabled"],
                "points_cost": renew["points_cost"],
                "points_days": renew["points_days"],
                "check_ex_enabled": renew["check_ex_enabled"],
                "low_activity_enabled": renew["low_activity_enabled"],
                "activity_check_days": renew["activity_check_days"],
            },
        },
    }


@router.post("/invite/exchange")
async def exchange_invite_code(body: InviteExchangeRequest, user=Depends(get_current_webapp_user)):
    if not _open.invite:
        raise HTTPException(status_code=403, detail="invite_disabled")

    period = (body.period or "").strip().lower()
    mode = (body.mode or "").strip().lower()
    count = int(body.count or 0)
    period_days_map = {
        "mon": 30,
        "sea": 90,
        "half": 180,
        "year": 365,
    }
    if period not in period_days_map:
        raise HTTPException(status_code=400, detail="invalid_period")
    if mode not in {"code", "link"}:
        raise HTTPException(status_code=400, detail="invalid_mode")
    if count < 1 or count > 50:
        raise HTTPException(status_code=400, detail="invalid_count")

    with Session() as session:
        record = session.query(Emby).filter(Emby.tg == user["tg_id"]).with_for_update().first()
        if not record:
            raise HTTPException(status_code=404, detail="user_not_found")

        if (_open.invite_lv or "b") < record.lv:
            raise HTTPException(status_code=403, detail="invite_level_insufficient")

        days = period_days_map[period]
        cost = math.floor((days * count / 30) * int(_open.invite_cost or 1000))
        if cost <= 0:
            raise HTTPException(status_code=500, detail="invite_cost_invalid")
        if (record.iv or 0) < cost:
            raise HTTPException(status_code=400, detail="insufficient_points")

        code_list = []
        for _ in range(count):
            p = await pwd_create(10)
            code_list.append(f"{ranks.logo}-{period}-Register_{p}")

        rows = [Code(code=code, tg=user["tg_id"], us=days) for code in code_list]
        session.add_all(rows)
        record.iv = (record.iv or 0) - cost
        points_left = record.iv or 0
        session.commit()

        if mode == "link":
            items = [f"t.me/{bot_name}?start={code}" for code in code_list]
        else:
            items = code_list

    LOGGER.info(
        f"WebApp invite exchange: tg={user['tg_id']} period={period} count={count} mode={mode} cost={cost}"
    )
    return {
        "code": 200,
        "message": "ok",
        "data": {
            "period": period,
            "days": period_days_map[period],
            "count": count,
            "mode": mode,
            "cost": cost,
            "points_left": points_left,
            "items": items,
        },
    }


@router.post("/activate")
async def activate_account(body: ActivateAccountRequest, user=Depends(get_current_webapp_user)):
    method = (body.method or "").strip().lower()
    if method not in {"public", "credit", "points"}:
        raise HTTPException(status_code=400, detail="invalid_activate_method")

    async with _activate_lock:
        with Session() as session:
            record = session.query(Emby).filter(Emby.tg == user["tg_id"]).with_for_update().first()
            if not record:
                raise HTTPException(status_code=404, detail="user_not_found")
            if record.embyid:
                raise HTTPException(status_code=400, detail="user_already_has_emby")

            days = 0
            cost = 0
            iv_current = int(record.iv or 0)
            lv_current = str(record.lv or "d")
            us_current = int(record.us or 0)

            if method == "public":
                if us_current > 0:
                    raise HTTPException(status_code=400, detail="already_has_register_credit")
                if not _open.stat:
                    raise HTTPException(status_code=400, detail="public_register_closed")
                if int(_open.tem or 0) >= int(_open.all_user or 0):
                    raise HTTPException(status_code=400, detail="public_register_quota_reached")
                days = int(_open.open_us or 30)
                record.us = us_current + days
            elif method == "credit":
                if us_current <= 0:
                    raise HTTPException(status_code=400, detail="no_register_credit")
                requested_name = _normalize_requested_emby_name(body.name)
                safe_code = _normalize_safe_code(body.safe_code)
                days = us_current
            elif method == "points":
                if us_current > 0:
                    raise HTTPException(status_code=400, detail="already_has_register_credit")
                if not _open.invite:
                    raise HTTPException(status_code=400, detail="points_exchange_disabled")
                if (_open.invite_lv or "b") < lv_current:
                    raise HTTPException(status_code=403, detail="invite_level_insufficient")
                cost = int(_open.invite_cost or 1000)
                if iv_current < cost:
                    raise HTTPException(status_code=400, detail="insufficient_points")
                days = int(_open.open_us or 30)
                record.iv = iv_current - cost
                record.us = us_current + days

            if method == "credit":
                final_name = requested_name
                created = await emby.emby_create(name=final_name, days=days)
                if not created:
                    raise HTTPException(status_code=500, detail="emby_create_failed")

                embyid, pwd, ex = created
                pwd2 = safe_code

                update_data = {
                    Emby.name: final_name,
                    Emby.embyid: embyid,
                    Emby.pwd: pwd,
                    Emby.pwd2: pwd2,
                    Emby.lv: "b",
                    Emby.cr: datetime.now(),
                    Emby.ex: ex,
                    Emby.us: 0,
                }
                session.query(Emby).filter(Emby.tg == user["tg_id"]).update(update_data)
            session.commit()

    if method == "public":
        _open.tem = int(_open.tem or 0) + 1
        if int(_open.tem or 0) >= int(_open.all_user or 0):
            _open.stat = False
        save_config()

    latest = sql_get_emby(user["tg_id"])
    LOGGER.info(f"WebApp activate account: tg={user['tg_id']} method={method} days={days}")
    if method in {"public", "points"}:
        return {
            "code": 200,
            "message": "register_credit_added",
            "data": {
                "method": method,
                "credit": int((latest.us if latest else days) or days),
                "days": days,
                "points_left": int((latest.iv if latest else 0) or 0),
                "register_credits_left": int((latest.us if latest else 0) or 0),
            },
        }
    return {
        "code": 200,
        "message": "ok",
        "data": {
            "method": method,
            "name": final_name,
            "embyid": embyid,
            "password": pwd,
            "safe_code": pwd2,
            "days": days,
            "expires_at": ex,
            "points_left": int((latest.iv if latest else 0) or 0),
            "register_credits_left": int((latest.us if latest else 0) or 0),
        },
    }


@router.post("/password")
async def change_password(body: ChangePasswordRequest, user=Depends(get_current_webapp_user)):
    new_password = body.password or ""
    if not new_password.strip():
        raise HTTPException(status_code=400, detail="invalid_password")

    record = sql_get_emby(user["tg_id"])
    if not record or not record.embyid:
        raise HTTPException(status_code=400, detail="user_no_emby_account")

    changed = await emby.emby_reset(emby_id=record.embyid, new_password=new_password)
    if not changed:
        raise HTTPException(status_code=500, detail="emby_password_update_failed")

    sql_update_emby(Emby.tg == user["tg_id"], pwd=new_password)
    latest = sql_get_emby(user["tg_id"])
    return {
        "code": 200,
        "message": "ok",
        "data": {
            "embyid": record.embyid,
            "password": (latest.pwd if latest else new_password),
        },
    }


@router.post("/checkin")
async def user_checkin(body: CheckinRequest, user=Depends(get_current_webapp_user)):
    await _verify_turnstile(body.turnstile_token)
    if not _open.checkin:
        raise HTTPException(status_code=400, detail="checkin_disabled")

    now = datetime.now(timezone(timedelta(hours=8)))
    today = now.strftime("%Y-%m-%d")
    record = sql_get_emby(user["tg_id"])
    if not record:
        raise HTTPException(status_code=404, detail="user_not_found")

    if _open.checkin_lv and record.lv > _open.checkin_lv:
        raise HTTPException(status_code=403, detail="insufficient_level")

    if record.ch and record.ch.strftime("%Y-%m-%d") >= today:
        return {"code": 200, "message": "already_checked_in", "data": {"points": record.iv, "checkin_at": record.ch}}

    reward = random.randint(_open.checkin_reward[0], _open.checkin_reward[1])
    new_points = record.iv + reward
    sql_update_emby(Emby.tg == user["tg_id"], iv=new_points, ch=now)
    return {"code": 200, "message": "ok", "data": {"reward": reward, "points": new_points, "checkin_at": now}}


@router.post("/renew")
async def renew_by_points(body: RenewPointsRequest, user=Depends(get_current_webapp_user)):
    await _verify_turnstile(body.turnstile_token)
    renew = _get_renew_config()
    if not renew["points_enabled"]:
        raise HTTPException(status_code=400, detail="renew_points_disabled")

    cost = int(renew["points_cost"])
    days = int(renew["points_days"])
    if cost <= 0:
        raise HTTPException(status_code=500, detail="renew_points_cost_invalid")

    now = datetime.now()
    with Session() as session:
        record = session.query(Emby).filter(Emby.tg == user["tg_id"]).with_for_update().first()
        if not record:
            raise HTTPException(status_code=404, detail="user_not_found")
        if not record.embyid:
            raise HTTPException(status_code=400, detail="user_no_emby_account")

        points = int(record.iv or 0)
        if points < cost:
            raise HTTPException(status_code=400, detail="insufficient_points")

        start_from = record.ex if isinstance(record.ex, datetime) and record.ex > now else now
        ex_new = start_from + timedelta(days=days)

        lv_new = "a" if record.lv == "a" else "b"
        if record.lv == "c":
            changed = await emby.emby_change_policy(emby_id=record.embyid, disable=False)
            if not changed:
                raise HTTPException(status_code=500, detail="emby_policy_update_failed")

        record.ex = ex_new
        record.iv = points - cost
        record.lv = lv_new
        session.commit()

        points_left = int(record.iv or 0)

    LOGGER.info(f"WebApp points renew: tg={user['tg_id']} days={days} cost={cost}")
    return {
        "code": 200,
        "message": "renewed",
        "data": {
            "days": days,
            "cost": cost,
            "points_left": points_left,
            "expires_at": ex_new,
        },
    }


@router.post("/redeem")
async def redeem_code(body: RedeemCodeRequest, user=Depends(get_current_webapp_user)):
    register_code = body.code.strip()
    if not register_code:
        raise HTTPException(status_code=400, detail="missing_code")
    await _verify_turnstile(body.turnstile_token)

    if _open.stat:
        raise HTTPException(status_code=400, detail="register_disabled_when_free_open")

    record = sql_get_emby(user["tg_id"])
    if not record:
        raise HTTPException(status_code=404, detail="user_not_found")
    is_renew = _is_renew_code(register_code)
    if record.embyid and not is_renew:
        raise HTTPException(status_code=400, detail="register_code_not_allowed_for_existing_account")
    if (not record.embyid) and is_renew:
        raise HTTPException(status_code=400, detail="renew_code_not_allowed_for_unregistered_user")
    if (not record.embyid) and record.us > 0:
        raise HTTPException(status_code=400, detail="already_has_register_credit")

    now = datetime.now()
    with Session() as session:
        code_obj = session.query(Code).filter(Code.code == register_code).with_for_update().first()
        if not code_obj:
            raise HTTPException(status_code=404, detail="invalid_code")

        updated = (
            session.query(Code)
            .filter(Code.code == register_code, Code.used.is_(None))
            .with_for_update()
            .update({Code.used: user["tg_id"], Code.usedtime: now})
        )
        if updated == 0:
            raise HTTPException(status_code=409, detail="code_used")

        gift_days = code_obj.us
        if record.embyid:
            ex_new = datetime.now()
            if record.ex and ex_new < record.ex:
                ex_new = record.ex
            ex_new = ex_new + timedelta(days=gift_days)

            if record.lv == "c":
                changed = await emby.emby_change_policy(emby_id=record.embyid, disable=False)
                if not changed:
                    raise HTTPException(status_code=500, detail="emby_policy_update_failed")
                session.query(Emby).filter(Emby.tg == user["tg_id"]).update({Emby.ex: ex_new, Emby.lv: "b"})
            else:
                session.query(Emby).filter(Emby.tg == user["tg_id"]).update({Emby.ex: ex_new})
            session.commit()
            LOGGER.info(f"WebApp renew code used: tg={user['tg_id']} days={gift_days}")
            return {"code": 200, "message": "renewed", "data": {"days": gift_days, "expires_at": ex_new}}

        new_credit = record.us + gift_days
        session.query(Emby).filter(Emby.tg == user["tg_id"]).update({Emby.us: new_credit})
        session.commit()
        LOGGER.info(f"WebApp register code used: tg={user['tg_id']} credit={gift_days}")
        return {"code": 200, "message": "register_credit_added", "data": {"credit": new_credit, "days": gift_days}}
