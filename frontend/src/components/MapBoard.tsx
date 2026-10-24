import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Map as MLMap, Popup, NavigationControl, ScaleControl, FullscreenControl
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  MapPin, Search, Maximize2, Layers, Info, Clock, Database,
  Mountain, CloudRain, Tent, Megaphone, History,
  ChevronRight, ShieldAlert, AlertTriangle, Compass, CheckCircle2
} from 'lucide-react';
import {
  buildBaseStyle, NE_BOUNDS, NE_CENTER, NE_ZOOM, boundaryNameFor, SEVERITY_COLORS, severityRank,
  MapDistrictsResponse, DistrictSummary, BaseMapProvider, defaultBaseProvider, baseProviderLabel, hasMapTilerKey
} from './mapStyle';
import {
  LocationItem, AlertItem, ShelterItem, IncidentReportItem, HistoricalEventItem,
  GeoJSONFeatureCollection
} from '../types';

interface MapBoardProps {
  locations: LocationItem[];
  alerts: AlertItem[];
  shelters: ShelterItem[];
  reports: IncidentReportItem[];
}

type OverlayKeys =
  | 'boundaries' | 'floodRisk' | 'landslideRisk' | 'officialWarnings'
  | 'rainfall' | 'terrainSusceptibility' | 'shelters' | 'incidents' | 'history';

