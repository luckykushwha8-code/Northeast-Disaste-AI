# NE-SAFE AI — Backend Changes Log

This document records any additive or corrective changes made to the backend to support the frontend application contract.

| Date | Endpoint / File | Change Description | Justification | Safety Impact |
|---|---|---|---|---|
| 2026-10-24 | `app/main.py` | Verified CORS allowed origins | Supports `FRONTEND_ORIGIN` (`http://localhost:5173`) with explicit credential support | None; strict origin allowlist maintained |
| 2026-10-24 | `backend/app/api/v1/routes.py` | Added TinyFish extraction endpoints (`/sources/tinyfish/status`, `/sources/tinyfish/retrieve`, `/sources/tinyfish/history`) | Allows approved government disaster web bulletin retrieval | SSRF guardrails & domain allowlist strictly enforced |
