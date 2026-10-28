from pydantic import field_validator
from pydantic_settings import BaseSettings
from typing import List, Optional

class Settings(BaseSettings):
    APP_NAME: str = "NE-SAFE AI"
    APP_VERSION: str = "1.0.0"
    APP_ENV: str = "development"
    API_V1_PREFIX: str = "/api/v1"
    PORT: int = 8000
    
    # Database
    DATABASE_URL: str = "sqlite:///./ne_safe.db"
    
    # Origins & Remote Government Services
    FRONTEND_ORIGIN: str = "http://localhost:5173"
    CWC_BASE_URL: str = "https://ffs.india-water.gov.in/"
    CWC_FFS_ABOVE_WARNING_API: str = "https://ffs.india-water.gov.in/ffm/api/station-water-level-above-warning/"
    CWC_REQUEST_TIMEOUT_SECONDS: int = 30
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

    # Current weather provider. Keep this credential on the backend only.
    OPENWEATHER_API_KEY: Optional[str] = None
    OPENWEATHER_API_URL: str = "https://api.openweathermap.org/data/2.5/weather"
    OPENWEATHER_FORECAST_API_URL: str = "https://api.openweathermap.org/data/2.5/forecast"
    OPENWEATHER_TIMEOUT_SECONDS: int = 8
    OPENWEATHER_CACHE_TTL_SECONDS: int = 300
    OPENWEATHER_FORECAST_CACHE_TTL_SECONDS: int = 1800

    @field_validator("OPENWEATHER_API_KEY", mode="before")
    @classmethod
    def normalize_openweather_key(cls, value):
        """Treat blank environment values as unconfigured without logging a secret."""
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    # Optional AI explanation provider. The browser never receives this key.
    OPENROUTER_ENABLED: bool = False
    OPENROUTER_API_KEY: Optional[str] = None
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    OPENROUTER_MODEL: str = "openrouter/auto"
    OPENROUTER_TIMEOUT_SECONDS: int = 12
    OPENROUTER_MAX_TOKENS: int = 700
    OPENROUTER_RATE_LIMIT_PER_MINUTE: int = 8

    @field_validator("OPENROUTER_API_KEY", mode="before")
    @classmethod
    def normalize_openrouter_key(cls, value):
        """Treat blank environment values as unconfigured without logging secrets."""
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

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

    # Gemini is an optional server-side explanation service. It never drives
    # risk results or alert state.
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.8-flash"
    GEMINI_ENABLED: bool = False
    GEMINI_TIMEOUT_SECONDS: int = 15
    GEMINI_RATE_LIMIT_PER_MINUTE: int = 8

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
