from pydantic_settings import BaseSettings
from typing import List, Optional

class Settings(BaseSettings):
    APP_NAME: str = "NE-SAFE AI"
    APP_VERSION: str = "1.0.0"
    APP_ENV: str = "development"
    API_V1_PREFIX: str = "/api/v1"
    
    # Database
    DATABASE_URL: str = "sqlite:///./ne_safe.db"
    
    # Origins & Remote Government Services
    FRONTEND_ORIGIN: str = "http://localhost:5173"
    IMD_BASE_URL: str = "https://api.imd.gov.in"
    IMD_API_KEY: str = ""
    # Official docs do not state the auth transport; configurable until the first
    # live probe confirms it (header style: named header; query style: ?api-key=)
    IMD_API_AUTH_STYLE: str = "header"          # "header" or "query"
    IMD_API_HEADER_NAME: str = "key"            # header name used when style is "header"
    IMD_TIMEOUT_SECONDS: int = 12
    IMD_RETRY_COUNT: int = 1
    IMD_RAINFALL_TTL_MINUTES: int = 60          # rainfall dataset cadence ~ daily, cache gently
    IMD_WARNING_TTL_MINUTES: int = 60           # official district warnings cadence
    IMD_NOWCAST_TTL_MINUTES: int = 15           # nowcast refreshes ~3-hourly at IMD
    IMD_QPF_TTL_MINUTES: int = 120              # river-basin QPF cadence
    IMD_AWS_TTL_MINUTES: int = 15               # AWS/ARG stations report ~ hourly
    CWC_BASE_URL: str = "https://ffs.india-water.gov.in/"
    CWC_FFS_ABOVE_WARNING_API: str = "https://ffs.india-water.gov.in/ffm/api/station-water-level-above-warning/"
    GSI_BASE_URL: str = "https://bhusanket.gsi.gov.in/"
    REQUEST_TIMEOUT_SECONDS: int = 10

    # Northeast regional news outlets for live disaster news retrieval
    NEWS_APPROVED_DOMAINS: List[str] = [
        "eastmojo.com",
        "sentinelassam.com"
    ]
    NEWS_SOURCES: List[str] = [
        "https://www.eastmojo.com/category/news/",
        "https://www.sentinelassam.com/north-east-india"
    ]

    # TinyFish Web Extraction & Agent Integration
    TINYFISH_API_KEY: Optional[str] = None
    TINYFISH_API_URL: str = "https://api.fetch.tinyfish.ai"
    TINYFISH_TIMEOUT_SECONDS: int = 15
    TINYFISH_RATE_LIMIT_PER_MINUTE: int = 30
    TINYFISH_APPROVED_DOMAINS: List[str] = [
        "imd.gov.in",
        "mausam.imd.gov.in",
        "api.imd.gov.in",
        "rsmcnewdelhi.imd.gov.in",
        "cwc.gov.in",
        "ffs.india-water.gov.in",
        "india-water.gov.in",
        "gsi.gov.in",
        "bhusanket.gsi.gov.in",
        "bhuvan.nrsc.gov.in",
        "nrsc.gov.in",
        "ndma.gov.in",
        "eastmojo.com",
        "sentinelassam.com"
    ]

    # Geography
    DEFAULT_STATE: str = "Assam"
    DEFAULT_DISTRICT: str = "Kamrup Metropolitan"
    DEFAULT_LAT: float = 26.1445
    DEFAULT_LON: float = 91.7362

    # Open-Meteo (key-free public weather service: observed precipitation + forecast)
    OPEN_METEO_ENABLED: bool = True
    OPEN_METEO_API_URL: str = "https://api.open-meteo.com/v1/forecast"
    OPEN_METEO_TIMEOUT_SECONDS: int = 8

    # Background sync scheduler
    AUTO_SYNC_ENABLED: bool = True
    AUTO_SYNC_INTERVAL_MINUTES: int = 30

    # Security: per-IP limit for mutating (POST) API requests, sliding 60 s window
    RATE_LIMIT_POST_PER_MINUTE: int = 30

    # Operator/responder login. Accounts are provisioned as PBKDF2 hashes in
    # AUTH_USERS_JSON; no demo passwords or roles are enabled by default.
    AUTH_SECRET_KEY: str = ""
    AUTH_USERS_JSON: str = "{}"
    AUTH_TOKEN_TTL_MINUTES: int = 480

    # ---- Automatic public alert emails (disabled until validated) ----
    # Master switch: resident + authority email dispatch stays OFF until the data
    # sources and risk model are independently validated (never enabled to
    # "make it work"). SMTP acceptance is recorded as ACCEPTED_BY_PROVIDER, not
    # "delivered" — inbox arrival is never claimed without provider evidence.
    PUBLIC_ALERTS_ENABLED: bool = False
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    FROM_EMAIL: str = "ne-safe-ai@noreply.example.org"
    SMTP_TIMEOUT_SECONDS: int = 15
    # Guard: never dispatch from stale observations (hours since newest related obs)
    ALERT_MAX_STALE_HOURS: float = 3.0
    # JSON object of {"District": ["email1", ...]} — verified district authority
    # contacts. Managed by administrators, never self-subscribable. Placeholder
    # domains are dropped (never sent); no default contacts are fabricated here.
    AUTHORITY_CONTACTS_JSON: str = "{}"

    # Freshness Policy (in hours)
    FRESHNESS_WEATHER_HOURS: float = 6.0
    FRESHNESS_RIVER_HOURS: float = 2.0
    FRESHNESS_SENSOR_HOURS: float = 1.0
    
    # Demo & Safety
    ALLOW_SIMULATION: bool = True
    SIMULATION_WATERMARK: str = "SIMULATION DATA — NOT AN OFFICIAL WARNING"
    
    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ]

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
