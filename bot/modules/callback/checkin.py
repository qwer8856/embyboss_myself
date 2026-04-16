from pyrogram import filters

from bot import bot, webapp
from bot.func_helper.filters import user_in_group_on_filter
from bot.func_helper.msg_utils import callAnswer


@bot.on_callback_query(filters.regex("^checkin$") & user_in_group_on_filter)
async def user_in_checkin(_, call):
    """历史消息上的回调签到已停用，统一走可视化面板（WebApp + 人机验证）。"""
    if webapp.status and webapp.url:
        await callAnswer(
            call,
            "签到已改为在可视化面板内完成：请点击键盘上的「🎯 签到」，在网页中验证后签到。",
            True,
        )
        return
        await callAnswer(
            call,
            "签到已改为在可视化面板内完成：请点键盘上的「🎯 签到」或「打开可视化面板」，在网页中验证后签到。",
            True,
        )
    else:
        await callAnswer(call, "当前未启用可视化面板，无法进行签到。", True)
