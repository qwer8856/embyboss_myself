#! /usr/bin/python3
# -*- coding: utf-8 -*-
from pydantic import BaseModel
from fastapi import APIRouter, Depends

from .webapp_security import (
    issue_webapp_session_from_init_data,
    get_current_webapp_user,
)

router = APIRouter()


class WebAppLoginRequest(BaseModel):
    init_data: str


@router.post("/login")
async def webapp_login(body: WebAppLoginRequest):
    session_data = issue_webapp_session_from_init_data(body.init_data)
    return {"code": 200, "message": "ok", "data": session_data}


@router.get("/me")
async def webapp_me(user=Depends(get_current_webapp_user)):
    return {"code": 200, "data": user}
