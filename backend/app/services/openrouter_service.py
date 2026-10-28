"""Optional, grounded OpenRouter analysis; never creates observations or alerts."""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.config import settings
from app.services.gemini_service import AssistanceResult, SYSTEM_RULES
from app.time_utils import utcnow

logger = logging.getLogger("nesafe.openrouter")

ASSISTANCE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "summary": {"type": "string", "maxLength": 1200},
        "supporting_observations": {
            "type": "array", "maxItems": 5,
            "items": {"type": "string", "maxLength": 300},
        },
        "uncertainties": {
            "type": "array", "maxItems": 5,
            "items": {"type": "string", "maxLength": 300},
        },
        "preparedness_actions": {
            "type": "array", "maxItems": 5,
            "items": {"type": "string", "maxLength": 300},
        },
        "evidence_sufficient": {"type": "boolean"},
        "content_type": {"type": "string", "enum": ["AI_GENERATED_EXPLANATION"]},
    },
    "required": [
        "summary", "supporting_observations", "uncertainties",
        "preparedness_actions", "evidence_sufficient", "content_type",
    ],
}


class OpenRouterUnavailable(Exception):
    """The explicitly selected OpenRouter provider is not configured."""


class OpenRouterRequestFailed(Exception):
    """Provider failed or returned an invalid structured response."""


class OpenRouterService:
    def __init__(self):
        self.last_success_at: str | None = None
        self.last_error_at: str | None = None
        self.last_error_code: str | None = None

    def configured(self) -> bool:
        return bool(
            settings.OPENROUTER_ENABLED
            and settings.OPENROUTER_API_KEY
            and settings.OPENROUTER_MODEL.strip()
        )

    def status(self) -> dict[str, Any]:
        enabled = bool(settings.OPENROUTER_ENABLED)
        configured = self.configured()
        verified = bool(self.last_success_at and (
            not self.last_error_at or self.last_success_at >= self.last_error_at
        ))
        if not enabled:
            status = "DISABLED"
        elif not settings.OPENROUTER_API_KEY:
            status = "AUTH_REQUIRED"
        elif verified:
            status = "OPERATIONAL"
        else:
            status = "CONFIGURED_UNVERIFIED"
        return {
            "enabled": enabled,
            "configured": configured,
            "connectivity_verified": verified,
            "status": status,
            "model": settings.OPENROUTER_MODEL if enabled else None,
            "last_success_at": self.last_success_at,
            "last_error_at": self.last_error_at,
            "last_error_code": self.last_error_code,
        }

    @staticmethod
    def _error_code(status_code: int | None) -> str:
        if status_code in (401, 403):
            return f"HTTP_{status_code}"
        if status_code == 402:
            return "HTTP_402"
        if status_code == 429:
            return "HTTP_429"
        if status_code is not None:
            return f"HTTP_{status_code}" if status_code < 500 else "HTTP_5XX"
        return "CONNECTION_OR_RESPONSE_ERROR"

    def generate(self, task: str, evidence: dict[str, Any], question: str = "") -> AssistanceResult:
        if not self.configured():
            raise OpenRouterUnavailable

        prompt = json.dumps(
            {"task": task, "evidence": evidence, "question": question},
            ensure_ascii=False,
            separators=(",", ":"),
            default=str,
        )
        if len(prompt) > 20_000:
            raise OpenRouterRequestFailed("AI evidence is too large")

        payload = {
            "model": settings.OPENROUTER_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_RULES},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
            "max_tokens": settings.OPENROUTER_MAX_TOKENS,
            "provider": {"require_parameters": True},
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "nesafe_assistance",
                    "strict": True,
                    "schema": ASSISTANCE_SCHEMA,
                },
            },
        }
        endpoint = f"{settings.OPENROUTER_BASE_URL.rstrip('/')}/chat/completions"
        status_code = None
        try:
            with httpx.Client(timeout=max(1, settings.OPENROUTER_TIMEOUT_SECONDS)) as client:
                response = client.post(
                    endpoint,
                    headers={
                        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
                        "Content-Type": "application/json",
                        "X-Title": "NE-SAFE Geo Shield",
                    },
                    json=payload,
                )
                status_code = response.status_code
                response.raise_for_status()
                body = response.json()
            choices = body.get("choices") or []
            message = choices[0].get("message") if choices else None
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, str) or not content.strip():
                raise ValueError("empty structured response")
            result = AssistanceResult.model_validate_json(content)
            actual_model = body.get("model") or settings.OPENROUTER_MODEL
            self.last_success_at = utcnow().isoformat()
            self.last_error_code = None
            return result.model_copy(update={
                "generated_at": self.last_success_at,
                "model": str(actual_model)[:160],
            })
        except Exception as exc:
            if isinstance(exc, httpx.HTTPStatusError):
                status_code = exc.response.status_code
            error_code = self._error_code(status_code)
            self.last_error_at = utcnow().isoformat()
            self.last_error_code = error_code
            # Do not log request bodies, response contents, URLs with parameters, or credentials.
            logger.warning("OpenRouter request failed (%s)", error_code)
            raise OpenRouterRequestFailed from None


openrouter_service = OpenRouterService()
