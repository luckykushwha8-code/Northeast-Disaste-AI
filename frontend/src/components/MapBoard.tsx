import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Map as MLMap, Popup, Marker, NavigationControl, ScaleControl, FullscreenControl
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  MapPin, Search, Maximize2, Layers, Info, Clock, Database,
  Mountain, CloudRain, Tent, Megaphone, History,
  ChevronRight, ShieldAlert, AlertTriangle, Compass, CheckCircle2, Play, Pause
} from 'lucide-react';
import {
  buildBaseStyle, NE_BOUNDS, NE_CENTER, NE_ZOOM, boundaryNameFor, SEVERITY_COLORS, severityRank,
  MapDistrictsResponse, DistrictSummary, BaseMapProvider, defaultBaseProvider, baseProviderLabel, hasMapTilerKey
} from './mapStyle';
import { api } from '../api/client';
import { useVisibleRefresh } from '../hooks/useVisibleRefresh';
import {
  LocationItem, AlertItem, ShelterItem, IncidentReportItem, HistoricalEventItem,
  GeoJSONFeatureCollection
} from '../types';
import type { WeatherForecastResponse, WeatherLocationItem } from '../api/client';

interface MapBoardProps {
  locations: LocationItem[];
  alerts: AlertItem[];
  shelters: ShelterItem[];
  reports: IncidentReportItem[];
}

type OverlayKeys =
  | 'boundaries' | 'floodRisk' | 'landslideRisk' | 'officialWarnings'
  | 'rainfall' | 'forecastRain' | 'terrainSusceptibility' | 'shelters' | 'incidents' | 'history';

const DEFAULT_LAYERS: Record<OverlayKeys, boolean> = {
  boundaries: true,
  floodRisk: false,
  // Show one risk surface at a time so overlapping fills never hide each other.
  landslideRisk: true,
  officialWarnings: true,
  rainfall: true,
  forecastRain: true,
  terrainSusceptibility: false,
  shelters: false,
  incidents: true,
  history: false
};

const mapViewportPadding = (extra = 0) => window.innerWidth >= 1280
  ? { top: 32 + extra, right: 300 + extra, bottom: 32 + extra, left: 280 + extra }
  : extra || 24;

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]!));

const GROUPS: { group: string; items: { key: OverlayKeys; label: string; icon: any; color: string }[] }[] = [
  {
    group: 'Base & reference',
    items: [
      { key: 'boundaries', label: 'District boundaries', icon: Layers, color: 'bg-slate-700' }
    ]
  },
  {
    group: 'Risk (prototype model)',
    items: [
      { key: 'floodRisk', label: 'Flood risk shading', icon: ShieldAlert, color: 'bg-blue-600' },
      { key: 'landslideRisk', label: 'Landslide risk shading', icon: Mountain, color: 'bg-amber-600' },
      { key: 'terrainSusceptibility', label: 'Terrain susceptibility', icon: Mountain, color: 'bg-yellow-500' }
    ]
  },
  {
    group: 'Official & weather',
    items: [
      { key: 'officialWarnings', label: 'Official IMD warnings', icon: ShieldAlert, color: 'bg-red-600' },
      { key: 'rainfall', label: '24h rainfall observed', icon: CloudRain, color: 'bg-sky-600' },
      { key: 'forecastRain', label: 'Rain forecast aura · 24h', icon: CloudRain, color: 'bg-blue-600' }
    ]
  },
  {
    group: 'Emergency & verified incidents',
    items: [
      { key: 'shelters', label: 'Verified shelters', icon: Tent, color: 'bg-teal-600' },
      { key: 'incidents', label: 'Citizen incident reports', icon: Megaphone, color: 'bg-orange-500' }
    ]
  },
  {
    group: 'Historical',
    items: [
      { key: 'history', label: 'Validated hazard history', icon: History, color: 'bg-indigo-600' }
    ]
  }
];

