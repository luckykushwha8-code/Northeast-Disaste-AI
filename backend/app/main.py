import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from apscheduler.schedulers.background import BackgroundScheduler

from app.config import settings
from app.database import engine, Base, SessionLocal
from app.api.v1.routes import router as api_v1_router
from app.data.seed_data import seed_database

logger = logging.getLogger("nesafe.scheduler")


def run_auto_sync():
    """Background job: refresh all official live feeds + weather context,
    then run the automated alert rule engine over the freshly stored data."""
    db = SessionLocal()
    try:
        from app.services.live_data_service import live_data_service
        result = live_data_service.sync_all(db)
        logger.info("Auto-sync completed: %s", str(result)[:300])
        if settings.OPEN_METEO_ENABLED:
            from app.services.open_meteo_service import open_meteo_service
            from app.models.entities import Location
            for loc in db.query(Location).filter(Location.active == True).all():
                try:
                    open_meteo_service.fetch_forecast(db, loc.id, loc.latitude, loc.longitude)
                except Exception as e:
                    logger.warning("Open-Meteo refresh skipped for %s: %s", loc.id, e)
            db.commit()
        # Automation workflow: validated data -> risk rules -> proposals (deduped)
        from app.services.auto_alert_service import auto_alert_service
        alerts_result = auto_alert_service.evaluate_and_generate_alerts(db)
        logger.info("Auto-alert evaluation: %s", str(alerts_result)[:300])
        # Official IMD REST feeds: rainfall/QPF ingest + verbatim warning import.
        # AUTH_ERROR (no API key provisioned) is expected until credentials exist.
        try:
            from app.api.v1.routes import imd_full_refresh  # reuse the same flow
            from app.auth import Principal
            # Internal scheduled work runs with an explicit system principal;
            # the HTTP endpoint still enforces a real operator/admin token.
            imd_summary = imd_full_refresh(db, Principal(username="system_scheduler", role="ADMIN"))
            logger.info("IMD REST refresh: %s", str(imd_summary)[:300])
        except Exception as e:
            logger.warning("IMD REST refresh skipped: %s", e)
    finally:
        db.close()


def run_daily_report():
    """Scheduled daily job: write on-disk PDF situation report (also auditable)."""
    db = SessionLocal()
    try:
        from app.services.report_service import generate_daily_pdf_to_disk
        path = generate_daily_pdf_to_disk(db)
        logger.info("Daily situation report generated: %s", path)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database tables
    Base.metadata.create_all(bind=engine)
    # Seed initial data
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()

    scheduler = None
    if settings.AUTO_SYNC_ENABLED:
        scheduler = BackgroundScheduler(daemon=True)
        scheduler.add_job(
            run_auto_sync,
            "interval",
            minutes=settings.AUTO_SYNC_INTERVAL_MINUTES,
            id="nesafe_auto_sync",
            max_instances=1,
            coalesce=True
        )
        scheduler.add_job(
            run_daily_report,
            "interval",
            hours=24,
            id="nesafe_daily_report",
            max_instances=1,
            coalesce=True
        )
        scheduler.start()
        logger.info("Auto-sync scheduled every %s minutes + daily report job.",
                    settings.AUTO_SYNC_INTERVAL_MINUTES)
    yield
    if scheduler:
        scheduler.shutdown(wait=False)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="AI-powered disaster risk monitoring and early-warning platform for Northeast India (Floods & Landslides)",
    lifespan=lifespan
)

# CORS Middleware — locked to the configured frontend origin(s), no wildcard+credentials
_allowed_origins = [
    o.strip() for o in settings.FRONTEND_ORIGIN.split(",") if o.strip()
] + settings.CORS_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys(_allowed_origins)),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting: per-IP fixed-window limiter on mutating POST requests under /api/v1
from collections import defaultdict, deque
from app.middleware.rate_limit import PostRateLimitMiddleware
app.state.rate_limit_hits = defaultdict(deque)
app.add_middleware(PostRateLimitMiddleware)

# Mount API routes
app.include_router(api_v1_router, prefix=settings.API_V1_PREFIX)

@app.get("/")
def root():
    return {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs_url": "/docs",
        "study_area": f"{settings.DEFAULT_DISTRICT}, {settings.DEFAULT_STATE}",
        "status": "ONLINE"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
