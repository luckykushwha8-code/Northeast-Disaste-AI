# Contributing to NE-SAFE AI

Thank you for your interest in contributing to NE-SAFE AI! This early-warning and response platform is built for communities and disaster response authorities in Northeast India.

---

## 1. Core Principles

Before writing code, please understand the system principles:
1. **Safety before automation**: AI outputs are advisory (`PROPOSED`) until authorized human operators approve them.
2. **Evidence before prediction**: All risk scores cite observation provenance, CWC danger thresholds, or GSI baseline susceptibility.
3. **No fabricated data**: If an external API or gauge telemetry is unavailable, surface `UNAVAILABLE`, `STALE`, or `MISSING` honestly. Never invent readings.
4. **Official warnings remain authoritative**: Official IMD/CWC bulletins are displayed verbatim with official badges.
5. **Protect secrets**: Never commit `.env` files or API keys.

---

## 2. Development Setup

### Backend (Python 3.11+)
```bash
# Set up virtual environment
python -m venv venv
.\venv\Scripts\activate   # Windows (or source venv/bin/activate on Linux/macOS)

# Install dependencies
pip install -r backend/requirements.txt

# Configure environment
cp .env.example .env

# Run database seed and tests
pytest backend/tests/ -v

# Start backend server
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

### Frontend (React 19 + TypeScript + Vite)
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

---

## 3. Pull Request Guidelines

1. **Keep checks green**:
   - Backend tests: `pytest` (all 85 tests must pass).
   - Frontend build & typecheck: `npm run build` in `frontend/` must complete with zero errors.
   - Frontend lint: `npm run lint` must pass.
2. **Contract preservation**: If modifying backend endpoints, update `docs/API_CONTRACT.md` and regenerate TypeScript types via `npx openapi-typescript`.
3. **Branch naming**: Use descriptive prefixes like `feat/`, `fix/`, or `docs/`.