export const MapBoard: React.FC<MapBoardProps> = ({ locations, alerts, shelters, reports }) => {
  const navigate = useNavigate();
  const mapContainer = useRef<HTMLDivElement>(null);
  const mlRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [baseProvider, setBaseProvider] = useState<BaseMapProvider>(() => defaultBaseProvider());
  const [styleVersion, setStyleVersion] = useState<number>(0);
  const [mapTilerNotice, setMapTilerNotice] = useState<string | null>(null);
  const [layers, setLayers] = useState<Record<OverlayKeys, boolean>>({ ...DEFAULT_LAYERS });
  const [panelOpen, setPanelOpen] = useState(false);
  const [scenePlaying, setScenePlaying] = useState(false);
  const [compactMap, setCompactMap] = useState(() => window.innerWidth < 640);
  const [mobileMapPanel, setMobileMapPanel] = useState<'layers' | 'district' | 'legend' | null>(null);
  const [opacity, setOpacity] = useState({ risk: 0.72, warnings: 0.6 });
  const [summaries, setSummaries] = useState<MapDistrictsResponse | null>(null);
  const [boundaryData, setBoundaryData] = useState<GeoJSONFeatureCollection | null>(null);
  const [riskGeo, setRiskGeo] = useState<GeoJSONFeatureCollection | null>(null);
  const [history, setHistory] = useState<HistoricalEventItem[]>([]);
  const [weatherLocations, setWeatherLocations] = useState<WeatherLocationItem[]>([]);
  const [weatherForecasts, setWeatherForecasts] = useState<WeatherForecastResponse[]>([]);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [selectedState, setSelectedState] = useState('ALL');
  const [search, setSearch] = useState('');
  const [clock, setClock] = useState<string>(() => new Date().toLocaleTimeString());
  const [statusPill, setStatusPill] = useState<{ label: string; tone: 'ok' | 'warn' | 'down' }>({ label: 'LOADING', tone: 'warn' });
  const [dataMode, setDataMode] = useState<string>('PROTOTYPE');

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const update = () => setCompactMap(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // ---- data loading ----
  const refreshMapData = useCallback(async () => {
    const [summaryResult, riskResult, historyResult] = await Promise.allSettled([
      api.getMapDistricts(), api.getRiskGeo(), api.getHistoricalEvents()
    ]);
    if (summaryResult.status === 'fulfilled') setSummaries(summaryResult.value);
    if (riskResult.status === 'fulfilled') setRiskGeo(riskResult.value);
    if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
  }, []);

  useEffect(() => {
    fetch('/geo/ne_districts.geojson')
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (data) setBoundaryData(data); })
      .catch(() => { /* boundary failure -> districts unshaded, honest */ });
  }, []);
  useEffect(() => { void refreshMapData(); }, [refreshMapData]);
  useVisibleRefresh(refreshMapData, 5 * 60 * 1000);

  const refreshRainForecasts = useCallback(async () => {
    try {
      const { locations: items } = await api.getWeatherLocations();
      setWeatherLocations(items);
      const forecasts = await Promise.allSettled(items.map(item => api.getWeatherForecast(item.id)));
      setWeatherForecasts(forecasts.flatMap(result => result.status === 'fulfilled' ? [result.value] : []));
    } catch {
      setWeatherLocations([]);
      setWeatherForecasts([]);
    }
  }, []);
  useEffect(() => { void refreshRainForecasts(); }, [refreshRainForecasts]);
  useVisibleRefresh(refreshRainForecasts, 15 * 60 * 1000);

  useEffect(() => {
    const iv = setInterval(() => {
      setClock(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!summaries) return;
    const d = summaries.districts;
    const official = d.reduce((n, x) => n + x.official_warning_count, 0);
    const fresh = d.filter(x => x.data_quality.rainfall === 'FRESH').length;
    const staleOrMissing = d.filter(x => x.data_quality.rainfall !== 'FRESH').length;
    let label = `${official} official · ${fresh} fresh data · ${staleOrMissing} stale/missing`;
    let tone: 'ok' | 'warn' | 'down' = official > 0 ? 'ok' : 'warn';
    if (d.length === 0) { label = 'NO DISTRICT DATA'; tone = 'down'; }
    setStatusPill({ label, tone });
    setDataMode(summaries.engine.startsWith('nesafe') ? 'PROTOTYPE' : 'UNKNOWN');
  }, [summaries]);

  // ---- map init ----
  useEffect(() => {
    if (!mapContainer.current || mlRef.current) return;
    const initialProvider = defaultBaseProvider();
    const initialStyle = buildBaseStyle({ base: initialProvider });
    const map = new MLMap({
      container: mapContainer.current,
      style: initialStyle,
      center: NE_CENTER,
      zoom: NE_ZOOM
    });
    map.fitBounds(NE_BOUNDS, { padding: mapViewportPadding(), maxZoom: 7, duration: 600 });
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new FullscreenControl(), 'top-right');
    map.addControl(new ScaleControl(), 'bottom-right');

    const markReady = () => {
      setReady(true);
      try { map.resize(); } catch { /* ignore */ }
    };

    if (map.isStyleLoaded()) {
      markReady();
    } else {
      map.once('load', markReady);
    }
    const safetyTimer = setTimeout(markReady, 1800);

    map.on('error', (e: any) => {
      const msg = String(e?.error?.message || e?.message || '');
      if ((msg.includes('401') || msg.includes('403')) && baseProvider !== 'OSM') {
        console.warn('MapTiler error notice, falling back to OSM:', msg);
        setMapTilerNotice('MapTiler key validation notice: Displaying OpenStreetMap fallback.');
        setBaseProvider('OSM');
        try { map.setStyle(buildBaseStyle({ base: 'OSM' })); } catch { /* ignore */ }
      }
    });

    mlRef.current = map;
    const ro = new ResizeObserver(() => {
      try { map.resize(); } catch { /* ignore */ }
    });
    ro.observe(mapContainer.current);

    return () => {
      clearTimeout(safetyTimer);
      ro.disconnect();
      mlRef.current = null;
      map.remove();
    };
  }, []);

  const summaryByBoundary = useMemo(() => {
    if (!summaries) return new Map<string, DistrictSummary>();
    const m = new Map<string, DistrictSummary>();
    summaries.districts.forEach(s => {
      const bn = boundaryNameFor(s.district);
      if (bn && s.boundary.status !== 'UNKNOWN') m.set(bn, s);
    });
    return m;
  }, [summaries]);

  const boundaryFeatures = useMemo(() => {
    if (!boundaryData?.features) return [];
    return boundaryData.features as any[];
  }, [boundaryData]);

  const stateNames = useMemo(() => {
    const names = new Set<string>();
    boundaryFeatures.forEach((feature: any) => {
      const state = feature.properties?.state;
      if (typeof state === 'string' && state.trim()) names.add(state.trim());
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [boundaryFeatures]);

  const selected = useMemo(
    () => summaries?.districts.find(d => d.district === selectedDistrict && (selectedState === 'ALL' || d.state === selectedState)) ?? null,
    [summaries, selectedDistrict, selectedState]
  );

  const selectedAlerts = useMemo(() => {
    if (!selected) return [];
    const locIds = new Set(selected.monitored_locations.map(l => l.id));
    const active = ['PROPOSED', 'REVIEWED', 'APPROVED', 'ISSUED', 'ACKNOWLEDGED'];
    return alerts.filter(a => locIds.has(a.location_id) && active.includes(a.lifecycle_status));
  }, [alerts, selected]);

  const districtSearchList = useMemo(() => {
    if (!summaries) return [];
    const q = search.trim().toLowerCase();
    return summaries.districts
      .filter(d => selectedState === 'ALL' || d.state === selectedState)
      .filter(d => !q || d.district.toLowerCase().includes(q) || (d.state ?? '').toLowerCase().includes(q));
  }, [summaries, search, selectedState]);

  // ---- overlay rebuild ----
  useEffect(() => {
    const map = mlRef.current;
    if (!map || !ready) return;
    const listeners: { event: string; layer: string; handler: (event: any) => void }[] = [];
    const rainfallMarkers: Marker[] = [];
    const popup = new Popup({ maxWidth: '280px' });
    try {
    const prefixIds = ['ov-'];
    [...map.getStyle().layers.map((l: any) => l.id)]
      .filter(id => prefixIds.some(p => id.startsWith(p)))
      .forEach(id => map.removeLayer(id));
    Object.keys(map.getStyle().sources)
      .filter(s => prefixIds.some(p => s.startsWith(p)))
      .forEach(s => { try { map.removeSource(s); } catch { /* not added */ } });

    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; popup.remove(); };
    const bindLayerEvent = (event: string, layer: string, handler: (event: any) => void) => {
      map.on(event as any, layer, handler as any);
      listeners.push({ event, layer, handler });
    };

    /* -- boundaries: fill clickable + line;UNKNOWN shading stays neutral gray -- */
    const propsOf = (f: any) => {
      const name = f.properties?.district;
      const s = summaryByBoundary.get(name);
      return {
        district: name,
        state: f.properties?.state,
        flood: s?.flood_risk?.risk_category ?? 'UNKNOWN',
        landslide: s?.landslide_risk?.risk_category ?? 'UNKNOWN',
        official: (s?.official_warning_count ?? 0) > 0 ? 'YES' : 'NO',
        official_sev: s?.official_warnings?.[0]?.severity ?? 'NONE',
        rainfall: s?.data_quality?.rainfall ?? 'MISSING',
        rain_mm: s?.observed_rainfall_24h?.value ?? null,
        incidents: s?.incidents_verified ?? 0,
        selected: s?.district === selectedDistrict ? 'YES' : 'NO'
      };
    };
    if (layers.boundaries && boundaryFeatures.length) {
      map.addSource('ov-boundary', { type: 'geojson', data: { type: 'FeatureCollection', features: boundaryFeatures as any } });
      map.addLayer({
        id: 'ov-boundary-fill', type: 'fill', source: 'ov-boundary',
        paint: { 'fill-color': '#334155', 'fill-opacity': 0.02 }
      });
      map.addLayer({
        id: 'ov-boundary-line', type: 'line', source: 'ov-boundary',
        paint: {
          'line-color': ['match', ['get', 'selected'], 'YES', '#2563eb', '#94a3b8'],
          'line-width': ['match', ['get', 'selected'], 'YES', 2.5, 1],
          'line-opacity': 0.85
        }
      });
      bindLayerEvent('click', 'ov-boundary-fill', (e: any) => {
        const p = e.features?.[0]?.properties as any;
        if (!p?.district) return;
        const s = summaryByBoundary.get(p.district);
        if (!s) {
          popup.setLngLat(e.lngLat).setHTML(`
            <div style="font-family:system-ui;min-width:200px">
              <div style="font-weight:800">${escapeHtml(p.district)}</div>
              <div style="font-size:11px;color:#64748b">${escapeHtml(p.state)}</div>
              <div style="font-size:11px;margin-top:4px;color:#b91c1c">
                No platform data for this district — shown as UNKNOWN (never assumed safe).
              </div>
            </div>`).addTo(map);
          return;
        }
        setSelectedDistrict(s.district);
        setSelectedState(s.state ?? 'ALL');
        popup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:system-ui;min-width:230px">
            <div style="font-weight:800;font-size:13px">${escapeHtml(s.district)}</div>
            <div style="font-size:11px;color:#64748b">${escapeHtml(s.state)} · boundary: ${escapeHtml(s.boundary.status)}</div>
            <div style="font-size:11px;margin-top:5px">
              <b>Flood (prototype):</b> ${escapeHtml(s.flood_risk.risk_category)}<br/>
              <b>Landslide (prototype):</b> ${escapeHtml(s.landslide_risk.risk_category)}<br/>
              <b>Official warnings:</b> ${s.official_warning_count ? `${s.official_warning_count} (verbatim IMD)` : 'none received'}
            </div>
            <div style="font-size:10px;color:#64748b;margin-top:4px">
              Rainfall 24h: ${s.observed_rainfall_24h ? `${s.observed_rainfall_24h.value.toFixed(1)}mm (${s.data_quality.rainfall})` : 'no observation'} ·
              Verified incidents: ${s.incidents_verified}
            </div>
          </div>`).addTo(map);
      });
      bindLayerEvent('mouseenter', 'ov-boundary-fill', onEnter);
      bindLayerEvent('mouseleave', 'ov-boundary-fill', onLeave);
    }

    const boundarySelectedProps = boundaryFeatures.map(f => ({
      ...f,
      properties: { ...f.properties, ...propsOf(f) }
    }));
    map.addSource('ov-props', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: boundarySelectedProps as any }
    });

    /* -- FLOOD risk polygon shading (prototype model) -- */
    if (layers.floodRisk) {
      map.addLayer({
        id: 'ov-flood-fill', type: 'fill', source: 'ov-props',
        paint: {
          'fill-color': [
            'match', ['get', 'flood'],
            'CRITICAL', SEVERITY_COLORS.CRITICAL,
            'HIGH', SEVERITY_COLORS.HIGH,
            'MODERATE', SEVERITY_COLORS.MODERATE,
            'LOW', SEVERITY_COLORS.LOW,
            SEVERITY_COLORS.UNKNOWN
          ],
          'fill-opacity': ['match', ['get', 'flood'], 'UNKNOWN', 0.46, 'UNAVAILABLE', 0.46, opacity.risk]
        }
      });
      map.addLayer({
        id: 'ov-flood-outline', type: 'line', source: 'ov-props',
        paint: {
          'line-color': ['match', ['get', 'flood'], 'UNKNOWN', 'rgba(0,0,0,0)', '#1e40af'],
          'line-width': ['match', ['get', 'flood'], 'UNKNOWN', 0, 1.4]
        }
      });
    }

    /* -- LANDSLIDE risk polygon shading (prototype model) -- */
    if (layers.landslideRisk) {
      map.addLayer({
        id: 'ov-landslide-fill', type: 'fill', source: 'ov-props',
        paint: {
          'fill-color': [
            'match', ['get', 'landslide'],
            'CRITICAL', SEVERITY_COLORS.CRITICAL,
            'HIGH', SEVERITY_COLORS.HIGH,
            'MODERATE', SEVERITY_COLORS.MODERATE,
            'LOW', SEVERITY_COLORS.LOW,
            SEVERITY_COLORS.UNKNOWN
          ],
          'fill-opacity': ['match', ['get', 'landslide'], 'UNKNOWN', 0.46, 'UNAVAILABLE', 0.46, opacity.risk]
        }
      });
      map.addLayer({
        id: 'ov-landslide-outline', type: 'line', source: 'ov-props',
        paint: {
          'line-color': [
            'match', ['get', 'landslide'],
            'CRITICAL', '#9f3f38',
            'HIGH', '#b75b35',
            'MODERATE', '#a87525',
            'LOW', '#64836b',
            'rgba(0,0,0,0)'
          ],
          'line-width': ['match', ['get', 'landslide'], 'CRITICAL', 2.8, 'HIGH', 2.2, 'MODERATE', 1.7, 'LOW', 1.1, 0],
          'line-opacity': ['match', ['get', 'landslide'], 'UNKNOWN', 0, 0.9],
          'line-dasharray': [2.4, 1.4]
        }
      });
      const landslideTriggers = (riskGeo?.features ?? []).filter((feature: any) =>
        ['MODERATE', 'HIGH', 'CRITICAL'].includes(feature.properties?.landslide_category)
      );
      if (landslideTriggers.length) {
        map.addSource('ov-landslide-triggers', {
          type: 'geojson', data: { type: 'FeatureCollection', features: landslideTriggers as any }
        });
        map.addLayer({
          id: 'ov-landslide-triggers-core', type: 'circle', source: 'ov-landslide-triggers',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 8, 9],
            'circle-color': ['match', ['get', 'landslide_category'], 'CRITICAL', SEVERITY_COLORS.CRITICAL, 'HIGH', SEVERITY_COLORS.HIGH, 'MODERATE', SEVERITY_COLORS.MODERATE, SEVERITY_COLORS.UNKNOWN],
            'circle-opacity': 0.94,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
          }
        });
        bindLayerEvent('click', 'ov-landslide-triggers-core', (e: any) => {
          const p = e.features?.[0]?.properties;
          if (!p) return;
          popup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:system-ui;min-width:200px">
            <div style="font-size:10px;font-weight:800;letter-spacing:.05em;color:#b45309">LANDSLIDE RISK POINT · PROTOTYPE</div>
            <div style="font-weight:800;font-size:13px">${escapeHtml(p.name)}</div>
            <div style="font-size:11px;color:#64748b">${escapeHtml(p.district)}, ${escapeHtml(p.state)}</div>
            <div style="font-size:12px;margin-top:4px"><b>Assessed category:</b> ${escapeHtml(p.landslide_category)}</div>
            <div style="font-size:10px;color:#64748b;margin-top:3px">${escapeHtml(p.uncertainty || 'Uncertainty not reported')} · generated ${p.generated_at ? new Date(p.generated_at).toLocaleString() : 'time unavailable'}</div>
            <div style="font-size:10px;color:#92400e;margin-top:4px">Prototype model assessment, not an official GSI warning.</div>
          </div>`).addTo(map);
        });
        bindLayerEvent('mouseenter', 'ov-landslide-triggers-core', onEnter);
        bindLayerEvent('mouseleave', 'ov-landslide-triggers-core', onLeave);
      }
    }

    /* -- OFFICIAL IMD warnings polygon highlight (verbatim, distinct styling) -- */
    if (layers.officialWarnings) {
      map.addLayer({
        id: 'ov-official-line', type: 'line', source: 'ov-props',
        paint: {
          'line-color': ['match', ['get', 'official'], 'YES', '#111827', 'rgba(0,0,0,0)'],
          'line-width': ['match', ['get', 'official'], 'YES', 3, 0],
          'line-dasharray': [2, 2]
        }
      });
      map.addLayer({
        id: 'ov-official-fill', type: 'fill', source: 'ov-props',
        paint: {
          'fill-color': [
            'match', ['get', 'official_sev'],
            'CRITICAL', SEVERITY_COLORS.CRITICAL,
            'HIGH', SEVERITY_COLORS.HIGH,
            'MODERATE', SEVERITY_COLORS.MODERATE,
            '#ef4444'
          ],
          'fill-opacity': ['match', ['get', 'official'], 'YES', opacity.warnings, 0]
        }
      });
    }

    /* -- 24h rainfall station labels (only monitored stations with an observation) -- */
    const rainStations = summaries?.districts.filter(d => (selectedState === 'ALL' || d.state === selectedState) && (!selectedDistrict || (d.district === selectedDistrict && d.state === selectedState))).flatMap(d =>
      (d.rainfall_24h_all_locations ?? []).map(r => ({
        id: r.location_id,
        dist: d.district,
        state: d.state,
        name: r.location,
        mm: r.value?.valueOf?.() ?? r.value,
        age: r.age_hours,
        status: r.simulation_flag === true ? 'SIMULATED' : typeof r.simulation_flag !== 'boolean' || r.quality_status !== 'VALID' ? 'UNVERIFIED' : d.data_quality.rainfall,
        observed_at: r.observed_at,
        provenance: r.provenance,
        simulation_flag: Boolean(r.simulation_flag),
        provenance_unknown: typeof r.simulation_flag !== 'boolean' || r.quality_status !== 'VALID',
        location: locations.find(l => l.id === r.location_id)
      }))
    ).filter(s => s.mm != null && Number.isFinite(s.location?.longitude) && Number.isFinite(s.location?.latitude)) ?? [];
    if (layers.rainfall && rainStations.length) {
      rainStations.forEach((s, stationIndex) => {
        const markerButton = document.createElement('button');
        markerButton.type = 'button';
        markerButton.className = `rain-gauge-marker${s.status === 'STALE' ? ' is-stale' : ''}${s.simulation_flag ? ' is-simulated' : ''}${s.provenance_unknown ? ' is-unverified' : ''}`;
        markerButton.setAttribute('aria-label', `${s.name}, ${Number(s.mm).toFixed(1)} millimetres rainfall in 24 hours${s.simulation_flag ? ', simulated record' : s.provenance_unknown ? ', provenance unverified' : ''}`);
        markerButton.classList.toggle('is-animated', scenePlaying);
        markerButton.innerHTML = '<span class="rain-gauge-pin" aria-hidden="true"><svg viewBox="0 0 24 30" focusable="false"><path d="M12 1C5.9 1 1 5.9 1 12c0 7.8 11 17 11 17s11-9.2 11-17C23 5.9 18.1 1 12 1Z"/><circle cx="12" cy="12" r="3.2"/></svg></span>';
        const amount = document.createElement('span');
        amount.className = 'rain-gauge-label';
        amount.textContent = `${Number(s.mm).toFixed(0)} mm`;
        const colocated = rainStations
          .map((other, index) => ({ other, index }))
          .filter(({ other, index }) => index !== stationIndex &&
            Math.abs(other.location!.latitude - s.location!.latitude) < 0.12 &&
            Math.abs(other.location!.longitude - s.location!.longitude) < 0.12);
        if (colocated.length) {
          const slot = colocated.filter(({ index }) => index < stationIndex).length;
          const x = slot % 2 === 0 ? -7 : 13;
          const y = (slot % 2 === 0 ? -1 : 1) * (10 + Math.floor(slot / 2) * 16);
          amount.style.transform = `translate(${x}px, ${y}px)`;
        }
        markerButton.append(amount);
        markerButton.addEventListener('click', event => {
          event.stopPropagation();
          popup.setLngLat([s.location!.longitude, s.location!.latitude]).setHTML(`
          <div style="font-family:system-ui;min-width:200px">
            <div style="font-size:10px;font-weight:800;letter-spacing:.05em;color:#0369a1">RAINFALL 24H OBSERVATION</div>
            <div style="font-weight:800;font-size:13px">${escapeHtml(s.name)}</div>
            <div style="font-size:11px;color:#64748b">${escapeHtml(s.dist)}</div>
            <div style="font-size:12px;margin-top:4px"><b>${Number(s.mm).toFixed(1)} mm</b>
              (${escapeHtml(s.status)}${s.status === 'STALE' ? ` — ${Number(s.age).toFixed(0)}h old` : ''})</div>
            <div style="font-size:10px;color:#64748b;margin-top:3px">observed ${s.observed_at ? new Date(s.observed_at).toLocaleString() : '—'} · recorded source: ${escapeHtml(s.provenance || 'unspecified')}</div>
            ${s.simulation_flag ? '<div style="font-size:10px;color:#92400e;font-weight:700;margin-top:4px">SIMULATED RECORD</div>' : ''}
            ${s.provenance_unknown ? '<div style="font-size:10px;color:#92400e;font-weight:700;margin-top:4px">PROVENANCE OR QUALITY NOT VERIFIED</div>' : ''}
          </div>`).addTo(map);
        });
        rainfallMarkers.push(new Marker({ element: markerButton, anchor: 'bottom' })
          .setLngLat([s.location!.longitude, s.location!.latitude])
          .addTo(map));
      });
    }

    /* -- 24h model forecast triggers: IMD heavy-rain band, clearly advisory -- */
    const forecastPoints = (summaries?.districts ?? []).flatMap(d =>
      (d.forecast_rainfall_24h_all_locations ?? []).map(f => ({ ...f, district: d.district, state: d.state }))
    ).filter(f => f.data_mode === 'LIVE' && f.value_mm >= 64.5 && (selectedState === 'ALL' || f.state === selectedState) && (!selectedDistrict || (f.district === selectedDistrict && f.state === selectedState)) &&
      Number.isFinite(f.longitude) && Number.isFinite(f.latitude));
    if (layers.forecastRain) {
      forecastPoints.forEach(f => {
        const markerButton = document.createElement('button');
        markerButton.type = 'button';
        markerButton.className = 'rain-gauge-marker is-forecast-trigger';
        markerButton.setAttribute('aria-label', `${f.location}, forecast ${f.value_mm.toFixed(1)} millimetres in the next 24 hours`);
        markerButton.innerHTML = '<span class="rain-gauge-pin" aria-hidden="true"><svg viewBox="0 0 24 30" focusable="false"><path d="M12 1C5.9 1 1 5.9 1 12c0 7.8 11 17 11 17s11-9.2 11-17C23 5.9 18.1 1 12 1Z"/><circle cx="12" cy="12" r="3.2"/></svg></span>';
        const amount = document.createElement('span');
        amount.className = 'rain-gauge-label';
        amount.textContent = `${f.value_mm.toFixed(0)} mm forecast`;
        markerButton.append(amount);
        markerButton.addEventListener('click', event => {
          event.stopPropagation();
          popup.setLngLat([f.longitude, f.latitude]).setHTML(`
          <div style="font-family:system-ui;min-width:210px">
            <div style="font-size:10px;font-weight:800;letter-spacing:.05em;color:#6d28d9">HEAVY RAIN MODEL FORECAST · NEXT 24H</div>
            <div style="font-weight:800;font-size:13px">${escapeHtml(f.location)}</div>
            <div style="font-size:11px;color:#64748b">${escapeHtml(f.district)}</div>
            <div style="font-size:13px;margin-top:5px"><b>${Number(f.value_mm).toFixed(1)} mm</b> forecast</div>
            <div style="font-size:10px;color:#64748b;margin-top:3px">Open-Meteo model · retrieved ${f.fetched_at ? new Date(f.fetched_at).toLocaleString() : 'time unavailable'}</div>
            <div style="font-size:10px;color:#92400e;margin-top:4px">Open-Meteo forecast model output; this dashboard trigger is advisory and is not an official IMD warning.</div>
          </div>`).addTo(map);
        });
        rainfallMarkers.push(new Marker({ element: markerButton, anchor: 'bottom' })
          .setLngLat([f.longitude, f.latitude]).addTo(map));
      });
    }

    /* -- provider forecast rain aura: distinct from observed rain and warning risk -- */
    const now = Date.now();
    const rainAuraFeatures = weatherForecasts.flatMap(forecast => {
      const location = weatherLocations.find(item => item.id === forecast.location_id);
      if (!location || (selectedState !== 'ALL' && location.state !== selectedState)) return [];
      if (selectedDistrict) {
        const districtRecord = summaries?.districts.find(item => item.district === selectedDistrict && item.state === selectedState);
        const belongsToDistrict = districtRecord?.monitored_locations.some(site => site.id === location.id) ||
          location.district.toLocaleLowerCase() === selectedDistrict.toLocaleLowerCase();
        if (!belongsToDistrict) return [];
      }
      const retrieved = new Date(forecast.retrieved_at).getTime();
      const ageMs = now - retrieved;
      if (forecast.data_mode === 'UNAVAILABLE' || !Number.isFinite(retrieved) || ageMs < -5 * 60_000 || ageMs > 6 * 60 * 60_000) return [];
      const next24 = forecast.forecast.filter(item => {
        const time = new Date(item.forecast_at).getTime();
        return Number.isFinite(time) && time >= now && time <= now + 24 * 60 * 60_000;
      });
      const rainfall = next24.reduce((sum, item) => sum + Math.max(0, Number(item.rainfall_3h_mm) || 0), 0);
      const probability = next24.reduce((max, item) => Math.max(max, Number(item.precipitation_probability) || 0), 0);
      if (rainfall <= 0 && probability <= 0) return [];
      return [{
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [location.longitude, location.latitude] },
        properties: { id: location.id, name: location.city || location.name, state: location.state, district: location.district,
          rainfall, probability, source: forecast.source, mode: forecast.data_mode, retrieved: forecast.retrieved_at }
      }];
    });
    if (layers.forecastRain && rainAuraFeatures.length) {
      map.addSource('ov-rain-aura', { type: 'geojson', data: { type: 'FeatureCollection', features: rainAuraFeatures } as any });
      map.addLayer({
        id: 'ov-rain-aura-glow', type: 'circle', source: 'ov-rain-aura',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['+', 7, ['min', 14, ['*', ['get', 'rainfall'], 0.16]]], 8, ['+', 12, ['min', 26, ['*', ['get', 'rainfall'], 0.34]]]],
          'circle-color': ['case', ['>=', ['get', 'rainfall'], 64.5], '#7c3aed', ['>=', ['get', 'rainfall'], 20], '#2563eb', '#38bdf8'],
          'circle-opacity': 0.3, 'circle-blur': 0.85
        }
      });
      map.addLayer({
        id: 'ov-rain-aura-center', type: 'circle', source: 'ov-rain-aura',
        paint: { 'circle-radius': 5, 'circle-color': '#2563eb', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' }
      });
      bindLayerEvent('click', 'ov-rain-aura-center', (event: any) => {
        const props = event.features?.[0]?.properties;
        if (!props) return;
        const amount = Number(props.rainfall) || 0;
        const probability = Math.round((Number(props.probability) || 0) * 100);
        popup.setLngLat(event.lngLat).setHTML(`<div style="font-family:system-ui;min-width:210px">
          <div style="font-size:10px;font-weight:800;letter-spacing:.05em;color:#2563eb">RAIN FORECAST AURA · NEXT 24H</div>
          <div style="font-weight:800;font-size:13px">${escapeHtml(props.name)}</div>
          <div style="font-size:11px;color:#64748b">${escapeHtml(props.district)}, ${escapeHtml(props.state)}</div>
          <div style="font-size:12px;margin-top:5px"><b>${amount.toFixed(1)} mm</b> forecast rain · up to <b>${probability}%</b> precipitation probability</div>
          <div style="font-size:10px;color:#64748b;margin-top:3px">${escapeHtml(props.source)} · ${escapeHtml(props.mode)} · retrieved ${new Date(props.retrieved).toLocaleString()}</div>
          <div style="font-size:10px;color:#92400e;margin-top:4px">Provider forecast, not an observed rainfall reading or official warning.</div>
        </div>`).addTo(map);
      });
      bindLayerEvent('mouseenter', 'ov-rain-aura-center', onEnter);
      bindLayerEvent('mouseleave', 'ov-rain-aura-center', onLeave);
    }

    /* -- terrain susceptibility (score circles from /risk/geo) -- */
    if (layers.terrainSusceptibility && riskGeo?.features) {
      const flattened = riskGeo.features.map((f: any) => ({
        ...f,
        properties: {
          ...f.properties,
          susceptibility_score: f.properties?.terrain?.susceptibility_score ?? 0.5,
          slope_deg: f.properties?.terrain?.slope_deg ?? 0
        }
      }));
      map.addSource('ov-terrain', { type: 'geojson', data: { type: 'FeatureCollection', features: flattened } });
      map.addLayer({
        id: 'ov-terrain-halo', type: 'circle', source: 'ov-terrain',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            5, ['*', ['get', 'susceptibility_score'], 55], 9, ['*', ['get', 'susceptibility_score'], 120]],
          'circle-color': ['interpolate', ['linear'], ['get', 'susceptibility_score'],
            0.0, '#38bdf8', 0.5, '#facc15', 0.75, '#f97316', 0.9, '#dc2626'],
          'circle-opacity': 0.22,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#7c2d12'
        }
      });
    }

    /* -- shelters / incidents / history -- */
    if (layers.shelters && shelters.length) {
      map.addSource('ov-shelters', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: shelters.filter(s => s.latitude != null && s.longitude != null).map(s => ({
            type: 'Feature', geometry: { type: 'Point', coordinates: [s.longitude!, s.latitude!] },
            properties: { name: s.name, capacity: s.capacity, occupancy: s.current_occupancy, status: s.operational_status, location_name: s.location_name }
          }))
        }
      });
      map.addLayer({
        id: 'ov-shelters-core', type: 'circle', source: 'ov-shelters',
        paint: { 'circle-radius': 8, 'circle-color': '#16a34a', 'circle-opacity': .9, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
      });
      bindLayerEvent('click', 'ov-shelters-core', (e: any) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        popup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:system-ui;min-width:200px">
            <div style="font-size:10px;font-weight:800;color:#16a34a">VERIFIED SHELTER</div>
            <div style="font-weight:800">${escapeHtml(p.name)}</div>
            <div style="font-size:11px;color:#64748b">${escapeHtml(p.location_name)}</div>
            <div style="font-size:11px">Capacity ${escapeHtml(p.capacity ?? '—')} (occ ${escapeHtml(p.occupancy ?? '—')}) · ${escapeHtml(p.status)}</div>
          </div>`).addTo(map);
      });
      bindLayerEvent('mouseenter', 'ov-shelters-core', onEnter);
      bindLayerEvent('mouseleave', 'ov-shelters-core', onLeave);
    }
    if (layers.incidents && reports.length) {
      map.addSource('ov-incidents', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: reports.filter(r => r.latitude != null && r.longitude != null).map(r => ({
            type: 'Feature', geometry: { type: 'Point', coordinates: [r.longitude!, r.latitude!] },
            properties: { id: r.id, category: r.category, status: r.verification_status, description: (r.description ?? '').slice(0, 180), location_name: r.location_name, reported_at: r.report_time }
          }))
        }
      });
      map.addLayer({
        id: 'ov-incidents-core', type: 'circle', source: 'ov-incidents',
        paint: {
          'circle-radius': 7,
          'circle-color': ['match', ['get', 'status'], 'VERIFIED', '#0d9488', 'REJECTED', '#94a3b8', '#f59e0b'],
          'circle-opacity': .85, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff'
        }
      });
      bindLayerEvent('click', 'ov-incidents-core', (e: any) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        popup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:system-ui;min-width:210px">
            <div style="font-size:10px;font-weight:800;color:${p.status === 'VERIFIED' ? '#0f766e' : '#b45309'}">CITIZEN REPORT · ${escapeHtml(p.status)}</div>
            <div style="font-weight:800;font-size:13px">${escapeHtml(p.category)}</div>
            <div style="font-size:11px;color:#64748b">${escapeHtml(p.location_name)}</div>
            <div style="font-size:11px;margin-top:3px">${escapeHtml(p.description)}</div>
            ${p.status !== 'VERIFIED' ? '<div style="font-size:10px;color:#b45309;margin-top:3px">UNVERIFIED — displayed as a report, never as a confirmed hazard</div>' : ''}
          </div>`).addTo(map);
      });
      bindLayerEvent('mouseenter', 'ov-incidents-core', onEnter);
      bindLayerEvent('mouseleave', 'ov-incidents-core', onLeave);
    }
    if (layers.history && history.length) {
      map.addSource('ov-history', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: history.filter(h => h.latitude != null && h.longitude != null).map(h => ({
            type: 'Feature', geometry: { type: 'Point', coordinates: [h.longitude!, h.latitude!] }, properties: h as any
          }))
        }
      });
      map.addLayer({
        id: 'ov-history-ring', type: 'circle', source: 'ov-history',
        paint: {
          'circle-radius': 10,
          'circle-color': ['match', ['get', 'hazard_type'], 'FLOOD', '#2563eb', '#7c3aed'],
          'circle-opacity': .25, 'circle-stroke-width': 2,
          'circle-stroke-color': ['match', ['get', 'hazard_type'], 'FLOOD', '#1d4ed8', '#5b21b6']
        }
      });
      bindLayerEvent('click', 'ov-history-ring', (e: any) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        popup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:system-ui;min-width:220px">
            <div style="font-size:10px;font-weight:800;color:${p.hazard_type === 'FLOOD' ? '#1d4ed8' : '#7c3aed'}">VALIDATED ${escapeHtml(p.hazard_type)} EVENT (HISTORICAL)</div>
            <div style="font-weight:800">${escapeHtml(p.location_name)}</div>
            <div style="font-size:11px">${escapeHtml(new Date(p.event_start).toLocaleDateString())} · severity ${escapeHtml(p.severity)}</div>
            <div style="font-size:11px;margin-top:3px">${escapeHtml(p.description)}</div>
          </div>`).addTo(map);
      });
      bindLayerEvent('mouseenter', 'ov-history-ring', onEnter);
      bindLayerEvent('mouseleave', 'ov-history-ring', onLeave);
    }

    /* -- Monitored site markers (always visible, colored by district prototype risk) -- */
    const monitoredSiteFeatures = locations.filter(location => location.active && Number.isFinite(location.longitude) && Number.isFinite(location.latitude)).map(location => {
      const district = summaries?.districts.find(item => item.monitored_locations.some(site => site.id === location.id));
      const flood = district?.flood_risk?.risk_category ?? 'UNKNOWN';
      const landslide = district?.landslide_risk?.risk_category ?? 'UNKNOWN';
      const riskCategory = severityRank(flood) >= severityRank(landslide) ? flood : landslide;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [location.longitude, location.latitude] },
        properties: {
          id: location.id, name: location.name, state: location.state, district: location.district,
          location_type: location.location_type, risk_category: riskCategory,
          flood_category: flood, landslide_category: landslide,
          rainfall_status: district?.data_quality.rainfall ?? 'MISSING',
          official_warning_count: district?.official_warning_count ?? 0
        }
      };
    });
    if (monitoredSiteFeatures.length) {
      map.addSource('ov-monitoring-sites', {
        type: 'geojson', data: { type: 'FeatureCollection', features: monitoredSiteFeatures as any }
      });
      map.addLayer({
        id: 'ov-monitoring-site-circles', type: 'circle', source: 'ov-monitoring-sites',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 8, 9],
          'circle-color': ['match', ['get', 'risk_category'], 'CRITICAL', SEVERITY_COLORS.CRITICAL, 'HIGH', SEVERITY_COLORS.HIGH, 'MODERATE', SEVERITY_COLORS.MODERATE, 'LOW', SEVERITY_COLORS.LOW, SEVERITY_COLORS.UNKNOWN],
          'circle-opacity': 0.98,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });
      map.addLayer({
        id: 'ov-monitoring-site-labels', type: 'symbol', source: 'ov-monitoring-sites', minzoom: 7,
        layout: { 'text-field': ['get', 'name'], 'text-size': 10, 'text-offset': [0, 1.25], 'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-allow-overlap': false },
        paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }
      });
      bindLayerEvent('click', 'ov-monitoring-site-circles', (event: any) => {
        const point = event.features?.[0]?.properties;
        if (!point) return;
        const district = summaries?.districts.find(item => item.monitored_locations.some(site => site.id === point.id));
        if (district) {
          setSelectedDistrict(district.district);
          setSelectedState(district.state ?? 'ALL');
        }
        map.flyTo({ center: event.lngLat.toArray(), zoom: Math.max(map.getZoom(), 8), padding: mapViewportPadding(), duration: 650 });
        popup.setLngLat(event.lngLat).setHTML(`
          <div style="font-family:system-ui;min-width:220px">
            <div style="font-size:10px;font-weight:800;letter-spacing:.04em;color:#475569">MONITORED LOCATION · ${escapeHtml(point.location_type)}</div>
            <div style="font-weight:800;font-size:13px">${escapeHtml(point.name)}</div>
            <div style="font-size:11px;color:#64748b">${escapeHtml(point.district)}, ${escapeHtml(point.state)}</div>
            <div style="font-size:11px;margin-top:5px"><b>Prototype risk:</b> ${escapeHtml(point.risk_category)}<br/><b>Flood:</b> ${escapeHtml(point.flood_category)} · <b>Landslide:</b> ${escapeHtml(point.landslide_category)}</div>
            <div style="font-size:10px;color:#64748b;margin-top:4px">Rainfall observations: ${escapeHtml(point.rainfall_status)} · Official warnings: ${escapeHtml(point.official_warning_count)}</div>
            <div style="font-size:10px;color:#64748b;margin-top:4px">Risk is an estimate, not an official warning. Missing data does not mean safe conditions.</div>
          </div>`).addTo(map);
      });
      bindLayerEvent('mouseenter', 'ov-monitoring-site-circles', onEnter);
      bindLayerEvent('mouseleave', 'ov-monitoring-site-circles', onLeave);
    }
    setOverlayError(null);
    } catch (err: any) {
      console.error('MapBoard overlay error:', err);
      setOverlayError(String(err?.message ?? err));
    }
    return () => {
      listeners.forEach(({ event, layer, handler }) => map.off(event as any, layer, handler as any));
      rainfallMarkers.forEach(marker => marker.remove());
      popup.remove();
    };
  }, [ready, styleVersion, summaries, boundaryData, riskGeo, history, layers, locations, alerts, shelters, reports, opacity, selectedDistrict, selectedState, baseProvider, summaryByBoundary, boundaryFeatures, scenePlaying, weatherForecasts, weatherLocations]);

  useEffect(() => {
    const map = mlRef.current;
    if (!scenePlaying || !ready || !layers.landslideRisk || !map || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let lastUpdate = 0;
    const animateOutline = (time: number) => {
      if (time - lastUpdate >= 90 && map.getLayer('ov-landslide-outline')) {
        const pulse = (Math.sin(time / 580) + 1) / 2;
        map.setPaintProperty('ov-landslide-outline', 'line-opacity', 0.52 + pulse * 0.44);
        lastUpdate = time;
      }
      frame = requestAnimationFrame(animateOutline);
    };
    frame = requestAnimationFrame(animateOutline);
    return () => cancelAnimationFrame(frame);
  }, [scenePlaying, ready, layers.landslideRisk, styleVersion]);

  const prevBaseRef = useRef<BaseMapProvider>(baseProvider);
  useEffect(() => {
    const map = mlRef.current;
    if (!map || !ready) return;
    if (prevBaseRef.current === baseProvider) return;
    prevBaseRef.current = baseProvider;

    try {
      const newStyle = buildBaseStyle({ base: baseProvider });
      map.setStyle(newStyle);
      const onStyleLoaded = () => {
        setStyleVersion(v => v + 1);
        try { map.resize(); } catch { /* ignore */ }
      };
      if (map.isStyleLoaded()) {
        onStyleLoaded();
      } else {
        map.once('style.load', onStyleLoaded);
      }
    } catch (err: any) {
      console.warn('Failed to switch base style:', err);
      setMapTilerNotice('Basemap style switch error. Reverting to OpenStreetMap.');
      setBaseProvider('OSM');
    }
  }, [baseProvider, ready]);

  const flyToDistrict = (d: DistrictSummary | null) => {
    const map = mlRef.current;
    if (!map || !d) return;
    setSelectedDistrict(d.district);
    setSelectedState(d.state ?? 'ALL');
    if (d.monitored_locations.length >= 2) {
      const lngs = d.monitored_locations.map(l => l.longitude);
      const lats = d.monitored_locations.map(l => l.latitude);
      map.fitBounds(
        [[Math.min(...lngs) - 0.25, Math.min(...lats) - 0.25], [Math.max(...lngs) + 0.25, Math.max(...lats) + 0.25]],
        { padding: mapViewportPadding(48), maxZoom: 9.5, duration: 800 }
      );
    } else if (d.monitored_locations.length === 1) {
      const l = d.monitored_locations[0];
      map.flyTo({ center: [l.longitude, l.latitude], zoom: 8.4, padding: mapViewportPadding(), duration: 800 });
    }
  };

  const resetView = () => {
    setSelectedDistrict(null);
    setSelectedState('ALL');
    mlRef.current?.fitBounds(NE_BOUNDS, { padding: mapViewportPadding(), maxZoom: 7, duration: 700 });
  };

  const flyToState = (state: string) => {
    if (state === 'ALL') {
      resetView();
      return;
    }
    const map = mlRef.current;
    const features = boundaryFeatures.filter((feature: any) => feature.properties?.state === state);
    if (!map || features.length === 0) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    const visit = (coordinates: any): void => {
      if (!Array.isArray(coordinates)) return;
      if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
        minLng = Math.min(minLng, coordinates[0]); maxLng = Math.max(maxLng, coordinates[0]);
        minLat = Math.min(minLat, coordinates[1]); maxLat = Math.max(maxLat, coordinates[1]);
        return;
      }
      coordinates.forEach(visit);
    };
    features.forEach((feature: any) => visit(feature.geometry?.coordinates));
    if ([minLng, minLat, maxLng, maxLat].every(Number.isFinite)) {
      setSelectedDistrict(null);
      setSelectedState(state);
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: mapViewportPadding(40), maxZoom: 8, duration: 700 });
    }
  };

  const goFullscreen = () => {
    if (!document.fullscreenElement) mapContainer.current?.closest('.mapboard-shell')?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  const toggleScene = () => {
    if (!scenePlaying) {
      setLayers(current => ({ ...current, rainfall: true, landslideRisk: true, floodRisk: false, boundaries: true }));
    }
    setScenePlaying(current => !current);
  };

  const sortedForPanel = useMemo(() => {
    if (!summaries) return [];
    return summaries.districts.filter(d => selectedState === 'ALL' || d.state === selectedState).sort((a, b) =>
      (Math.max(severityRank(b.flood_risk.risk_category), severityRank(b.landslide_risk.risk_category)) -
        Math.max(severityRank(a.flood_risk.risk_category), severityRank(a.landslide_risk.risk_category))));
  }, [summaries, selectedState]);

  const officialWarningRows = useMemo(() => (summaries?.districts ?? []).filter(d => (selectedState === 'ALL' || d.state === selectedState) && (!selectedDistrict || (d.district === selectedDistrict && d.state === selectedState))).flatMap(d =>
    d.official_warnings.map(warning => ({ district: d.district, state: d.state, warning }))
  ), [summaries, selectedState, selectedDistrict]);

  const stateRiskRows = useMemo(() => stateNames.filter(state => selectedState === 'ALL' || state === selectedState).map(state => {
    const rows = (summaries?.districts ?? []).filter(d => d.state === state);
    const categories = rows.map(d => layers.floodRisk ? d.flood_risk.risk_category : d.landslide_risk.risk_category);
    const category = categories
      .filter(value => severityRank(value) > 0)
      .sort((a, b) => severityRank(b) - severityRank(a))[0]
      ?? (rows.length ? 'UNAVAILABLE' : 'UNKNOWN');
    return {
      state,
      districts: rows.length,
      category,
      warnings: rows.reduce((count, d) => count + d.official_warning_count, 0)
    };
  }), [stateNames, summaries, layers.floodRisk, selectedState]);

  const districtsInScope = useMemo(() => (summaries?.districts ?? []).filter(d =>
    (selectedState === 'ALL' || d.state === selectedState) && (!selectedDistrict || (d.district === selectedDistrict && d.state === selectedState))),
    [summaries, selectedState, selectedDistrict]
  );
  const matchedDistrictCount = districtsInScope.filter(d => d.boundary.status !== 'UNKNOWN').length;

  const freshRainfallDistrictCount = useMemo(
    () => districtsInScope.filter(d => d.data_quality.rainfall === 'FRESH').length,
    [districtsInScope]
  );

  /* ------------------ table filters ------------------ */
  const [hazardFilter, setHazardFilter] = useState<'ALL' | 'FLOOD' | 'LANDSLIDE'>('ALL');
  const [severityMin, setSeverityMin] = useState(0);
  const [freshFilter, setFreshFilter] = useState('ALL');
  const [districtTableOpen, setDistrictTableOpen] = useState(false);

  const tableRows = useMemo(() => {
    if (!summaries) return [];
    let rows = summaries.districts
      .filter(d => selectedState === 'ALL' || d.state === selectedState)
      .filter(d => freshFilter === 'ALL' || d.data_quality.rainfall === freshFilter);
    if (hazardFilter !== 'ALL') {
      rows = rows.filter(d => severityRank(
        hazardFilter === 'FLOOD' ? d.flood_risk.risk_category : d.landslide_risk.risk_category) >= severityMin);
    }
    return [...rows].sort((a, b) => {
      const sa = hazardFilter === 'LANDSLIDE'
        ? severityRank(a.landslide_risk.risk_category)
        : Math.max(severityRank(a.flood_risk.risk_category), severityRank(a.landslide_risk.risk_category));
      const sb = hazardFilter === 'LANDSLIDE'
        ? severityRank(b.landslide_risk.risk_category)
        : Math.max(severityRank(b.flood_risk.risk_category), severityRank(b.landslide_risk.risk_category));
      if (sa !== sb) return sb - sa;
      return b.incidents_verified - a.incidents_verified;
    });
  }, [summaries, selectedState, hazardFilter, severityMin, freshFilter]);

  return (
    <div className="h-full min-h-0 flex flex-col gap-2">
      {/* ---- MapBoard shell (fullscreen target) ---- */}
      <div className="mapboard-shell flex-1 min-h-0 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        {/* A. Top header */}
        <div className="mapboard-header flex flex-col md:flex-row md:flex-wrap md:items-center gap-2 px-4 py-3 border-b border-[#e8e1d8] bg-[#fbfaf8] text-slate-800">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-[#806047]" />
            <span className="font-black tracking-wide text-sm whitespace-nowrap">Geo Shield · District map</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-600">
            <Clock className="w-3.5 h-3.5" />
            <span className="tabular-nums">{clock}</span>
          </div>
          <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${statusPill.tone === 'ok' ? 'bg-emerald-100 text-emerald-800' : statusPill.tone === 'warn' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
            <Database className="w-3 h-3 inline mr-1" />{statusPill.label}
          </div>
          {summaries && (
            <div className="text-[10px] text-slate-500">
              generated {new Date(summaries.generated_at).toLocaleTimeString()} · {dataMode}
            </div>
          )}
          <div className="md:ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Find district…"
                className="pl-7 pr-2 py-1.5 text-xs rounded-lg bg-white border border-[#e8e1d8] text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#b59a82] w-44"
              />
              {search && districtSearchList.length > 0 && (
                <div className="absolute z-[500] mt-1 w-64 max-h-64 overflow-auto bg-white text-slate-800 border border-[#e8e1d8] rounded-lg shadow-xl">
                  {districtSearchList.slice(0, 12).map(d => (
                    <button key={d.district} className="flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-[#f7f3ef]"
                      onClick={() => { flyToDistrict(d); setSearch(''); }}>
                      <span>{d.district} <span className="text-slate-400">({d.state})</span></span>
                      <span className="text-[10px] text-slate-400">{d.flood_risk.risk_category}/{d.landslide_risk.risk_category}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <label className="sr-only" htmlFor="map-state-select">Focus map on a state</label>
            <select id="map-state-select" value={selectedState} onChange={e => flyToState(e.target.value)}
              className="px-2 py-1.5 text-[11px] font-semibold rounded-lg bg-white border border-[#e8e1d8] text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#b59a82]">
              <option value="ALL">All 8 states</option>
              {stateNames.map(state => <option key={state} value={state}>{state}</option>)}
            </select>
            <button onClick={resetView} className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-bold whitespace-nowrap rounded-lg bg-white border border-[#e8e1d8] text-slate-700 hover:bg-[#f7f3ef]">
              <MapPin className="w-3.5 h-3.5" /> View all NE India
            </button>
            <button onClick={goFullscreen} className="p-1.5 rounded-lg bg-white border border-[#e8e1d8] text-slate-700 hover:bg-[#f7f3ef]" title="Fullscreen">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={toggleScene} aria-pressed={scenePlaying}
              className={`flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-bold whitespace-nowrap rounded-lg border transition ${scenePlaying ? 'bg-cyan-100 border-cyan-300 text-cyan-800' : 'bg-white border-[#e8e1d8] text-slate-700 hover:bg-[#f7f3ef]'}`}
              title="Animate rainfall stations and landslide district outlines">
              {scenePlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{scenePlaying ? 'Pause scene' : 'Play scene'}</span>
              <span className="sm:hidden">{scenePlaying ? 'Pause' : 'Play'}</span>
            </button>
            <button onClick={() => setDistrictTableOpen(open => !open)} className="px-2 py-1.5 text-[11px] font-bold whitespace-nowrap rounded-lg bg-white border border-[#e8e1d8] text-slate-700 hover:bg-[#f7f3ef]" aria-expanded={districtTableOpen}>
              {districtTableOpen ? 'Hide table' : 'District table'}
            </button>
          </div>
        </div>

        {/* Main area: left layer panel / map / right district panel */}
        <div className="relative flex-1 min-h-0">
          <div ref={mapContainer} className="absolute inset-0" />

          {/* Desktop layer dock: district controls and legend stay alongside the map. */}
          <aside className="hidden xl:flex absolute inset-y-0 left-0 z-[410] w-[16.5rem] flex-col overflow-y-auto border-r border-[#e8e1d8] bg-white/95 text-slate-800 shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between px-3 py-3 border-b border-[#eee7df]">
              <span className="flex items-center gap-2 text-sm font-bold"><Layers className="w-4 h-4 text-[#806047]" /> Layers</span>
              <button onClick={() => setLayers({ ...DEFAULT_LAYERS })} className="text-[10px] font-bold text-[#806047] hover:text-[#503b2d]">Reset</button>
            </div>
            <div className="px-3 py-3 border-b border-[#eee7df]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Basemap</span>
                <span className="text-[9px] font-semibold text-slate-500">{hasMapTilerKey() ? 'MapTiler' : 'OSM fallback'}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {(['MAPTILER_STREETS', 'MAPTILER_OUTDOOR', 'MAPTILER_TOPO', 'SATELLITE', 'OSM'] as BaseMapProvider[]).map(provider => (
                  <button key={provider}
                    onClick={() => { setMapTilerNotice(null); setBaseProvider(provider); }}
                    className={`rounded-md px-2 py-1 text-[9px] font-bold ${baseProvider === provider ? 'bg-[#6f513e] text-white' : 'bg-[#f4f0eb] text-slate-600 hover:bg-[#ebe3da]'}`}>
                    {baseProviderLabel(provider).replace('MapTiler ', '')}
                  </button>
                ))}
              </div>
            </div>
            {GROUPS.map(group => (
              <section key={group.group} className="px-3 py-2 border-b border-[#eee7df]">
                <h3 className="mb-1 text-[9px] font-black uppercase tracking-wider text-slate-500">{group.group}</h3>
                {group.items.map(item => (
                  <label key={item.key} className="flex cursor-pointer items-center gap-2 py-1.5 text-[11px] font-medium text-slate-700">
                    <input type="checkbox" checked={layers[item.key]} aria-label={item.label}
                      onChange={() => setLayers(current => {
                        const enabled = !current[item.key];
                        if (item.key === 'floodRisk') return { ...current, floodRisk: enabled, landslideRisk: enabled ? false : current.landslideRisk };
                        if (item.key === 'landslideRisk') return { ...current, landslideRisk: enabled, floodRisk: enabled ? false : current.floodRisk };
                        return { ...current, [item.key]: enabled };
                      })} />
                    <item.icon className={`h-3.5 w-3.5 ${layers[item.key] ? 'text-[#806047]' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </label>
                ))}
              </section>
            ))}
            <div className="px-3 py-2 border-b border-[#eee7df] text-[10px]">
              <div className="mb-1 font-bold text-slate-700">Overlay opacity</div>
              <label className="flex items-center gap-2 py-1"><span className="w-20 text-slate-400">Risk fill</span>
                <input aria-label="Risk fill opacity" type="range" min={0.15} max={0.85} step={0.05} value={opacity.risk}
                  onChange={e => setOpacity(current => ({ ...current, risk: Number(e.target.value) }))} className="flex-1" />
              </label>
              <label className="flex items-center gap-2 py-1"><span className="w-20 text-slate-400">Official warn.</span>
                <input aria-label="Official warning opacity" type="range" min={0.15} max={0.85} step={0.05} value={opacity.warnings}
                  onChange={e => setOpacity(current => ({ ...current, warnings: Number(e.target.value) }))} className="flex-1" />
              </label>
            </div>
            <div className="px-3 py-3 text-[10px] text-slate-600">
              <div className="mb-2 flex items-center gap-1.5 font-bold text-slate-800"><Info className="h-3.5 w-3.5" /> Legend · {layers.floodRisk ? 'Flood' : 'Landslide'}</div>
              {(['CRITICAL', 'HIGH', 'MODERATE', 'LOW', 'UNKNOWN'] as const).map(level => (
                <div key={level} className="flex items-center gap-2 py-0.5">
                  <span className="h-3 w-3 rounded-sm border border-white/10" style={{ background: SEVERITY_COLORS[level] }} />
                  <span>{level === 'UNKNOWN' ? 'Unknown / no data' : level[0] + level.slice(1).toLowerCase()}</span>
                </div>
              ))}
              <p className="mt-2 border-t border-[#eee7df] pt-2 leading-relaxed">
                District polygons: geohacker/india · EPSG:4326 · 78 districts. Unmatched districts stay UNKNOWN. Risk fill is a prototype estimate; official warnings are separate.
              </p>
              <p className="mt-2 flex items-start gap-2 border-t border-[#eee7df] pt-2 leading-relaxed">
                <span className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full border-2 border-blue-600 bg-sky-300/70 shadow-[0_0_8px_3px_rgba(37,99,235,0.35)]" />
                <span>Blue aura marks provider forecast rain over the next 24 hours. Click a point for amount, probability, source, and retrieval time; it is not observed rain or an official warning.</span>
              </p>
            </div>
          </aside>

          {/* Desktop live-data rail uses only backend district summaries and official warning records. */}
          <aside className="hidden xl:flex absolute inset-y-0 right-0 z-[410] w-[18rem] flex-col overflow-y-auto border-l border-[#e8e1d8] bg-white/95 text-slate-800 shadow-xl backdrop-blur-sm">
            <div className="border-b border-[#eee7df] px-4 py-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold">District data</h2>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${summaries ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                  {summaries ? 'API CONNECTED' : 'UNAVAILABLE'}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">Backend snapshot {summaries ? new Date(summaries.generated_at).toLocaleTimeString() : 'not loaded'}</p>
            </div>

            <section className="border-b border-[#eee7df] p-3">
              <h3 className="mb-2 text-[11px] font-bold">Observed and official data</h3>
              <div className="grid grid-cols-3 gap-1.5">
                <div className="rounded-lg border border-[#e8e1d8] bg-[#faf8f6] p-2">
                  <div className="text-lg font-bold text-sky-700">{summaries ? `${matchedDistrictCount}/${districtsInScope.length}` : '—'}</div>
                  <div className="text-[9px] leading-tight text-slate-500">districts matched in scope</div>
                </div>
                <div className="rounded-lg border border-[#e8e1d8] bg-[#faf8f6] p-2">
                  <div className="text-lg font-bold text-cyan-700">{summaries ? freshRainfallDistrictCount : '—'}</div>
                  <div className="text-[9px] leading-tight text-slate-500">fresh rain obs. in scope</div>
                </div>
                <div className="rounded-lg border border-[#e8e1d8] bg-[#faf8f6] p-2">
                  <div className="text-lg font-bold text-rose-700">{summaries ? officialWarningRows.length : '—'}</div>
                  <div className="text-[9px] leading-tight text-slate-500">official warnings</div>
                </div>
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-slate-500">Synthetic demo observations are excluded from the fresh-observation count. Prototype risk is not an official warning.</p>
            </section>

            <section className="border-b border-[#eee7df] p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-bold">Official warnings</h3>
                <span className="text-[9px] text-slate-500">agency records</span>
              </div>
              {officialWarningRows.length ? officialWarningRows.slice(0, 4).map(({ district, state, warning }) => {
                const districtSummary = summaries?.districts.find(d => d.district === district && d.state === state);
                return <button key={warning.alert_id} onClick={() => districtSummary && flyToDistrict(districtSummary)}
                  className="mb-1.5 w-full rounded-lg border border-[#e8e1d8] bg-[#faf8f6] p-2 text-left hover:border-[#b59a82]">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] font-semibold leading-snug">{district} · {state}</span>
                    <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ background: `${SEVERITY_COLORS[warning.severity] ?? '#64748b'}33`, color: SEVERITY_COLORS[warning.severity] ?? '#cbd5e1' }}>{warning.severity}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[9px] leading-snug text-slate-600">{warning.title}</p>
                  <p className="mt-1 text-[8px] text-slate-500">{warning.source} · {warning.issued_at ? new Date(warning.issued_at).toLocaleString() : 'issue time unavailable'}</p>
                </button>;
              }) : <p className="rounded-lg border border-[#e8e1d8] bg-[#faf8f6] p-2 text-[10px] leading-relaxed text-slate-600">{summaries ? 'No official warning records were returned. No warning data does not mean there is no hazard.' : 'Waiting for district data from the local API.'}</p>}
            </section>

            <section className="p-3">
              <div className="mb-1 flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-[11px] font-bold">Prototype risk by state</h3>
                  <p className="text-[9px] text-slate-500">Highest monitored-district {layers.floodRisk ? 'flood' : 'landslide'} estimate</p>
                </div>
                <span className="text-[8px] uppercase tracking-wide text-amber-700">Not official</span>
              </div>
              {stateRiskRows.map(row => (
                <button key={row.state} onClick={() => flyToState(row.state)}
                  className="flex w-full items-center gap-2 border-b border-[#eee7df] py-1.5 text-left last:border-0 hover:bg-[#faf8f6]">
                  <span className="h-2 w-2 rounded-full" style={{ background: SEVERITY_COLORS[row.category] ?? SEVERITY_COLORS.UNKNOWN }} />
                  <span className="flex-1 truncate text-[10px]">{row.state}</span>
                  <span className="text-[9px] text-slate-500">{row.districts} monitored</span>
                  <span className="w-16 text-right text-[9px] font-semibold" style={{ color: SEVERITY_COLORS[row.category] ?? SEVERITY_COLORS.UNKNOWN }}>{row.category}</span>
                </button>
              ))}
            </section>
          </aside>

          {!ready && (
            <div className="absolute inset-0 z-[350] flex items-center justify-center bg-slate-100/70 text-sm font-bold text-slate-500">
              Rendering Northeast India map…
            </div>
          )}
          {overlayError && (
            <div className="absolute bottom-24 left-3 z-[450] bg-rose-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shadow" role="status">
              Overlays partially unavailable: {overlayError}
            </div>
          )}
          {mapTilerNotice && (
            <div className="absolute bottom-24 left-3 z-[450] bg-amber-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shadow flex items-center gap-1.5" role="status">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{mapTilerNotice}</span>
            </div>
          )}

          <div className="absolute top-3 left-3 xl:left-[17rem] right-3 xl:right-[18.5rem] z-[450] flex flex-wrap gap-1.5 rounded-lg bg-white/95 p-1 shadow-md border border-slate-200 w-fit">
              {([
                ['layers', 'Layers', Layers],
                ['district', 'District', Info],
                ['legend', 'Legend', Compass]
              ] as const).map(([panel, label, Icon]) => (
                <button key={panel} onClick={() => setMobileMapPanel(current => current === panel ? null : panel)}
                  aria-pressed={mobileMapPanel === panel}
                  className={`flex min-h-9 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-bold ${panel !== 'district' ? 'xl:hidden' : ''} ${mobileMapPanel === panel ? 'bg-teal-700 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              ))}
              <button onClick={() => navigate('/layers')} className="min-h-9 rounded-md px-2.5 py-1.5 text-[11px] font-bold text-teal-800 hover:bg-teal-50 xl:hidden">
                Guide
              </button>
          </div>

          {/* B. Left layer panel */}
          {compactMap && mobileMapPanel === 'layers' && <div className="absolute z-[400] top-14 left-3 right-3 max-h-[72%] bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-slate-200 overflow-auto">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
              <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900"><Layers className="w-4 h-4" /> Layers</span>
              <button onClick={() => setLayers({ ...DEFAULT_LAYERS })} className="text-[10px] font-bold text-blue-600 hover:underline">Reset</button>
            </div>
            <div className="px-3 py-2 border-b border-slate-100">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Basemap Provider</span>
                {hasMapTilerKey() ? (
                  <span className="text-[10px] font-bold text-teal-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> MapTiler Active
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400">OSM Fallback</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {(['MAPTILER_STREETS', 'MAPTILER_OUTDOOR', 'MAPTILER_TOPO', 'SATELLITE', 'OSM'] as BaseMapProvider[]).map(p => (
                  <button
                    key={p}
                    onClick={() => { setMapTilerNotice(null); setBaseProvider(p); }}
                    className={`px-2 py-1 rounded text-[10px] font-bold transition ${
                      baseProvider === p
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-600 bg-slate-100 hover:bg-slate-200'
                    }`}
                  >
                    {baseProviderLabel(p)}
                  </button>
                ))}
              </div>
            </div>
            {GROUPS.map(g => (
              <div key={g.group} className="px-3 py-2 border-t border-slate-100">
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1">{g.group}</div>
                {g.items.map(item => (
                  <label key={item.key} className="flex items-center gap-2 py-1 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                    <input type="checkbox" checked={layers[item.key]} aria-label={item.label}
                      onChange={() => setLayers(prev => {
                        const enabled = !prev[item.key];
                        if (item.key === 'floodRisk') return { ...prev, floodRisk: enabled, landslideRisk: enabled ? false : prev.landslideRisk };
                        if (item.key === 'landslideRisk') return { ...prev, landslideRisk: enabled, floodRisk: enabled ? false : prev.floodRisk };
                        return { ...prev, [item.key]: enabled };
                      })} />
                    <item.icon className={`w-3.5 h-3.5 ${layers[item.key] ? 'text-' + item.color.slice(3) : 'text-slate-300'}`} />
                    {item.label}
                  </label>
                ))}
              </div>
            ))}
            <div className="px-3 py-2 border-t border-slate-100 text-[11px]">
              <div className="font-bold text-slate-700 mb-1">Overlay opacity</div>
              <label className="flex items-center gap-2">
                <span className="w-20 text-slate-500">Risk fill</span>
                <input type="range" min={0.15} max={0.85} step={0.05} value={opacity.risk}
                  onChange={e => setOpacity(p => ({ ...p, risk: Number(e.target.value) }))} className="flex-1" />
              </label>
              <label className="flex items-center gap-2">
                <span className="w-20 text-slate-500">Official warn.</span>
                <input type="range" min={0.15} max={0.85} step={0.05} value={opacity.warnings}
                  onChange={e => setOpacity(p => ({ ...p, warnings: Number(e.target.value) }))} className="flex-1" />
              </label>
            </div>
            <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-500">
              Boundaries: geohacker/india (public) · EPSG:4326 · 78 NE districts. Aliases: Kamrup Metropolitan→'Kamrup', Imphal East→'East Imphal', Imphal West→'West Imphal'. Unmatched districts stay UNKNOWN and unshaded.
            </div>
          </div>}

          {/* D. Right district panel */}
          {mobileMapPanel === 'district' && <div className={`absolute z-[400] overflow-auto bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-slate-200 ${compactMap ? 'top-14 left-3 right-3 max-h-[72%]' : 'top-14 right-3 w-80 max-h-[82%] xl:right-[18.5rem]'}`}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
              <span className="text-xs font-bold text-slate-900">District inspector</span>
              <button onClick={() => setPanelOpen(p => !p)} className="text-[10px] font-bold text-blue-600">{panelOpen ? 'Hide list' : 'Show list'}</button>
            </div>
            {panelOpen && (
              <div className="px-2 py-2 border-b border-slate-100 max-h-44 overflow-auto">
                {sortedForPanel.slice(0, 40).map(d => {
                  const sev = Math.max(severityRank(d.flood_risk.risk_category), severityRank(d.landslide_risk.risk_category));
                  const dot = sev >= 4 ? 'bg-red-600' : sev === 3 ? 'bg-orange-500' : sev === 2 ? 'bg-amber-400' : sev === 1 ? 'bg-emerald-500' : 'bg-slate-300';
                  return (
                    <button key={d.district}
                      onClick={() => flyToDistrict(d)}
                      className={`flex w-full items-center gap-2 px-2 py-1 text-[11px] rounded hover:bg-slate-100 ${d.district === selectedDistrict ? 'bg-blue-50 ring-1 ring-blue-300' : ''}`}>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                      <span className="font-semibold text-slate-800 flex-1 text-left">{d.district}</span>
                      {d.official_warning_count > 0 && <ShieldAlert className="w-3 h-3 text-red-600" />}
                      <ChevronRight className="w-3 h-3 text-slate-400" />
                    </button>
                  );
                })}
              </div>
            )}
            <div className="p-3">
              {!summaries && <div className="text-xs text-slate-500">District data unavailable — map shows boundaries only.</div>}
              {summaries && !selected && <div className="text-xs text-slate-500">Click a district polygon (or the list) to inspect observations, warnings, prototype risk and incidents.</div>}
              {selected && (
                <div className="space-y-2 text-xs">
                  <div>
                    <div className="font-black text-slate-900 text-sm">{selected.district}</div>
                    <div className="text-slate-500">{selected.state} · monitoring {selected.monitored_locations.length} station(s)</div>
                    <div className="text-[10px] mt-0.5">
                      <span className={`px-1.5 py-0.5 rounded font-bold ${selected.boundary.status === 'EXACT' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-800'}`}>
                        boundary: {selected.boundary.status}{selected.boundary.boundary_name ? ` → ${selected.boundary.boundary_name}` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-slate-200 p-2">
                      <div className="text-[10px] font-black text-blue-700">FLOOD (prototype)</div>
                      <div className="font-black" style={{ color: SEVERITY_COLORS[selected.flood_risk.risk_category] }}>
                        {selected.flood_risk.risk_category}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {selected.flood_risk.probability != null ? `score ${selected.flood_risk.probability}` : selected.flood_risk.reason}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-2">
                      <div className="text-[10px] font-black text-amber-700">LANDSLIDE (prototype)</div>
                      <div className="font-black" style={{ color: SEVERITY_COLORS[selected.landslide_risk.risk_category] }}>
                        {selected.landslide_risk.risk_category}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {selected.landslide_risk.probability != null ? `score ${selected.landslide_risk.probability}` : selected.landslide_risk.reason}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
                    <div className="font-bold text-slate-700 mb-1 flex items-center gap-1"><CloudRain className="w-3.5 h-3.5" /> Latest rainfall 24h</div>
                    {selected.observed_rainfall_24h ? (
                      <div>
                        <div><b style={{ color: SEVERITY_COLORS.rain ?? '#0369a1' }}>{selected.observed_rainfall_24h.value?.toFixed?.(1) ?? selected.observed_rainfall_24h.value} mm</b>
                          <span className="ml-1 text-slate-500">at {selected.observed_rainfall_24h.location}</span></div>
                        <div className="text-[10px] text-slate-500">
                          observed {new Date(selected.observed_rainfall_24h.observed_at).toLocaleString()} ({selected.observed_rainfall_24h.age_hours?.toFixed?.(1)}h ago) · status {selected.data_quality.rainfall}
                        </div>
                      </div>
                    ) : <div className="text-slate-500">No rainfall observation for this district.</div>}
                  </div>

                  {!!selected.river_level_all_locations.length && (
                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
                      <div className="font-bold text-slate-700 mb-1">River gauge readings</div>
                      {selected.river_level_all_locations.slice(0, 3).map(rv => (
                        <div key={rv.location + rv.observed_at} className="text-[11px]">
                          <b>{rv.location}</b>: {rv.value?.toFixed?.(2) ?? rv.value} m — {rv.age_hours?.toFixed?.(1)}h ago ({selected.data_quality.river})
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="rounded-lg border border-slate-200 p-2">
                    <div className="font-bold text-slate-700 mb-1 flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5 text-red-600" /> Official warnings {selected.official_warnings.length ? `(${selected.official_warnings.length})` : ''}</div>
                    {selected.official_warnings.length ? selected.official_warnings.map(w => (
                      <div key={w.alert_id} className="mb-1.5 pb-1.5 border-b border-slate-100 last:border-0">
                        <div className="font-bold" style={{ color: SEVERITY_COLORS[w.severity] }}>{w.title}</div>
                        <div className="text-[11px] text-slate-600">{w.description}</div>
                        <div className="text-[10px] text-slate-400">
                          {w.source} · issued {w.issued_at ? new Date(w.issued_at).toLocaleDateString() : '—'}{w.expires_at ? ` · valid till ${new Date(w.expires_at).toLocaleDateString()}` : ''}
                        </div>
                      </div>
                    )) : <div className="text-slate-500">No official warning received for this district — absence is not safety.</div>}
                  </div>

                  {(selected.flood_explanations.length > 0 || selected.landslide_explanations.length > 0) && (
                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
                      <div className="font-bold text-slate-700 mb-1">Contributing factors (model inputs)</div>
                      {[...selected.flood_explanations, ...selected.landslide_explanations].slice(0, 5).map((n, i) => (
                        <div key={i} className="text-[10px] text-slate-600">• {n}</div>
                      ))}
                    </div>
                  )}

                  <div className="rounded-lg border border-slate-200 p-2">
                    <div className="flex justify-between text-[11px] font-bold text-slate-700">
                      <span>Verified incidents: {selected.incidents_verified}/{selected.incidents_total}</span>
                      <span>Shelters: {selected.shelters_count}</span>
                    </div>
                    {selectedAlerts.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        <div className="text-[10px] font-black text-slate-500">PLATFORM ALERT RECORDS</div>
                        {selectedAlerts.slice(0, 4).map(a => (
                          <div key={a.id} className="text-[10px]">
                            <span className="font-bold" style={{ color: SEVERITY_COLORS[a.severity] }}>{a.severity}</span>
                            {" "}{a.hazard_type} · {a.source_type} · {a.lifecycle_status}
                            {a.simulation_flag && <span className="ml-1 text-amber-600">(SIM)</span>}
                            <div className="text-slate-500">{a.title}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {selected.latest_incident && (
                      <div className="text-[10px] text-slate-500 mt-1">
                        Latest: {selected.latest_incident.category} @ {selected.latest_incident.location_name} ({selected.latest_incident.verification_status}, {new Date(selected.latest_incident.report_time).toLocaleDateString()})
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-2">
                    <div className="font-bold text-amber-800 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Data quality / missing</div>
                    <div className="text-[10px] text-amber-800">
                      {selected.data_quality.missing_inputs.length ? selected.data_quality.missing_inputs.join(' · ') : 'All primary inputs present.'}
                      {' '}· risk basis: prototype {selected.flood_risk.engine}
                    </div>
                    <div className="text-[10px] text-amber-800 mt-1">
                      Never rely on colour alone: district is UNKNOWN when data is missing or the boundary is unresolved.
                    </div>
                  </div>

                  <div className="text-[10px] text-slate-400">
                    Protective action (verified guidance): follow ASDMA/DDMA official instructions; emergency 112.
                  </div>
                </div>
              )}
            </div>
          </div>}

          {/* B/E. Bottom legend */}
          {compactMap && mobileMapPanel === 'legend' && <div className="absolute z-[400] bottom-3 left-3 right-3 max-h-[48%] overflow-auto bg-white/95 backdrop-blur-sm p-2.5 rounded-lg shadow-md border border-slate-200 text-[11px] text-slate-700">
            <div className="font-bold text-slate-900 mb-1 flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> Legend</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: SEVERITY_COLORS.CRITICAL }} /> Critical</div>
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: SEVERITY_COLORS.HIGH }} /> High</div>
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: SEVERITY_COLORS.MODERATE }} /> Moderate</div>
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: SEVERITY_COLORS.LOW }} /> Low</div>
              <div><span className="inline-block w-3 h-3 rounded-full align-middle" style={{ background: SEVERITY_COLORS.MODERATE, border: '2px solid white', boxShadow: `0 0 0 1px ${SEVERITY_COLORS.MODERATE}` }} /> Landslide assessment point · prototype</div>
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: SEVERITY_COLORS.UNKNOWN }} /> Unknown / no data (gray)</div>
              <div><span className="inline-block w-3 h-3 rounded-full align-middle" style={{ background: '#64748b', border: '2px solid white', boxShadow: '0 0 0 1px #64748b' }} /> Monitored locations · dot color = district risk</div>
              <div><span className="inline-block w-3 h-3 rounded-full align-middle" style={{ background: '#087e9b' }} /> Rain gauge label · amber = demo/unverified {layers.rainfall ? '' : '(off)'}</div>
              <div><span className="inline-block w-3 h-3 rounded-full align-middle" style={{ background: '#6d28d9' }} /> Advisory rain forecast trigger ≥64.5 mm/24h {layers.forecastRain ? '' : '(off)'}</div>
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: '#16a34a' }} /> Verified shelter {layers.shelters ? '' : '(off)'}</div>
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: '#0d9488' }} /> Verified incident · amber = unverified</div>
              <div><span className="inline-block w-3 h-3 my-0.5 align-middle" style={{ height: 3, width: 14, background: '#111827' }} /> Official IMD warning outline</div>
              <div><span className="inline-block w-3 h-3 rounded-full align-middle" style={{ background: 'transparent', border: '2px solid #1d4ed8' }} /> Historical flood · purple = landslide</div>
            </div>
            <div className="text-[10px] text-slate-400 mt-1 border-t border-slate-100 pt-1">
              Green → yellow → orange → red shows Low → Moderate → High → Critical for either hazard. Risk polygons = PROTOTYPE model {summaries ? new Date(summaries.generated_at).toLocaleTimeString() : ''} · grey = no assessment · official layers = verbatim IMD station data, not model output.
            </div>
          </div>}

          {/* F. honest current-conditions strip */}
          {summaries && (
            <div className="absolute bottom-3 right-16 z-[400] hidden sm:block xl:hidden bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-slate-200 px-3 py-1.5 text-[10px] text-slate-600">
              <b>Current conditions</b> · latest stored observations, shown in browser local time
            </div>
          )}
        </div>
      </div>

      {/* ---- Optional district summary table; closed initially to keep the map in one screen ---- */}
      {districtTableOpen && <div className="max-h-[34vh] flex-shrink-0 overflow-auto bg-white rounded-xl p-3 border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h3 className="text-sm font-bold text-slate-900 mr-2">District summary — affected-area analysis</h3>
          <select value={selectedState} onChange={e => flyToState(e.target.value)}
            className="text-xs font-semibold p-1.5 rounded border border-slate-300">
            <option value="ALL">All states</option>
            {["Assam", "Arunachal Pradesh", "Meghalaya", "Manipur", "Mizoram", "Nagaland", "Tripura", "Sikkim"].map(s =>
              <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={hazardFilter} onChange={e => setHazardFilter(e.target.value as any)}
            className="text-xs font-semibold p-1.5 rounded border border-slate-300">
            <option value="ALL">Combined risk</option>
            <option value="FLOOD">Flood risk</option>
            <option value="LANDSLIDE">Landslide risk</option>
          </select>
          <select value={severityMin} onChange={e => setSeverityMin(Number(e.target.value))}
            className="text-xs font-semibold p-1.5 rounded border border-slate-300">
            <option value={0}>Any severity</option>
            <option value={2}>Moderate+</option>
            <option value={3}>High+</option>
            <option value={4}>Critical only</option>
          </select>
          <select value={freshFilter} onChange={e => setFreshFilter(e.target.value)}
            className="text-xs font-semibold p-1.5 rounded border border-slate-300">
            <option value="ALL">Any data freshness</option>
            <option value="FRESH">Fresh data only</option>
            <option value="STALE">Stale data</option>
            <option value="MISSING">Missing data</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-700 font-bold">
              <tr>
                <th className="py-2 px-3 text-left">District</th>
                <th className="py-2 px-2 text-left">State</th>
                <th className="py-2 px-2 text-left">Official warning</th>
                <th className="py-2 px-2 text-left">Flood estimate</th>
                <th className="py-2 px-2 text-left">Landslide estimate</th>
                <th className="py-2 px-2 text-left">Rainfall 24h</th>
                <th className="py-2 px-2 text-left">Freshness</th>
                <th className="py-2 px-2 text-left">Verified incidents</th>
                <th className="py-2 px-2 text-left">Boundary fit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {tableRows.map(d => (
                <tr key={d.district} className="hover:bg-slate-50 cursor-pointer" onClick={() => flyToDistrict(d)}>
                  <td className="py-2 px-3 font-semibold text-slate-900">{d.district}</td>
                  <td className="py-2 px-2">{d.state}</td>
                  <td className="py-2 px-2">
                    {d.official_warning_count
                      ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">{d.official_warnings[0].severity} (IMD)</span>
                      : <span className="text-[10px] text-slate-400">none received</span>}
                  </td>
                  <td className="py-2 px-2 font-bold" style={{ color: SEVERITY_COLORS[d.flood_risk.risk_category] }}>{d.flood_risk.risk_category}</td>
                  <td className="py-2 px-2 font-bold" style={{ color: SEVERITY_COLORS[d.landslide_risk.risk_category] }}>{d.landslide_risk.risk_category}</td>
                  <td className="py-2 px-2">{d.observed_rainfall_24h ? `${d.observed_rainfall_24h.value?.toFixed?.(1) ?? d.observed_rainfall_24h.value} mm` : '—'}</td>
                  <td className="py-2 px-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${d.data_quality.rainfall === 'FRESH' ? 'bg-emerald-100 text-emerald-800' : d.data_quality.rainfall === 'STALE' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>
                      {d.data_quality.rainfall}
                    </span>
                  </td>
                  <td className="py-2 px-2">{d.incidents_verified}</td>
                  <td className="py-2 px-2 text-[10px]">{d.boundary.status}</td>
                </tr>
              ))}
              {!tableRows.length && (
                <tr><td colSpan={9} className="py-3 text-slate-500">No districts match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>}
    </div>
  );
};
