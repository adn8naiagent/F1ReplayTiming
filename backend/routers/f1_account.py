"""F1 TV account sign-in for downloading session data. Self-hosted only:
blocked in public mode (main.py)."""

from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import f1_account

router = APIRouter(prefix="/api/f1tv", tags=["f1tv"])


class SignInRequest(BaseModel):
    email: Optional[str] = None
    password: Optional[str] = None
    remember: bool = True
    # A pasted loginSession cookie value or token, instead of email/password
    token: Optional[str] = None


@router.get("/status")
async def status():
    return await asyncio.to_thread(f1_account.status)


@router.post("/sign-in")
async def sign_in(body: SignInRequest):
    try:
        if body.token:
            return await asyncio.to_thread(f1_account.sign_in_token, body.token)
        if not body.email or not body.password:
            raise HTTPException(status_code=400, detail="Enter your F1 account email and password.")
        return await asyncio.to_thread(f1_account.sign_in_password, body.email, body.password, body.remember)
    except f1_account.F1AccountError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/sign-in")
async def sign_out():
    return await asyncio.to_thread(f1_account.sign_out)
