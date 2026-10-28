from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import httpx

from app.config import settings
from app.api.v1.routes import get_ai_status
from app.services.gemini_service import AssistanceResult
from app.services.openrouter_service import (
    OpenRouterRequestFailed,
    OpenRouterService,
    OpenRouterUnavailable,
)


@pytest.fixture(autouse=True)
def configure_test_provider(monkeypatch):
    monkeypatch.setattr(settings, "OPENROUTER_ENABLED", True)
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "test-only-openrouter-secret")
    monkeypatch.setattr(settings, "OPENROUTER_MODEL", "openrouter/auto")
    monkeypatch.setattr(settings, "OPENROUTER_BASE_URL", "https://openrouter.example/api/v1")
    monkeypatch.setattr(settings, "OPENROUTER_TIMEOUT_SECONDS", 5)
    monkeypatch.setattr(settings, "OPENROUTER_MAX_TOKENS", 700)


def _client(response):
    client = MagicMock()
    client.__enter__.return_value.post.return_value = response
    return client


def _response(content, model="openai/test-model"):
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {
        "model": model,
        "choices": [{"message": {"content": content}}],
    }
    response.raise_for_status.return_value = None
    return response


def test_openrouter_sends_compact_json_schema_request_and_validates_output(monkeypatch, caplog):
    result_json = (
        '{"summary":"Evidence is limited.","supporting_observations":[],"'
        'uncertainties":["No verified gauge data."],"preparedness_actions":[],"'
        'evidence_sufficient":false,"content_type":"AI_GENERATED_EXPLANATION"}'
    )
    client = _client(_response(result_json))
    monkeypatch.setattr("app.services.openrouter_service.httpx.Client", lambda **kwargs: client)

    result = OpenRouterService().generate("explain current evidence", {"rainfall": None})

    request = client.__enter__.return_value.post.call_args
    assert request.args[0] == "https://openrouter.example/api/v1/chat/completions"
    assert request.kwargs["headers"]["Authorization"] == "Bearer test-only-openrouter-secret"
    body = request.kwargs["json"]
    assert body["model"] == "openrouter/auto"
    assert body["response_format"]["json_schema"]["strict"] is True
    assert result.summary == "Evidence is limited."
    assert result.evidence_sufficient is False
    assert result.model == "openai/test-model"
    assert result.generated_at
    assert "test-only-openrouter-secret" not in caplog.text


def test_openrouter_requires_explicit_configuration(monkeypatch):
    monkeypatch.setattr(settings, "OPENROUTER_ENABLED", False)
    with pytest.raises(OpenRouterUnavailable):
        OpenRouterService().generate("test", {})


def test_provider_auth_error_is_sanitized_and_does_not_log_key(monkeypatch, caplog):
    response = MagicMock()
    response.status_code = 401
    response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "request failed", request=httpx.Request("POST", "https://openrouter.example"), response=httpx.Response(401)
    )
    monkeypatch.setattr("app.services.openrouter_service.httpx.Client", lambda **kwargs: _client(response))
    service = OpenRouterService()

    with pytest.raises(OpenRouterRequestFailed):
        service.generate("test", {})

    assert service.status()["last_error_code"] == "HTTP_401"
    assert "test-only-openrouter-secret" not in caplog.text


def test_invalid_provider_json_is_not_returned_as_analysis(monkeypatch):
    monkeypatch.setattr("app.services.openrouter_service.httpx.Client", lambda **kwargs: _client(_response("not json")))
    with pytest.raises(OpenRouterRequestFailed):
        OpenRouterService().generate("test", {})


def test_ai_status_reports_configuration_without_returning_secret(monkeypatch):
    monkeypatch.setattr(settings, "OPENROUTER_ENABLED", True)
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "test-only-openrouter-secret")
    monkeypatch.setattr(settings, "OPENROUTER_MODEL", "openrouter/auto")

    result = get_ai_status()

    assert result["available"] is True
    assert result["provider"] == "OpenRouter"
    assert result["status"] == "CONFIGURED_UNVERIFIED"
    assert result["connectivity_verified"] is False
    assert "test-only-openrouter-secret" not in str(result)


def test_ai_routes_select_openrouter_and_return_validated_metadata(monkeypatch):
    from app.api.v1 import routes

    expected = AssistanceResult(
        summary="Rainfall evidence is unavailable.",
        evidence_sufficient=False,
    )
    monkeypatch.setattr(routes.openrouter_service, "generate", lambda *args: expected)

    result = routes._ai_response("summarize", {"rainfall": None})

    assert result["summary"] == expected.summary
    assert result["content_type"] == "AI_GENERATED_EXPLANATION"


def test_ai_status_route_is_mounted_under_existing_versioned_api():
    from app.main import app

    assert "/api/v1/ai/status" in app.openapi()["paths"]
    assert "/api/v1/ai/preparedness" in app.openapi()["paths"]
    assert "/api/v1/sources/tinyfish/{record_id}/ai-summary" in app.openapi()["paths"]
