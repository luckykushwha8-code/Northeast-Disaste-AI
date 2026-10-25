# Data source and provenance policy

NE-SAFE must label source, observation/retrieval time, location, units and quality whenever supplied by the source. Never infer that a whole map is live from one source's health status. Missing, stale, simulated, forecast, reference and observed records are different data states.

## Historical local status (2026-10-25)

The API process reported the statuses below during the 2026-10-25 audit. They describe that process at that time, not current provider availability. On 2026-10-26, no local API process was listening, so these statuses could not be refreshed.

| Feed | Last status | Interpretation |
|---|---|---|
| IMD | FAILED | No usable IMD feed was reported; local API key is not configured. Do not substitute synthetic readings. |
| CWC | OPERATIONAL | Feed status was operational. Verify individual station records and timestamps before displaying a measurement as current. |
| GSI | OPERATIONAL | A health response does not establish that all susceptibility polygons are live or official; identify the exact dataset and provenance. |
| Bhuvan | DELAYED | Treat related data as delayed/stale, not live. |
| Smart City synthetic IoT | STALE | Synthetic source; never use as verified field telemetry. |
| Map boundaries | Local GeoJSON asset | Geographic reference boundaries, not a hazard observation. |
| Map basemap | External tile service | Requires network/tile access; it is visual context, not hazard evidence. |

## Frontend and backend rules

- Mark demo/synthetic records explicitly at record level. A demo marker can be shown for development but must not affect the risk engine or be styled as an official observation.
- Exclude simulated and invalid observations from risk calculations.
- Keep stale records visible only with an unmistakable stale timestamp/status; use unknown where no usable input exists.
- Keep weather observations distinct from forecasts and model/reference layers.
- Preserve units, source attribution, observed-at and retrieved-at timestamps through API responses and map popovers.
- Email success means provider acceptance only when a provider confirms acceptance; never claim inbox delivery without evidence.

## Integration requirements

Before marking any feed LIVE, verify the feed contract, geographic coverage, exact record values, location matching, time zone, update cadence, units, quality flags, timeout behavior, caching and attribution. For credentials and unresolved items see [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md).
