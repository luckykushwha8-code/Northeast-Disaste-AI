import os
import re
import time
import json
import ipaddress
import logging
import datetime
from urllib.parse import urlparse
from typing import Optional, Dict, Any, List, Tuple
import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.models.entities import TinyFishRetrievalRecord

logger = logging.getLogger("tinyfish")

# Sliding window rate limiter
class SlidingWindowRateLimiter:
    def __init__(self, max_requests: int = 30, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.timestamps: List[float] = []

    def allow_request(self) -> Tuple[bool, int]:
        now = time.time()
        # Filter timestamps within current window
        cutoff = now - self.window_seconds
        self.timestamps = [ts for ts in self.timestamps if ts > cutoff]
        
        if len(self.timestamps) < self.max_requests:
            self.timestamps.append(now)
            remaining = self.max_requests - len(self.timestamps)
            return True, remaining
        
        return False, 0

    def remaining_quota(self) -> int:
        now = time.time()
        cutoff = now - self.window_seconds
        self.timestamps = [ts for ts in self.timestamps if ts > cutoff]
        return max(0, self.max_requests - len(self.timestamps))

_rate_limiter = SlidingWindowRateLimiter(
    max_requests=settings.TINYFISH_RATE_LIMIT_PER_MINUTE,
    window_seconds=60
)

class TinyFishService:
    def __init__(self):
        self.api_key = settings.TINYFISH_API_KEY or os.environ.get("TINYFISH_API_KEY", "")
        self.api_url = settings.TINYFISH_API_URL or "https://api.fetch.tinyfish.ai"
        self.timeout = settings.TINYFISH_TIMEOUT_SECONDS
        self.approved_domains = settings.TINYFISH_APPROVED_DOMAINS

    def is_configured(self) -> bool:
        return bool(self.api_key and self.api_key.strip())

    def get_masked_key(self) -> Optional[str]:
        if not self.is_configured():
            return None
        key = self.api_key.strip()
        if len(key) <= 6:
            return "tf_***"
        return f"{key[:3]}...{key[-3:]}"

    def get_status(self, db: Session) -> Dict[str, Any]:
        """
        Reports integration status without revealing credentials.
        """
        configured = self.is_configured()
        remaining = _rate_limiter.remaining_quota()
        
        # Check last retrieval in database
        last_record = db.query(TinyFishRetrievalRecord).order_by(TinyFishRetrievalRecord.retrieval_timestamp.desc()).first()
        total_count = db.query(TinyFishRetrievalRecord).count()

        status_str = "READY" if configured else "UNAVAILABLE"
        if remaining == 0:
            status_str = "RATE_LIMITED"

        return {
            "configured": configured,
            "status": status_str,
            "endpoint": self.api_url,
            "key_present": configured,
            "key_preview": self.get_masked_key(),
            "timeout_seconds": self.timeout,
            "rate_limit_per_minute": settings.TINYFISH_RATE_LIMIT_PER_MINUTE,
            "rate_limit_remaining": remaining,
            "approved_domains": self.approved_domains,
            "last_retrieval_at": last_record.retrieval_timestamp if last_record else None,
            "total_retrievals_count": total_count,
            "simulation_mode": not configured
        }

    def validate_url(self, url: str) -> Tuple[bool, str, str]:
        """
        Strict validation against domain allowlist and SSRF protection.
        Returns: (is_valid, domain, error_message)
        """
        if not url or not isinstance(url, str):
            return False, "", "URL must be a non-empty string."

        try:
            parsed = urlparse(url.strip())
        except Exception:
            return False, "", "Malformed URL structure."

        # Scheme check
        if parsed.scheme not in ("http", "https"):
            return False, "", f"Invalid scheme '{parsed.scheme}'. Only HTTP and HTTPS are permitted."

        hostname = (parsed.hostname or "").lower().strip()
        if not hostname:
            return False, "", "URL missing valid hostname."

        # Disallow IP addresses directly to avoid SSRF
        try:
            ipaddress.ip_address(hostname)
            return False, hostname, "Direct IP address access is disallowed. Only approved domain names are permitted."
        except ValueError:
            pass  # It's a hostname, not a raw IP address

        # Disallow localhost and internal aliases
        if hostname in ("localhost", "local", "internal", "0.0.0.0", "broadcasthost"):
            return False, hostname, "Localhost and internal network addresses are strictly prohibited."

        # Port validation: only standard HTTP/HTTPS allowed
        if parsed.port and parsed.port not in (80, 443):
            return False, hostname, f"Custom port {parsed.port} is not permitted. Only standard web ports (80/443) are allowed."

        # Strict Domain Allowlist check
        is_allowed = False
        for approved in self.approved_domains:
            approved = approved.lower().strip()
            if hostname == approved or hostname.endswith("." + approved):
                is_allowed = True
                break

        if not is_allowed:
            return False, hostname, (
                f"Domain '{hostname}' is not in the approved government disaster monitoring allowlist. "
                f"Permitted agencies: IMD (*.imd.gov.in), CWC (*.cwc.gov.in, *.india-water.gov.in), "
                f"GSI (*.gsi.gov.in, bhusanket.gsi.gov.in), ISRO Bhuvan (*.nrsc.gov.in)."
            )

        return True, hostname, ""

    def determine_agency(self, domain: str) -> str:
        d = domain.lower()
        if "imd.gov.in" in d:
            return "IMD"
        if "india-water.gov.in" in d or "cwc.gov.in" in d:
            return "CWC"
        if "gsi.gov.in" in d or "bhusanket" in d:
            return "GSI"
        if "nrsc.gov.in" in d or "bhuvan" in d:
            return "NRSC_BHUVAN"
        return "OTHER"

    def execute_retrieval(
        self,
        url: str,
        db: Session,
        content_format: str = "markdown",
        purpose: Optional[str] = None,
        simulate_if_unavailable: bool = True
    ) -> TinyFishRetrievalRecord:
        """
        Executes an approved web content retrieval task via TinyFish Fetch API.
        Applies allowlist validation, rate limiting, timeouts, bounded retries,
        and saves traceable records to the database.
        """
        now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

        # 1. Validate Target URL
        valid, domain, err = self.validate_url(url)
        if not valid:
            record = TinyFishRetrievalRecord(
                source_url=url,
                target_domain=domain or "unknown",
                source_agency="UNKNOWN",
                retrieval_timestamp=now,
                content_format=content_format,
                data_quality_status="FAILED",
                simulation_flag=False,
                data_classification="EXTRACTED_WEB_INFORMATION",
                http_status=400,
                error_message=err
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            raise ValueError(err)

        agency = self.determine_agency(domain)

        # 2. Rate Limiting Check
        allowed, remaining = _rate_limiter.allow_request()
        if not allowed:
            err_msg = "Rate limit exceeded (30 requests/minute). Please back off before requesting further extractions."
            record = TinyFishRetrievalRecord(
                source_url=url,
                target_domain=domain,
                source_agency=agency,
                retrieval_timestamp=now,
                content_format=content_format,
                data_quality_status="FAILED",
                simulation_flag=False,
                data_classification="EXTRACTED_WEB_INFORMATION",
                http_status=429,
                error_message=err_msg
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            raise RuntimeError(err_msg)

        # 3. Handle Missing Credentials / Simulation Mode
        if not self.is_configured():
            if not simulate_if_unavailable:
                err_msg = "TinyFish API credentials (TINYFISH_API_KEY) are not configured on this server."
                record = TinyFishRetrievalRecord(
                    source_url=url,
                    target_domain=domain,
                    source_agency=agency,
                    retrieval_timestamp=now,
                    content_format=content_format,
                    data_quality_status="FAILED",
                    simulation_flag=False,
                    data_classification="EXTRACTED_WEB_INFORMATION",
                    http_status=503,
                    error_message=err_msg
                )
                db.add(record)
                db.commit()
                db.refresh(record)
                raise ConnectionError(err_msg)

            # Return realistic verified sandbox fixture for the requested domain
            sim_record = self._build_simulation_fixture(url, domain, agency, content_format, now)
            db.add(sim_record)
            db.commit()
            db.refresh(sim_record)
            return sim_record

        # 4. Live TinyFish Fetch API Call with Bounded Retries
        payload = {
            "urls": [url],
            "format": content_format if content_format in ("markdown", "html", "json") else "markdown",
            "links": False
        }
        if purpose:
            payload["purpose"] = purpose[:2000]

        headers = {
            "X-API-Key": self.api_key.strip(),
            "Content-Type": "application/json"
        }

        max_retries = 2
        last_exception = None
        response_json = None
        status_code = None

        for attempt in range(max_retries + 1):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    resp = client.post(self.api_url, headers=headers, json=payload)
                    status_code = resp.status_code

                    # If 4xx client error, don't retry
                    if 400 <= status_code < 500:
                        try:
                            err_body = resp.json()
                            msg = err_body.get("message") or err_body.get("error") or f"HTTP {status_code}"
                        except Exception:
                            msg = f"HTTP {status_code}"
                        raise httpx.HTTPStatusError(
                            f"TinyFish returned client error ({status_code}): {msg}",
                            request=resp.request,
                            response=resp
                        )

                    resp.raise_for_status()
                    response_json = resp.json()
                    break

            except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as e:
                last_exception = e
                if attempt < max_retries and not (isinstance(e, httpx.HTTPStatusError) and 400 <= e.response.status_code < 500):
                    time.sleep(0.5 * (attempt + 1))  # Exponential backoff
                    continue
                break

        # Check if live call failed
        if response_json is None:
            safe_error = "Upstream TinyFish service unavailable or request timed out."
            if isinstance(last_exception, httpx.HTTPStatusError):
                safe_error = f"TinyFish extraction failed with upstream status {status_code}."
            elif isinstance(last_exception, httpx.TimeoutException):
                safe_error = f"TinyFish request timed out after {self.timeout}s."

            record = TinyFishRetrievalRecord(
                source_url=url,
                target_domain=domain,
                source_agency=agency,
                retrieval_timestamp=now,
                content_format=content_format,
                data_quality_status="FAILED",
                simulation_flag=False,
                data_classification="EXTRACTED_WEB_INFORMATION",
                http_status=status_code or 504,
                error_message=safe_error
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            raise ConnectionError(safe_error)

        # 5. Parse and Validate TinyFish Response Schema
        # Documented schema: {"results": [{"url": ..., "title": ..., "text": ..., "description": ...}], "errors": []}
        results = response_json.get("results")
        if not isinstance(results, list) or len(results) == 0:
            errors_list = response_json.get("errors") or []
            err_msg = f"TinyFish returned no results. Upstream errors: {errors_list}"
            record = TinyFishRetrievalRecord(
                source_url=url,
                target_domain=domain,
                source_agency=agency,
                retrieval_timestamp=now,
                content_format=content_format,
                data_quality_status="FAILED",
                simulation_flag=False,
                data_classification="EXTRACTED_WEB_INFORMATION",
                http_status=200,
                error_message=err_msg
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            raise ValueError(err_msg)

        first_res = results[0]
        extracted_text = first_res.get("text") or first_res.get("content") or ""
        title = first_res.get("title") or f"{agency} Published Data Extraction"
        
        # Check publication timestamp if extractable
        pub_time = self._extract_publication_timestamp(extracted_text)

        # Save successful extraction to database
        record = TinyFishRetrievalRecord(
            source_url=url,
            target_domain=domain,
            source_agency=agency,
            retrieval_timestamp=now,
            publication_timestamp=pub_time,
            title=title[:255] if title else None,
            extracted_text=extracted_text,
            content_format=first_res.get("format", content_format),
            data_quality_status="VALID",
            simulation_flag=False,
            data_classification="EXTRACTED_WEB_INFORMATION",
            http_status=200,
            metadata_json=json.dumps({
                "description": first_res.get("description"),
                "language": first_res.get("language", "en"),
                "final_url": first_res.get("final_url", url)
            })
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record

    def _extract_publication_timestamp(self, text: str) -> Optional[datetime.datetime]:
        """Attempts to parse published dates in standard government bulletin formats."""
        if not text:
            return None
        # Match common date formats e.g. "Date: 19-10-2026" or "19 October 2026" or "2026-10-19"
        patterns = [
            r'(\d{4}-\d{2}-\d{2})',
            r'(\d{2}[-/]\d{2}[-/]\d{4})',
        ]
        for p in patterns:
            m = re.search(p, text)
            if m:
                d_str = m.group(1)
                for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
                    try:
                        return datetime.datetime.strptime(d_str, fmt)
                    except ValueError:
                        pass
        return None

    def _build_simulation_fixture(
        self,
        url: str,
        domain: str,
        agency: str,
        content_format: str,
        timestamp: datetime.datetime
    ) -> TinyFishRetrievalRecord:
        """
        Creates a clearly watermarked sandbox fixture for demonstration when credentials are unset.
        """
        if agency == "IMD":
            title = "IMD Regional Meteorological Centre Guwahati — District Warning Bulletin (Simulation Fixture)"
            text = (
                "# India Meteorological Department (IMD) — Regional Warning Bulletin\n\n"
                "> **NOTICE**: [SIMULATION SANDBOX FIXTURE] Real TinyFish API key is not configured.\n"
                "> Published by RMC Guwahati for Northeast India Catchments.\n\n"
                "- **Bulletin Date**: 19-10-2026 08:30 IST\n"
                "- **Monitored District**: Kamrup Metropolitan, Assam\n"
                "- **Warning Color Code**: ORANGE (Be Prepared)\n"
                "- **Forecast**: Heavy to very heavy rainfall (70mm - 110mm / 24h) accompanied by gusty winds.\n"
                "- **Hazard Advisory**: Rapid surface runoff and localized waterlogging expected in Guwahati lowlands.\n"
            )
        elif agency == "CWC":
            title = "Central Water Commission (CWC) — Daily Flood Hydrograph at Pandu (Simulation Fixture)"
            text = (
                "# Central Water Commission (CWC) — National Flood Forecasting Network\n\n"
                "> **NOTICE**: [SIMULATION SANDBOX FIXTURE] Real TinyFish API key is not configured.\n"
                "> Telemetry Node: 022-MBAPU (Brahmaputra at Pandu Ghat, Guwahati)\n\n"
                "- **Gauge Reading**: 49.82 m (Warning: 48.68m, Danger: 49.68m, HFL: 51.46m)\n"
                "- **Status**: 0.14m ABOVE DANGER LEVEL\n"
                "- **Trend**: Rising at +0.12 m/hr\n"
                "- **Upstream Discharge**: 42,500 m³/s recorded at Tezpur and Dibrugarh stations.\n"
            )
        elif agency == "GSI":
            title = "Geological Survey of India (GSI) — Bhusanket Slope Stability Advisory (Simulation Fixture)"
            text = (
                "# Geological Survey of India (GSI) — Bhusanket Portal\n\n"
                "> **NOTICE**: [SIMULATION SANDBOX FIXTURE] Real TinyFish API key is not configured.\n"
                "> National Landslide Susceptibility Mapping (NLSM) — Guwahati Urban Slopes\n\n"
                "- **Sector**: Nilachal, Kharghuli, and Narakasur Hills\n"
                "- **Susceptibility Score**: 0.88 (VERY HIGH)\n"
                "- **Threshold Condition**: 72-hour antecedent rainfall exceeding 120mm triggers critical pore pressure.\n"
                "- **Advisory**: Precautionary evacuation advised for habitations situated below excavated cuts.\n"
            )
        else:
            title = f"{agency} Published Environmental Bulletin (Simulation Fixture)"
            text = (
                f"# {agency} Environmental Observation\n\n"
                "> **NOTICE**: [SIMULATION SANDBOX FIXTURE] Real TinyFish API key is not configured.\n"
                f"- **Target URL**: {url}\n"
                f"- **Domain**: {domain}\n"
                "- **Status**: Verified regional baseline data.\n"
            )

        return TinyFishRetrievalRecord(
            source_url=url,
            target_domain=domain,
            source_agency=agency,
            retrieval_timestamp=timestamp,
            publication_timestamp=timestamp,
            title=title,
            extracted_text=text,
            content_format=content_format,
            data_quality_status="VALID",
            simulation_flag=True,
            data_classification="SYNTHETIC_DEMO_DATA",
            http_status=200,
            metadata_json=json.dumps({
                "sandbox_fixture": True,
                "reason": "TINYFISH_API_KEY not configured. Generated faithful simulation fixture."
            })
        )

tinyfish_service = TinyFishService()
