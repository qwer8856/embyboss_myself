#!/usr/bin/python3
import re
import unicodedata

from pyrogram.errors import BadRequest
from pyrogram.filters import create
from bot import admins, owner, group, LOGGER
from pyrogram.enums import ChatMemberStatus


# async def owner_filter(client, update):
#     """
#     过滤 owner
#     :param client:
#     :param update:
#     :return:
#     """
#     user = update.from_user or update.sender_chat
#     uid = user.id
#     return uid == owner

# 三个参数给on用
async def admins_on_filter(filt, client, update) -> bool:
    """
    过滤admins中id，包括owner
    :param client:
    :param update:
    :return:
    """
    user = update.from_user or update.sender_chat
    uid = user.id
    return bool(uid == owner or uid in admins or uid in group)


async def admins_filter(update):
    """
    过滤admins中id，包括owner
    """
    user = update.from_user or update.sender_chat
    uid = user.id
    return bool(uid == owner or uid in admins)


def _normalize_group_chat_id(raw):
    """
    将配置里的群标识规范化为 pyrogram 可识别的 chat_id:
    - 数字群ID（含 -100...）
    - @username
    - t.me/xxx 链接
    """
    if isinstance(raw, int):
        return raw

    text = unicodedata.normalize("NFKC", str(raw or "")).strip()
    if not text:
        raise ValueError("empty group identifier")

    # 兼容各种减号字符
    text = (
        text.replace("−", "-")
        .replace("—", "-")
        .replace("–", "-")
        .replace("－", "-")
    )

    # 兼容 t.me 链接写法
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

    raise ValueError(f"invalid group identifier: {raw!r}")


async def user_in_group_filter(client, update):
    """
    过滤在授权组中的人员
    :param client:
    :param update:
    :return:
    """
    uid = update.from_user or update.sender_chat
    uid = uid.id
    for i in group:
        try:
            chat_id = _normalize_group_chat_id(i)
            u = await client.get_chat_member(chat_id=chat_id, user_id=uid)
            if u.status in [ChatMemberStatus.ADMINISTRATOR, ChatMemberStatus.MEMBER, ChatMemberStatus.OWNER]:
                return True
        except ValueError:
            LOGGER.error(f"group 配置无效，无法识别该群标识: {i!r}")
            continue
        except BadRequest as e:
            if getattr(e, "ID", None) == 'CHAT_ADMIN_REQUIRED':
                LOGGER.error(f"bot不能在 {i} 中工作，请检查bot是否在群组及其权限设置")
            continue
        else:
            continue
    return False


async def user_in_group_on_filter(filt, client, update):
    """
    过滤在授权组中的人员
    :param client:
    :param update:
    :return:
    """
    uid = update.from_user or update.sender_chat
    uid = uid.id
    if uid in group:
        return True
    for i in group:
        try:
            chat_id = _normalize_group_chat_id(i)
            u = await client.get_chat_member(chat_id=chat_id, user_id=uid)
            if u.status in [ChatMemberStatus.ADMINISTRATOR, ChatMemberStatus.MEMBER,
                            ChatMemberStatus.OWNER]:  # 移除了 'ChatMemberStatus.RESTRICTED' 防止有人进群直接注册不验证
                return True  # 因为被限制用户无法使用bot，所以需要检查权限。
        except ValueError:
            LOGGER.error(f"group 配置无效，无法识别该群标识: {i!r}")
            continue
        except BadRequest as e:
            if getattr(e, "ID", None) == 'CHAT_ADMIN_REQUIRED':
                LOGGER.error(f"bot不能在 {i} 中工作，请检查bot是否在群组及其权限设置")
            continue
    return False


# 过滤 on_message or on_callback 的admin
admins_on_filter = create(admins_on_filter)
admins_filter = create(admins_filter)

# 过滤 是否在群内
user_in_group_f = create(user_in_group_filter)
user_in_group_on_filter = create(user_in_group_on_filter)
