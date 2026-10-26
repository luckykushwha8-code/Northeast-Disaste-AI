import time
import threading
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.requests import Request

from app.config import settings


class PostRateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-process fixed-window rate limiter for POST endpoints.

    Prototype scope: per-(client-IP, minute-bucket) counters kept in memory
    (on app.state under `rate_limit_hits`, so tests and dev servers can reset
    it). Applied only to mutating (POST) requests under /api/v1 — public reads
    are cacheable and cheap, so they are not throttled.
    """

    WINDOW_SECONDS = 60.0

    def __init__(self, app):
        super().__init__(app)
        self._lock = threading.Lock()

    def _hits_bucket(self, request: Request):
        app = request.scope.get("app")
        state = getattr(app, "state", None)
        if state is None:
            return None
        if not hasattr(state, "rate_limit_hits"):
            state.rate_limit_hits = defaultdict(deque)
        return state.rate_limit_hits

    async def dispatch(self, request: Request, call_next):
        if request.method != "POST" or not request.url.path.startswith("/api/v1"):
            return await call_next(request)

        # Read the limit fresh at request time so tests can tighten it.
        is_ai_request = "/ai/" in request.url.path
        limit = int(getattr(settings, "GEMINI_RATE_LIMIT_PER_MINUTE", 8) if is_ai_request
                    else getattr(settings, "RATE_LIMIT_POST_PER_MINUTE", 30))

        client_ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        window = int(now // self.WINDOW_SECONDS)
        key = (f"{client_ip}:ai" if is_ai_request else client_ip, window)

        bucket = self._hits_bucket(request)
        if bucket is None:
            return await call_next(request)

        with self._lock:
            # Drop stale bucket entries to keep memory bounded
            stale = [k for k in bucket if k[1] < window - 1]
            for k in stale:
                del bucket[k]
            dq = bucket[key]
            dq.append(now)
            if len(dq) > limit:
                oldest = dq[0]
                retry_after = max(1, int(self.WINDOW_SECONDS - (now - oldest)))
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": "Rate limit exceeded. Too many mutating requests; slow down or retry later.",
                        "retry_after_seconds": retry_after,
                    },
                    headers={"Retry-After": str(retry_after)},
                )

        return await call_next(request)