const DEFAULT_LAYERS: Record<OverlayKeys, boolean> = {
  boundaries: true,
  floodRisk: true,
  landslideRisk: true,
  officialWarnings: true,
  rainfall: true,
  terrainSusceptibility: false,
  shelters: false,
  incidents: true,
  history: false
};

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
      { key: 'rainfall', label: '24h rainfall (station)', icon: CloudRain, color: 'bg-sky-600' }
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
  const mapContainer = useRef<HTMLDivElement>(null);
  const mlRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [baseProvider, setBaseProvider] = useState<BaseMapProvider>(() => defaultBaseProvider());
  const [styleVersion, setStyleVersion] = useState<number>(0);
  const [mapTilerNotice, setMapTilerNotice] = useState<string | null>(null);
  const [layers, setLayers] = useState<Record<OverlayKeys, boolean>>({ ...DEFAULT_LAYERS });
  const [panelOpen, setPanelOpen] = useState(true);
  const [opacity, setOpacity] = useState({ risk: 0.55, warnings: 0.6 });
  const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api/v1';
  const [summaries, setSummaries] = useState<MapDistrictsResponse | null>(null);
  const [boundaryData, setBoundaryData] = useState<GeoJSONFeatureCollection | null>(null);
  const [riskGeo, setRiskGeo] = useState<GeoJSONFeatureCollection | null>(null);
  const [history, setHistory] = useState<HistoricalEventItem[]>([]);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [clock, setClock] = useState<string>(() => new Date().toLocaleTimeString());
  const [statusPill, setStatusPill] = useState<{ label: string; tone: 'ok' | 'warn' | 'down' }>({ label: 'LOADING', tone: 'warn' });
  const [dataMode, setDataMode] = useState<string>('PROTOTYPE');

  // ---- data loading ----
  useEffect(() => {
    (async () => {
      try {
        const bd = await fetch('geo/ne_districts.geojson');
        if (bd.ok) setBoundaryData(await bd.json());
      } catch { /* boundary failure -> districts unshaded, honest */ }
      try {
        const s = await fetch(`${API_BASE}/map/districts`);
        if (s.ok) setSummaries(await s.json());
      } catch { /* panel shows unavailable state */ }
      try {
        const rg = await fetch(`${API_BASE}/risk/geo`);
        if (rg.ok) setRiskGeo(await rg.json());
      } catch { /* terrain layer off if unloaded */ }
      try {
        const he = await fetch(`${API_BASE}/data/historical-events`);
        if (he.ok) setHistory(await he.json());
      } catch { /* history layer off if unloaded */ }
    })();
  }, [API_BASE]);

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
    const initialStyle = buildBaseStyle({ base: defaultBaseProvider() });
    const map = new MLMap({
      container: mapContainer.current,
      style: initialStyle,
      center: NE_CENTER,
      zoom: NE_ZOOM
    });
    map.fitBounds(NE_BOUNDS, { padding: 24, maxZoom: 7, duration: 600 });
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new FullscreenControl(), 'top-right');
    map.addControl(new ScaleControl(), 'bottom-right');

    map.on('error', (e: any) => {
      const msg = String(e?.error?.message || e?.message || '');
      if (msg.includes('401') || msg.includes('403') || msg.includes('maptiler')) {
        console.warn('MapTiler error notice, falling back to OSM:', msg);
        setMapTilerNotice('MapTiler key validation notice: Displaying OpenStreetMap fallback.');
        setBaseProvider('OSM');
      }
    });

    mlRef.current = map;
    map.on('load', () => { setReady(true); map.resize(); });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(mapContainer.current);
    return () => { ro.disconnect(); mlRef.current = null; map.remove(); };
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

  const selected = useMemo(
    () => summaries?.districts.find(d => d.district === selectedDistrict) ?? null,
    [summaries, selectedDistrict]
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
      .filter(d => !q || d.district.toLowerCase().includes(q) || (d.state ?? '').toLowerCase().includes(q));
  }, [summaries, search]);

  // ---- overlay rebuild ----
  useEffect(() => {
    const map = mlRef.current;
    if (!map || !ready) return;
    try {
    const prefixIds = ['ov-'];
    [...map.getStyle().layers.map((l: any) => l.id)]
      .filter(id => prefixIds.some(p => id.startsWith(p)))
      .forEach(id => map.removeLayer(id));
    Object.keys(map.getStyle().sources)
      .filter(s => prefixIds.some(p => s.startsWith(p)))
      .forEach(s => { try { map.removeSource(s); } catch { /* not added */ } });

    const popup = new Popup({ maxWidth: '280px' });
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; popup.remove(); };

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
      map.on('click', 'ov-boundary-fill', (e: any) => {
        const p = e.features?.[0]?.properties as any;
        if (!p?.district) return;
        const s = summaryByBoundary.get(p.district);
        if (!s) {
          popup.setLngLat(e.lngLat).setHTML(`
            <div style="font-family:system-ui;min-width:200px">
              <div style="font-weight:800">${p.district}</div>
              <div style="font-size:11px;color:#64748b">${p.state}</div>
              <div style="font-size:11px;margin-top:4px;color:#b91c1c">
                No platform data for this district — shown as UNKNOWN (never assumed safe).
              </div>
            </div>`).addTo(map);
          return;
        }
        setSelectedDistrict(s.district);
        popup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:system-ui;min-width:230px">
            <div style="font-weight:800;font-size:13px">${s.district}</div>
            <div style="font-size:11px;color:#64748b">${s.state} · boundary: ${s.boundary.status}</div>
            <div style="font-size:11px;margin-top:5px">
              <b>Flood (prototype):</b> ${s.flood_risk.risk_category}<br/>
              <b>Landslide (prototype):</b> ${s.landslide_risk.risk_category}<br/>
              <b>Official warnings:</b> ${s.official_warning_count ? `${s.official_warning_count} (verbatim IMD)` : 'none received'}
            </div>
            <div style="font-size:10px;color:#64748b;margin-top:4px">
              Rainfall 24h: ${s.observed_rainfall_24h ? `${s.observed_rainfall_24h.value.toFixed(1)}mm (${s.data_quality.rainfall})` : 'no observation'} ·
              Verified incidents: ${s.incidents_verified}
            </div>
          </div>`).addTo(map);
      });
      map.on('mouseenter', 'ov-boundary-fill', onEnter);
      map.on('mouseleave', 'ov-boundary-fill', onLeave);
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
            '#94a3b8'
          ],
          'fill-opacity': ['match', ['get', 'flood'], 'UNKNOWN', 0.0, opacity.risk]
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
            '#94a3b8'
          ],
          'fill-opacity': ['match', ['get', 'landslide'], 'UNKNOWN', 0.0, opacity.risk]
        }
      });
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

    /* -- 24h rainfall station circles (only monitored stations with an obs) -- */
    const rainStations = summaries?.districts.flatMap(d =>
      (d.rainfall_24h_all_locations ?? []).map(r => ({
        id: r.location_id,
        dist: d.district,
        name: r.location,
        mm: r.value?.valueOf?.() ?? r.value,
        age: r.age_hours,
        status: d.data_quality.rainfall,
        observed_at: r.observed_at
      }))
    ).filter(s => s.mm != null) ?? [];
    if (layers.rainfall && rainStations.length) {
      map.addSource('ov-rain', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: rainStations.map(s => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.id && (locations.find(l => l.id === s.id)?.longitude ?? 0), locations.find(l => l.id === s.id)?.latitude ?? 0] } as any,
            properties: { ...s, mm: Number(s.mm) }
          })) as any
        }
      });
      map.addLayer({
        id: 'ov-rain-circles', type: 'circle', source: 'ov-rain',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            5, ['*', ['coalesce', ['get', 'mm'], 0], 0.30], 9, ['*', ['coalesce', ['get', 'mm'], 0], 0.65]],
          'circle-color': ['match', ['get', 'status'], 'STALE', '#94a3b8', '#0284c7'],
          'circle-opacity': 0.35,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#0369a1'
        }
      });
      map.on('click', 'ov-rain-circles', (e: any) => {
        const p = e.features?.[0]?.properties as any;
        if (!p) return;
        popup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:system-ui;min-width:200px">
            <div style="font-size:10px;font-weight:800;letter-spacing:.05em;color:#0369a1">RAINFALL 24H OBSERVATION</div>
            <div style="font-weight:800;font-size:13px">${p.name}</div>
            <div style="font-size:11px;color:#64748b">${p.dist}</div>
            <div style="font-size:12px;margin-top:4px"><b>${Number(p.mm).toFixed(1)} mm</b>
              (${p.status}${p.status === 'STALE' ? ` — ${Number(p.age).toFixed(0)}h old, shown gray` : ''})</div>
            <div style="font-size:10px;color:#64748b;margin-top:3px">observed ${p.observed_at ? new Date(p.observed_at).toLocaleString() : '—'} · source: stored IMD station obs</div>
          </div>`).addTo(map);
      });
      map.on('mouseenter', 'ov-rain-circles', onEnter);
      map.on('mouseleave', 'ov-rain-circles', onLeave);
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
      map.on('click', 'ov-shelters-core', (e: any) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        popup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:system-ui;min-width:200px">
            <div style="font-size:10px;font-weight:800;color:#16a34a">VERIFIED SHELTER</div>
            <div style="font-weight:800">${p.name}</div>
            <div style="font-size:11px;color:#64748b">${p.location_name}</div>
            <div style="font-size:11px">Capacity ${p.capacity ?? '—'} (occ ${p.occupancy ?? '—'}) · ${p.status}</div>
          </div>`).addTo(map);
      });
      map.on('mouseenter', 'ov-shelters-core', onEnter);
      map.on('mouseleave', 'ov-shelters-core', onLeave);
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
      map.on('click', 'ov-incidents-core', (e: any) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        popup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:system-ui;min-width:210px">
            <div style="font-size:10px;font-weight:800;color:${p.status === 'VERIFIED' ? '#0f766e' : '#b45309'}">CITIZEN REPORT · ${p.status}</div>
            <div style="font-weight:800;font-size:13px">${p.category}</div>
            <div style="font-size:11px;color:#64748b">${p.location_name}</div>
            <div style="font-size:11px;margin-top:3px">${p.description}</div>
            ${p.status !== 'VERIFIED' ? '<div style="font-size:10px;color:#b45309;margin-top:3px">UNVERIFIED — displayed as a report, never as a confirmed hazard</div>' : ''}
          </div>`).addTo(map);
      });
      map.on('mouseenter', 'ov-incidents-core', onEnter);
      map.on('mouseleave', 'ov-incidents-core', onLeave);
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
      map.on('click', 'ov-history-ring', (e: any) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        popup.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:system-ui;min-width:220px">
            <div style="font-size:10px;font-weight:800;color:${p.hazard_type === 'FLOOD' ? '#1d4ed8' : '#7c3aed'}">VALIDATED ${p.hazard_type} EVENT (HISTORICAL)</div>
            <div style="font-weight:800">${p.location_name}</div>
            <div style="font-size:11px">${new Date(p.event_start).toLocaleDateString()} · severity ${p.severity}</div>
            <div style="font-size:11px;margin-top:3px">${p.description}</div>
          </div>`).addTo(map);
      });
      map.on('mouseenter', 'ov-history-ring', onEnter);
      map.on('mouseleave', 'ov-history-ring', onLeave);
    }
    setOverlayError(null);
    } catch (err: any) {
      console.error('MapBoard overlay error:', err);
      setOverlayError(String(err?.message ?? err));
    }
  }, [ready, styleVersion, summaries, boundaryData, riskGeo, history, layers, locations, alerts, shelters, reports, opacity, selectedDistrict, baseProvider, summaryByBoundary, boundaryFeatures]);

  const prevBaseRef = useRef<BaseMapProvider>(baseProvider);
  useEffect(() => {
    const map = mlRef.current;
    if (!map || !ready) return;
    if (prevBaseRef.current === baseProvider) return;
    prevBaseRef.current = baseProvider;

    try {
      const newStyle = buildBaseStyle({ base: baseProvider });
      map.setStyle(newStyle);
      map.once('style.load', () => {
        setStyleVersion(v => v + 1);
      });
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
    if (d.monitored_locations.length >= 2) {
      const lngs = d.monitored_locations.map(l => l.longitude);
      const lats = d.monitored_locations.map(l => l.latitude);
      map.fitBounds(
        [[Math.min(...lngs) - 0.25, Math.min(...lats) - 0.25], [Math.max(...lngs) + 0.25, Math.max(...lats) + 0.25]],
        { padding: 80, maxZoom: 9.5, duration: 800 }
      );
    } else if (d.monitored_locations.length === 1) {
      const l = d.monitored_locations[0];
      map.flyTo({ center: [l.longitude, l.latitude], zoom: 8.4, duration: 800 });
    }
  };

  const resetView = () => {
    setSelectedDistrict(null);
    mlRef.current?.fitBounds(NE_BOUNDS, { padding: 24, maxZoom: 7, duration: 700 });
  };

  const goFullscreen = () => {
    if (!document.fullscreenElement) mapContainer.current?.closest('.mapboard-shell')?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  const sortedForPanel = useMemo(() => {
    if (!summaries) return [];
    return [...summaries.districts].sort((a, b) =>
      (Math.max(severityRank(b.flood_risk.risk_category), severityRank(b.landslide_risk.risk_category)) -
        Math.max(severityRank(a.flood_risk.risk_category), severityRank(a.landslide_risk.risk_category))));
  }, [summaries]);

  /* ------------------ table filters ------------------ */
  const [stateFilter, setStateFilter] = useState('ALL');
  const [hazardFilter, setHazardFilter] = useState<'ALL' | 'FLOOD' | 'LANDSLIDE'>('ALL');
  const [severityMin, setSeverityMin] = useState(0);
  const [freshFilter, setFreshFilter] = useState('ALL');

  const tableRows = useMemo(() => {
    if (!summaries) return [];
    let rows = summaries.districts
      .filter(d => stateFilter === 'ALL' || d.state === stateFilter)
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
  }, [summaries, stateFilter, hazardFilter, severityMin, freshFilter]);

  return (
    <div className="space-y-4">
      {/* ---- MapBoard shell (fullscreen target) ---- */}
      <div className="mapboard-shell bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        {/* A. Top header */}
        <div className="flex flex-col md:flex-row md:items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-sky-400" />
            <span className="font-black tracking-wide text-sm">NE-SAFE · Disaster Map Board</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-300">
            <Clock className="w-3.5 h-3.5" />
            <span className="tabular-nums">{clock}</span>
          </div>
          <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusPill.tone === 'ok' ? 'bg-emerald-500/20 text-emerald-300' : statusPill.tone === 'warn' ? 'bg-amber-500/20 text-amber-300' : 'bg-red-500/30 text-red-200'}`}>
            <Database className="w-3 h-3 inline mr-1" />{statusPill.label}
          </div>
          {summaries && (
            <div className="text-[10px] text-slate-400">
              generated {new Date(summaries.generated_at).toLocaleTimeString()} · {dataMode}
            </div>
          )}
          <div className="md:ml-auto flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Find district…"
                className="pl-7 pr-2 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500 w-44"
              />
              {search && districtSearchList.length > 0 && (
                <div className="absolute z-[500] mt-1 w-64 max-h-64 overflow-auto bg-slate-800 border border-slate-700 rounded-lg shadow-xl">
                  {districtSearchList.slice(0, 12).map(d => (
                    <button key={d.district} className="flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-slate-700"
                      onClick={() => { flyToDistrict(d); setSearch(''); }}>
                      <span>{d.district} <span className="text-slate-400">({d.state})</span></span>
                      <span className="text-[10px] text-slate-400">{d.flood_risk.risk_category}/{d.landslide_risk.risk_category}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={resetView} className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-bold rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700">
              <MapPin className="w-3.5 h-3.5" /> View all NE India
            </button>
            <button onClick={goFullscreen} className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700" title="Fullscreen">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Main area: left layer panel / map / right district panel */}
        <div className="relative" style={{ height: '72vh', minHeight: 560 }}>
          <div ref={mapContainer} className="absolute inset-0" />
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

          {/* B. Left layer panel */}
          <div className="absolute top-3 left-3 z-[400] w-72 max-h-[85%] overflow-auto bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-slate-200">
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
                    <input type="checkbox" checked={layers[item.key]}
                      onChange={() => setLayers(prev => ({ ...prev, [item.key]: !prev[item.key] }))} />
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
              Boundaries: geohacker/india (public) · EPSG:4326 · 78 NE districts. Aliases (documented): Kamrupa Metropolitan→'Kamrup', Imphal East→'East Imphal', Imphal West→'West Imphal'. Unmatched districts are UNKNOWN, never shaded.
            </div>
          </div>

          {/* D. Right district panel */}
          <div className="absolute top-3 right-3 z-[400] w-80 max-h-[88%] overflow-auto bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-slate-200">
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
          </div>

          {/* B/E. Bottom legend */}
          <div className="absolute bottom-3 left-3 z-[400] bg-white/95 backdrop-blur-sm p-2.5 rounded-lg shadow-md border border-slate-200 text-[11px] text-slate-700">
            <div className="font-bold text-slate-900 mb-1 flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> Legend</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: SEVERITY_COLORS.CRITICAL }} /> Critical (red)</div>
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: SEVERITY_COLORS.HIGH }} /> High (orange)</div>
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: SEVERITY_COLORS.MODERATE }} /> Moderate (yellow)</div>
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: SEVERITY_COLORS.LOW }} /> Low (green)</div>
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: SEVERITY_COLORS.UNKNOWN }} /> Unknown / no data (gray)</div>
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: '#0284c7', opacity: .6 }} /> Rainfall circle (size ∝ mm) {layers.rainfall ? '' : '(off)'}</div>
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: '#16a34a' }} /> Verified shelter {layers.shelters ? '' : '(off)'}</div>
              <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: '#0d9488' }} /> Verified incident · amber = unverified</div>
              <div><span className="inline-block w-3 h-3 my-0.5 align-middle" style={{ height: 3, width: 14, background: '#111827' }} /> Official IMD warning outline</div>
              <div><span className="inline-block w-3 h-3 rounded-full align-middle" style={{ background: 'transparent', border: '2px solid #1d4ed8' }} /> Historical flood · purple = landslide</div>
            </div>
            <div className="text-[10px] text-slate-400 mt-1 border-t border-slate-100 pt-1">
              Risk polygons = PROTOTYPE model {summaries ? new Date(summaries.generated_at).toLocaleTimeString() : ''} · official layers = verbatim IMD station data · NOT certified warnings.
            </div>
          </div>

          {/* F. honest current-conditions strip */}
          {summaries && (
            <div className="absolute bottom-3 right-16 z-[400] bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-slate-200 px-3 py-1.5 text-[10px] text-slate-600">
              <b>Current conditions view</b> · latest stored observations (no artificial history/if timeline: single snapshot) · timezone: IST display via browser locale
            </div>
          )}
        </div>
      </div>

      {/* ---- District summary table ---- */}
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h3 className="text-sm font-bold text-slate-900 mr-2">District summary — affected-area analysis</h3>
          <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}
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
      </div>
    </div>
  );
};
