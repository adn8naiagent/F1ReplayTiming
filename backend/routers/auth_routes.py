from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from auth import is_auth_enabled, generate_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    passphrase: str


@router.get("/status")
async def auth_status():
    return {"auth_enabled": is_auth_enabled()}


@router.post("/login")
async def auth_login(body: LoginRequest):
    token = generate_token(body.passphrase)
    if token is None:
        raise HTTPException(status_code=401, detail="Invalid passphrase")
    return {"token": token}
