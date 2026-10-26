from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from google import genai

from app.config import settings
from app.main import app
from app.services.gemini_service import AssistanceResult, GeminiRequestFailed, GeminiService, GeminiUnavailable


def test_missing_key_disables_gemini_without_import_or_request(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_ENABLED", True)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    assert not GeminiService.available()
    with pytest.raises(GeminiUnavailable):
        GeminiService().generate("test", {})


def test_structured_output_is_validated_and_key_is_not_logged(monkeypatch, caplog):
    secret = "test-only-gemini-secret"
    monkeypatch.setattr(settings, "GEMINI_ENABLED", True)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", secret)
    mock_client = MagicMock()
    expected = AssistanceResult(summary="Evidence is limited.", evidence_sufficient=False)
    mock_client.__enter__.return_value.models.generate_content.return_value = SimpleNamespace(parsed=expected, text=None)
    monkeypatch.setattr(genai, "Client", lambda **kwargs: mock_client)

    result = GeminiService().generate("district", {"district": "Example"})

    assert result == expected
    assert secret not in caplog.text
    assert mock_client.__enter__.return_value.models.generate_content.call_args.kwargs["model"] == settings.GEMINI_MODEL


def test_provider_errors_return_generic_error_and_do_not_log_secret(monkeypatch, caplog):
    secret = "test-only-gemini-secret"
    monkeypatch.setattr(settings, "GEMINI_ENABLED", True)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", secret)
    mock_client = MagicMock()
    mock_client.__enter__.return_value.models.generate_content.side_effect = RuntimeError(secret)
    monkeypatch.setattr(genai, "Client", lambda **kwargs: mock_client)

    with pytest.raises(GeminiRequestFailed):
        GeminiService().generate("district", {})
    assert secret not in caplog.text


@pytest.fixture
def client():
    return TestClient(app)


def test_ai_status_never_returns_configuration(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_ENABLED", True)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "secret")
    response = client.get("/api/v1/ai/status")
    assert response.status_code == 200
    assert response.json() == {"available": True, "content_type": "AI_GENERATED_EXPLANATION"}
    assert "secret" not in response.text


def test_preparedness_request_validates_length_and_reports_unavailable(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_ENABLED", False)
    assert client.post("/api/v1/ai/preparedness", json={"question": "Hi"}).status_code == 422
    response = client.post("/api/v1/ai/preparedness", json={"question": "What should I prepare?"})
    assert response.status_code == 503
    assert "API key" not in response.text


def test_report_summary_requires_real_operator_authentication(client, monkeypatch):
    monkeypatch.setattr(settings, "AUTH_SECRET_KEY", "")
    monkeypatch.setattr(settings, "AUTH_USERS_JSON", "{}")
    response = client.post("/api/v1/ai/report-summary")
    assert response.status_code == 503
    assert response.json()["detail"] == "Operator authentication is not configured"


def test_ai_endpoint_has_tighter_rate_limit(client, monkeypatch):
    app.state.rate_limit_hits.clear()
    monkeypatch.setattr(settings, "GEMINI_RATE_LIMIT_PER_MINUTE", 0)
    response = client.post("/api/v1/ai/preparedness", json={"question": "What should I prepare?"})
    assert response.status_code == 429
    monkeypatch.setattr(settings, "GEMINI_RATE_LIMIT_PER_MINUTE", 8)
