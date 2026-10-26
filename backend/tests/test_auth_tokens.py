import json

import pytest
from fastapi import HTTPException

from app.auth import (
    authenticate_credentials,
    get_principal,
    hash_password,
    issue_token,
)
from app.config import settings


def test_auth_fails_closed_when_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_SECRET_KEY", "")
    monkeypatch.setattr(settings, "AUTH_USERS_JSON", "{}")

    with pytest.raises(HTTPException) as missing_auth:
        get_principal("Bearer forged-token")
    assert missing_auth.value.status_code == 503


def test_signed_token_uses_current_configured_role(monkeypatch):
    password = "test-only-password-123"
    monkeypatch.setattr(settings, "AUTH_SECRET_KEY", "t" * 48)
    monkeypatch.setattr(settings, "AUTH_USERS_JSON", json.dumps({
        "operator-test": {
            "role": "OPERATOR",
            "password_hash": hash_password(password),
        }
    }))

    principal = authenticate_credentials("operator-test", password)
    assert principal is not None and principal.role == "OPERATOR"
    token, _ = issue_token(principal.username, principal.role)
    assert get_principal(f"Bearer {token}") == principal

    monkeypatch.setattr(settings, "AUTH_USERS_JSON", json.dumps({
        "operator-test": {
            "role": "RESPONDER",
            "password_hash": hash_password(password),
        }
    }))
    with pytest.raises(HTTPException) as changed_role:
        get_principal(f"Bearer {token}")
    assert changed_role.value.status_code == 401

    with pytest.raises(HTTPException) as forged:
        get_principal(f"Bearer {token[:-1]}x")
    assert forged.value.status_code == 401
