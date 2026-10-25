import type { LngLatBoundsLike } from 'maplibre-gl';

// --- MapTiler key helper ---
const MAPTILER_KEY = (import.meta as any).env?.VITE_MAPTILER_API_KEY || '';

/** True when a MapTiler key is configured in the environment. */
export const hasMapTilerKey = (): boolean => MAPTILER_KEY.length > 0;

/**
 * Returns a MapTiler vector style URL for the given style name.
 * Falls back to `null` if no key is configured.
 */
export const mapTilerStyleUrl = (
  style: 'streets-v2' | 'outdoor-v2' | 'satellite' | 'topo-v2' | 'basic-v2' = 'streets-v2'
): string | null => {
  if (!MAPTILER_KEY) return null;
  return `https://api.maptiler.com/maps/${style}/style.json?key=${MAPTILER_KEY}`;
};

// Shared MapLibre base style providers.
// MapTiler gives beautiful vector basemaps when a key is configured;
// OSM raster tiles are the fallback; Esri satellite is always available.
export type BaseMapProvider = 'MAPTILER_STREETS' | 'MAPTILER_OUTDOOR' | 'MAPTILER_TOPO' | 'OSM' | 'SATELLITE';

export const NE_BOUNDS: LngLatBoundsLike = [
  [87.6, 21.7],
  [97.6, 28.8]
];

export const NE_CENTER: [number, number] = [93.0, 26.1];
export const NE_ZOOM = 5.8;

export interface BaseStyleOptions {
  base: BaseMapProvider;
  /** District label raster/vector styling hook — kept for future hillshade */
  hillshade?: boolean;
}

/**
 * Build the initial MapLibre style. When MapTiler is selected and the key is
 * present, returns a MapTiler style URL string (MapLibre resolves it). When
 * OSM or satellite is selected, returns a raster-tile style object.
 *
 * If MapTiler is selected but the key is missing, silently falls back to OSM.
 */
export const buildBaseStyle = ({ base }: BaseStyleOptions): any => {
  // MapTiler vector styles — return the URL directly; MapLibre will fetch it.
  if (base === 'MAPTILER_STREETS' || base === 'MAPTILER_OUTDOOR' || base === 'MAPTILER_TOPO') {
    const styleMap: Record<string, 'streets-v2' | 'outdoor-v2' | 'topo-v2'> = {
      MAPTILER_STREETS: 'streets-v2',
      MAPTILER_OUTDOOR: 'outdoor-v2',
      MAPTILER_TOPO: 'topo-v2',
    };
    const url = mapTilerStyleUrl(styleMap[base]);
    if (url) return url;
    // Key missing — fall through to OSM
  }

  if (base === 'SATELLITE') {
    const satUrl = mapTilerStyleUrl('satellite');
    if (satUrl) return satUrl;
    // Fall back to Esri raster if no MapTiler key
    return {
      version: 8,
      sources: {
        satellite: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Esri, Maxar, Earthstar Geographics'
        }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0f172a' } },
        { id: 'satellite-base', type: 'raster', source: 'satellite' }
      ]
    };
  }

  // Default: OSM raster tiles (no key required)
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors'
      }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0f172a' } },
      { id: 'osm-base', type: 'raster', source: 'osm' }
    ]
  };
};

// Terrain-first styling makes the region's river corridors and steep relief
// legible at the overview scale used by this hazard map.
/** Returns the terrain-focused MapTiler base when configured, otherwise OSM. */
export const defaultBaseProvider = (): BaseMapProvider => (hasMapTilerKey() ? 'MAPTILER_TOPO' : 'OSM');

/** Human-friendly label for the basemap selector. */
export const baseProviderLabel = (p: BaseMapProvider): string => ({
  MAPTILER_STREETS: 'MapTiler Streets',
  MAPTILER_OUTDOOR: 'MapTiler Outdoor',
  MAPTILER_TOPO: 'MapTiler Topo',
  OSM: 'OpenStreetMap',
  SATELLITE: 'Satellite',
})[p];

/**
 * Explicit platform-district -> boundary-dataset alias table. Mirrors
 * backend/app/services/geographic_service.py (documented approximation).
 * "Kamrup Metropolitan" is served by the legacy undivided 'Kamrup' polygon;
 * "Imphal East"/"Imphal West" by the dataset's 'East Imphal'/'West Imphal'.
 * Anything not matching here or by exact name is UNKNOWN (never shaded).
 */
export const PLATFORM_DISTRICT_ALIASES: Record<string, string[]> = {
  'Kamrup Metropolitan': ['Kamrup'],
  'Imphal East': ['East Imphal'],
  'Imphal West': ['West Imphal']
};

export interface DistrictSummary {
  district: string;
  state: string | null;
  monitored_locations: { id: string; name: string; type: string; latitude: number; longitude: number }[];
  observed_rainfall_24h: { value: number; unit: string; observed_at: string; age_hours: number; location: string } | null;
  rainfall_status: 'FRESH' | 'STALE' | 'MISSING';
  river_level_all_locations: { value: number; unit: string; observed_at: string; age_hours: number; location: string }[];
  flood_risk: { risk_category: string; probability: number | null; confidence: number | null; uncertainty: string; model: string; engine?: string; reason?: string };
  flood_explanations: string[];
  rainfall_24h_all_locations?: { value: number | null; unit: string; observed_at: string; age_hours: number; location: string; location_id: string; provenance?: string | null; source_id?: string | null; simulation_flag?: boolean; quality_status?: string }[];
  landslide_risk: { risk_category: string; probability: number | null; confidence: number | null; uncertainty: string; model: string; engine?: string; reason?: string };
  landslide_explanations: string[];
  official_warnings: {
    alert_id: string;
    source: string;
    title: string;
    description: string;
    severity: string;
    lifecycle_status: string;
    issued_at: string | null;
    expires_at: string | null;
    official_source_reference: string | null;
    action_instructions: string;
  }[];
  official_warning_count: number;
  incidents_total: number;
  incidents_verified: number;
  latest_incident: { location_name: string; category: string; verification_status: string; report_time: string; description: string } | null;
  shelters_count: number;
  boundary: { status: 'EXACT' | 'APPROXIMATED' | 'SPLIT' | 'UNKNOWN'; boundary_name?: string; note?: string | null };
  data_quality: {
    rainfall: 'FRESH' | 'STALE' | 'MISSING';
    river: 'FRESH' | 'STALE' | 'MISSING';
    risk: 'PROTOTYPE_MODEL';
    official_warnings: 'OFFICIAL' | 'NONE';
    missing_inputs: string[];
  };
}

export interface MapDistrictsResponse {
  engine: string;
  generated_at: string;
  freshness_policy: { weather_hours: number; river_hours: number };
  geodata: Record<string, unknown>;
  terminology: Record<string, string>;
  districts: DistrictSummary[];
}

/** Resolve a platform district name to the boundary-feature name (or null). */
export function boundaryNameFor(platform: string): string | null {
  if (PLATFORM_DISTRICT_ALIASES[platform]) return PLATFORM_DISTRICT_ALIASES[platform][0];
  return platform;
}

export const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH: '#f97316',
  MODERATE: '#f59e0b',
  LOW: '#10b981',
  UNKNOWN: '#94a3b8',
  UNAVAILABLE: '#64748b'
};

export const severityRank = (cat: string): number =>
  ({ UNKNOWN: 0, LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 } as Record<string, number>)[cat] ?? 0;
