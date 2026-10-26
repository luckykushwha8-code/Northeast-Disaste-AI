"""Ephemeral signed accounts shared by HTTP integration tests only."""
import json

from app.auth import hash_password, issue_token
from app.config import settings

settings.AUTH_SECRET_KEY = "test-only-signing-key-that-is-never-deployed-123456"
settings.AUTH_TOKEN_TTL_MINUTES = 1_000_000  # Integration runs can outlast the app's normal token lifetime.
_password = "test-only-password-123"
settings.AUTH_USERS_JSON = json.dumps({
    username: {"role": role, "password_hash": hash_password(_password)}
    for username, role in (
        ("test-operator", "OPERATOR"),
        ("test-responder", "RESPONDER"),
        ("test-resident", "RESIDENT"),
    )
})

AUTH_HEADERS = {
    role: {"Authorization": f"Bearer {issue_token(username, role)[0]}"}
    for username, role in (
        ("test-operator", "OPERATOR"),
        ("test-responder", "RESPONDER"),
        ("test-resident", "RESIDENT"),
    )
}
