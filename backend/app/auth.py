"""Configuration-backed operator/responder authentication.

Accounts are supplied out of band as PBKDF2 password hashes. Signed bearer
tokens use the Python standard library so authentication fails closed without
an explicit 32-byte signing secret and configured accounts.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from getpass import getpass
from typing import Any, Callable

from fastapi import Depends, Header, HTTPException

from app.config import settings

PBKDF2_ITERATIONS = 390_000
ALLOWED_ROLES = {"RESIDENT", "RESPONDER", "OPERATOR", "ANALYST", "ADMIN"}


@dataclass(frozen=True)
class Principal:
    username: str
    role: str


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    if len(password) < 12:
        raise ValueError("Passwords must contain at least 12 characters")
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations_text, salt_hex, digest_hex = encoded.split("$", 3)
        iterations = int(iterations_text)
        if algorithm != "pbkdf2_sha256" or not 100_000 <= iterations <= 1_000_000:
            return False
        salt, expected = bytes.fromhex(salt_hex), bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except (TypeError, ValueError):
        return False


def configured_users() -> dict[str, dict[str, str]]:
    try:
        raw = json.loads(settings.AUTH_USERS_JSON or "{}")
    except json.JSONDecodeError:
        return {}
    if not isinstance(raw, dict):
        return {}
    users: dict[str, dict[str, str]] = {}
    for username, record in raw.items():
        if not isinstance(username, str) or not username.strip() or not isinstance(record, dict):
            continue
        role = str(record.get("role", "")).upper()
        password_hash = record.get("password_hash")
        if role in ALLOWED_ROLES and isinstance(password_hash, str) and password_hash.startswith("pbkdf2_sha256$"):
            users[username] = {"role": role, "password_hash": password_hash}
    return users


def authentication_ready() -> bool:
    return len(settings.AUTH_SECRET_KEY.encode("utf-8")) >= 32 and bool(configured_users())


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def issue_token(username: str, role: str) -> tuple[str, int]:
    if not authentication_ready():
        raise RuntimeError("Authentication is not configured")
    issued = int(time.time())
    expires = issued + max(5, settings.AUTH_TOKEN_TTL_MINUTES) * 60
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64(json.dumps({"sub": username, "role": role, "iat": issued, "exp": expires}, separators=(",", ":")).encode())
    unsigned = f"{header}.{payload}"
    signature = hmac.new(settings.AUTH_SECRET_KEY.encode(), unsigned.encode(), hashlib.sha256).digest()
    return f"{unsigned}.{_b64(signature)}", expires


def authenticate_credentials(username: str, password: str) -> Principal | None:
    user = configured_users().get(username)
    # Run a fixed-cost hash for unknown users too, avoiding an obvious timing leak.
    encoded = user["password_hash"] if user else hash_password("dummy-password-value-000", salt=bytes(16))
    valid = verify_password(password, encoded)
    if not user or not valid:
        return None
    return Principal(username=username, role=user["role"])


def get_principal(authorization: str | None = Header(default=None)) -> Principal:
    if not authentication_ready():
        raise HTTPException(status_code=503, detail="Operator authentication is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="A valid Bearer login token is required")
    token = authorization[7:].strip()
    try:
        header_part, payload_part, signature_part = token.split(".", 2)
        unsigned = f"{header_part}.{payload_part}"
        expected = hmac.new(settings.AUTH_SECRET_KEY.encode(), unsigned.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _unb64(signature_part)):
            raise ValueError("invalid signature")
        header = json.loads(_unb64(header_part))
        payload: dict[str, Any] = json.loads(_unb64(payload_part))
        if header.get("alg") != "HS256" or int(payload["exp"]) <= int(time.time()):
            raise ValueError("expired or invalid token")
        username, role = str(payload["sub"]), str(payload["role"]).upper()
        current = configured_users().get(username)
        if not current or current["role"] != role:
            raise ValueError("account is no longer active")
        return Principal(username=username, role=role)
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, base64.binascii.Error):
        raise HTTPException(status_code=401, detail="Bearer token is invalid or expired")


def require_roles(*roles: str) -> Callable[..., Principal]:
    allowed = {role.upper() for role in roles}

    def dependency(principal: Principal = Depends(get_principal)) -> Principal:
        if principal.role not in allowed:
            raise HTTPException(status_code=403, detail="This account is not authorized for this action")
        return principal

    return dependency


if __name__ == "__main__" and len(__import__("sys").argv) > 1 and __import__("sys").argv[1] == "hash-password":
    password = getpass("New password (12+ characters): ")
    confirmation = getpass("Repeat password: ")
    if password != confirmation:
        raise SystemExit("Passwords do not match")
    print(hash_password(password))
