#! /usr/bin/python3
# -*- coding: utf-8 -*-
import base64
import hashlib
import hmac
import json
import time
from typing import Any, Dict, Optional, Tuple
from urllib.parse import parse_qsl

from fastapi import Depends, Header, HTTPException

from bot import LOGGER, bot_token, owner, admins, webapp as webapp_config


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("utf-8"))


def _session_signing_key() -> bytes:
    return hmac.new(b"SakuraWebAppSession", bot_token.encode("utf-8"), hashlib.sha256).digest()


def _tg_check_key() -> bytes:
    return hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()


def resolve_role(tg_id: int) -> str:
    if tg_id == owner:
        return "owner"
    if tg_id in admins:
        return "admin"
    return "user"


def verify_telegram_init_data(init_data: str, max_age: int) -> Tuple[bool, Optional[Dict[str, Any]], str]:
    if not init_data:
        return False, None, "missing_init_data"

    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    recv_hash = pairs.pop("hash", None)
    if not recv_hash:
        return False, None, "missing_hash"

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    calc_hash = hmac.new(
        _tg_check_key(),
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(calc_hash, recv_hash):
        return False, None, "invalid_hash"

    auth_date = pairs.get("auth_date")
    if not auth_date or not auth_date.isdigit():
        return False, None, "invalid_auth_date"
    if int(time.time()) - int(auth_date) > max_age:
        return False, None, "auth_expired"

    raw_user = pairs.get("user")
    if not raw_user:
        return False, None, "missing_user"
    try:
        user_data = json.loads(raw_user)
    except json.JSONDecodeError:
        return False, None, "invalid_user_json"

    if not isinstance(user_data, dict) or "id" not in user_data:
        return False, None, "invalid_user_payload"
    return True, user_data, "ok"


def create_session_token(*, tg_id: int, role: str, ttl_seconds: int) -> str:
    now = int(time.time())
    payload = {
        "sub": str(tg_id),
        "role": role,
        "iat": now,
        "exp": now + ttl_seconds,
    }
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    message = f"{header_b64}.{payload_b64}".encode("utf-8")
    signature = hmac.new(_session_signing_key(), message, hashlib.sha256).digest()
    sign_b64 = _b64url_encode(signature)
    return f"{header_b64}.{payload_b64}.{sign_b64}"


def decode_session_token(token: str) -> Dict[str, Any]:
    try:
        header_b64, payload_b64, sign_b64 = token.split(".")
    except ValueError:
        raise HTTPException(status_code=401, detail="invalid_token_format")

    message = f"{header_b64}.{payload_b64}".encode("utf-8")
    expected_sign = hmac.new(_session_signing_key(), message, hashlib.sha256).digest()
    try:
        recv_sign = _b64url_decode(sign_b64)
    except Exception:
        raise HTTPException(status_code=401, detail="invalid_token_signature")
    if not hmac.compare_digest(expected_sign, recv_sign):
        raise HTTPException(status_code=401, detail="invalid_token_signature")

    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=401, detail="invalid_token_payload")

    exp = payload.get("exp")
    if not isinstance(exp, int) or exp < int(time.time()):
        raise HTTPException(status_code=401, detail="token_expired")
    return payload


def _extract_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="missing_authorization")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="invalid_authorization")
    return parts[1].strip()


async def get_current_webapp_user(
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    token = _extract_bearer_token(authorization)
    payload = decode_session_token(token)
    try:
        tg_id = int(payload["sub"])
    except Exception:
        raise HTTPException(status_code=401, detail="invalid_subject")
    role = resolve_role(tg_id)
    return {"tg_id": tg_id, "role": role, "token_payload": payload}


async def require_admin(user: Dict[str, Any] = Depends(get_current_webapp_user)) -> Dict[str, Any]:
    if user["role"] not in {"admin", "owner"}:
        raise HTTPException(status_code=403, detail="admin_required")
    return user


async def require_owner(user: Dict[str, Any] = Depends(get_current_webapp_user)) -> Dict[str, Any]:
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="owner_required")
    return user


def issue_webapp_session_from_init_data(init_data: str) -> Dict[str, Any]:
    if not webapp_config.status:
        raise HTTPException(status_code=403, detail="webapp_disabled")
    max_age = max(int(webapp_config.auth_max_age_seconds), 60)
    ok, user_data, reason = verify_telegram_init_data(init_data, max_age)
    if not ok:
        LOGGER.warning(f"WebApp initData verify failed: {reason}")
        raise HTTPException(status_code=401, detail=reason)

    tg_id = int(user_data["id"])
    role = resolve_role(tg_id)
    token = create_session_token(
        tg_id=tg_id,
        role=role,
        ttl_seconds=max(int(webapp_config.session_ttl_seconds), 300),
    )
    return {"token": token, "tg_id": tg_id, "role": role, "tg_user": user_data}
