import React, { useEffect, useRef, useState } from 'react';
import {
  Map as MLMap, Popup, NavigationControl, ScaleControl, FullscreenControl
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LocationItem, PredictionItem, AlertItem, ShelterItem, IncidentReportItem, Language, GeoJSONFeatureCollection, HistoricalEventItem } from '../types';
import { Mountain, Info, MapPin, Radio, ShieldCheck, Megaphone, Layers, CheckCircle2, CloudRain, X } from 'lucide-react';
import {
  buildBaseStyle, NE_BOUNDS, NE_CENTER, NE_ZOOM, BaseMapProvider, defaultBaseProvider, baseProviderLabel, hasMapTilerKey
} from './mapStyle';
import { api, type WeatherLocationItem } from '../api/client';
import { LiveWeatherCard } from './LiveWeatherCard';

interface MapViewProps {
  locations: LocationItem[];
  predictions: PredictionItem[];
  alerts: AlertItem[];
  shelters: ShelterItem[];
  reports: IncidentReportItem[];
  lang: Language;
  onSelectLocation: (location: LocationItem) => void;
}

interface RiskProperty {
  location_id: string;
  name: string;
  state: string;
  district: string;
  location_type: string;
  primary_hazard: string;
  risk_category: string;
  probability: number | null;
  confidence: number | null;
  uncertainty: string;
  ari_mm: number | null;
  flood_category: string;
  landslide_category: string;
  terrain?: LocationItem['terrain'] | null;
  explanation_notes?: string[];
  generated_at?: string;
}

export const MapView: React.FC<MapViewProps> = ({
  locations,
  predictions,
  alerts,
  shelters,
  reports,
  lang: _lang,
  onSelectLocation
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mlRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [selectedState, setSelectedState] = useState<string>('ALL');
  const [baseMapProvider, setBaseMapProvider] = useState<BaseMapProvider>(() => defaultBaseProvider());
  const [styleVersion, setStyleVersion] = useState<number>(0);
  const [layers, setLayers] = useState({ risk: true, terrain: false, history: false, shelters: true, incidents: true, districts: true, weather: true });
  const [riskData, setRiskData] = useState<GeoJSONFeatureCollection | null>(null);
  const [weatherLocations, setWeatherLocations] = useState<WeatherLocationItem[]>([]);
  const [selectedWeatherLocation, setSelectedWeatherLocation] = useState<WeatherLocationItem | null>(null);
  const [weatherLocationsLoading, setWeatherLocationsLoading] = useState(true);
  const [weatherLocationsError, setWeatherLocationsError] = useState<string | null>(null);
  const weatherClickHandler = useRef<((event: any) => void) | null>(null);
  const [history, setHistory] = useState<HistoricalEventItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [boundaryData, setBoundaryData] = useState<GeoJSONFeatureCollection | null>(null);

  const loadLiveLayers = async () => {
    try {
      // Static validated district boundaries (public India boundary data, NE subset)
      const bd = await fetch('/geo/ne_districts.geojson');
      if (bd.ok) setBoundaryData(await bd.json());
      const [geoResult, eventsResult, weatherResult] = await Promise.allSettled([
        api.getRiskGeo(), api.getHistoricalEvents(), api.getWeatherLocations()
      ]);
      if (geoResult.status === 'fulfilled') setRiskData(geoResult.value as GeoJSONFeatureCollection);
      if (eventsResult.status === 'fulfilled') setHistory(eventsResult.value);
      if (weatherResult.status === 'fulfilled') {
        setWeatherLocations(weatherResult.value.locations);
        setWeatherLocationsError(null);
      } else {
        setWeatherLocationsError('Weather monitoring locations are unavailable.');
      }
      setWeatherLocationsLoading(false);
    } catch (e) {
      setWeatherLocationsLoading(false);
      setWeatherLocationsError('Weather monitoring locations are unavailable.');
      console.error('Risk layer fetch failed', e);
    }
  };

  useEffect(() => {
    if (!mapRef.current || mlRef.current) return;
    const initialProvider = defaultBaseProvider();
    const initialStyle = buildBaseStyle({ base: initialProvider });
    const map = new MLMap({
      container: mapRef.current,
      style: initialStyle,
      center: NE_CENTER,
      zoom: NE_ZOOM
    });
    map.fitBounds(NE_BOUNDS, { padding: 24, maxZoom: 7, duration: 600 });
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
      if ((msg.includes('401') || msg.includes('403')) && baseMapProvider !== 'OSM') {
        console.warn('MapTiler key notice on MapView, falling back to OSM:', msg);
        setBaseMapProvider('OSM');
        try { map.setStyle(buildBaseStyle({ base: 'OSM' })); } catch { /* ignore */ }
      }
    });

    mlRef.current = map;
    loadLiveLayers();

    const ro = new ResizeObserver(() => {
      try { map.resize(); } catch { /* ignore */ }
    });
    ro.observe(mapRef.current);

    return () => {
      clearTimeout(safetyTimer);
      ro.disconnect();
      mlRef.current = null;
      map.remove();
    };
  }, []);

  const prevBaseRef = useRef<BaseMapProvider>(baseMapProvider);
  useEffect(() => {
    const map = mlRef.current;
    if (!map || !ready) return;
    if (prevBaseRef.current === baseMapProvider) return;
    prevBaseRef.current = baseMapProvider;

    try {
      const newStyle = buildBaseStyle({ base: baseMapProvider });
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
      console.warn('Failed to switch MapView base style:', err);
      setBaseMapProvider('OSM');
    }
  }, [baseMapProvider, ready]);


  useEffect(() => {
    const map = mlRef.current;
    if (!map || !ready) return;
    try {
      const style = map.getStyle();
      if (style) {
        if (weatherClickHandler.current) {
          map.off('click', 'weather-location-points', weatherClickHandler.current);
          weatherClickHandler.current = null;
        }
        (style.layers || [])
          .filter((l: any) => l.id.startsWith('risk') || l.id.startsWith('terrain') || l.id.startsWith('hist') || l.id.startsWith('shelter') || l.id.startsWith('incident') || l.id.startsWith('boundary') || l.id.startsWith('weather-location'))
          .forEach((l: any) => { try { map.removeLayer(l.id); } catch { /* ignore */ } });
        Object.keys(style.sources || {})
          .filter(s => s.startsWith('risk') || s.startsWith('terrain') || s.startsWith('hist') || s.startsWith('shelter') || s.startsWith('incident') || s.startsWith('boundary') || s.startsWith('weather-location'))
          .forEach(s => { try { map.removeSource(s); } catch { /* not yet added */ } });
      }
    } catch (e) {
      console.warn('MapView layer cleanup warning:', e);
    }

    /* ---- Validated district boundaries (static public dataset, graceful no-op if unloaded) ---- */
    if (layers.districts && boundaryData && (boundaryData as any).features?.length) {
      map.addSource('boundary-src', { type: 'geojson', data: boundaryData });
      map.addLayer({
        id: 'boundary-fill',
        type: 'fill',
        source: 'boundary-src',
        paint: {
          'fill-color': '#334155',
          'fill-opacity': 0.03
        }
      });
      map.addLayer({
        id: 'boundary-line',
        type: 'line',
        source: 'boundary-src',
        paint: {
          'line-color': '#94a3b8',
          'line-width': 1,
          'line-opacity': 0.8
        }
      });
      map.on('click', 'boundary-fill', (e: any) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        new Popup({ maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:system-ui;min-width:170px">
              <div style="font-size:10px;font-weight:800;letter-spacing:.05em;color:#64748b">DISTRICT</div>
              <div style="font-weight:800;font-size:13px">${p.district ?? '—'}</div>
              <div style="font-size:11px;color:#64748b">${p.state}</div>
            </div>`)
          .addTo(map);
      });
    }

    if (riskData && riskData.features) {
      // Flatten nested terrain object for paint expressions
      const flatFeatures = riskData.features.map((f: any) => ({
        ...f,
        properties: {
          ...f.properties,
          susceptibility_score: f.properties?.terrain?.susceptibility_score ?? 0.5,
          slope_deg: f.properties?.terrain?.slope_deg ?? 0,
          explanation_notes: JSON.stringify(f.properties?.explanation_notes ?? [])
        }
      }));
      const flattened: GeoJSONFeatureCollection = {
        type: 'FeatureCollection',
        engine_version: riskData.engine_version,
        generated_at: riskData.generated_at,
        threshold_provenance: riskData.threshold_provenance,
        features: flatFeatures
      };
      map.addSource('risk-src', { type: 'geojson', data: flattened });

      if (layers.terrain) {
        map.addLayer({
          id: 'terrain-halo',
          type: 'circle',
          source: 'risk-src',
          paint: {
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              5, ['*', ['get', 'susceptibility_score'], 60],
              9, ['*', ['get', 'susceptibility_score'], 130]
            ],
            'circle-color': [
              'interpolate', ['linear'],
              ['get', 'susceptibility_score'],
              0.0, '#38bdf8', 0.5, '#facc15', 0.75, '#f97316', 0.9, '#dc2626'
            ],
            'circle-opacity': 0.3,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#7c2d12'
          },
          layout: { visibility: 'visible' }
        });
      }

      if (layers.risk) {
        map.addLayer({
          id: 'risk-core',
          type: 'circle',
          source: 'risk-src',
          paint: {
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              5, ['*', ['coalesce', ['get', 'severity_rank'], 1], 4],
              9, ['*', ['coalesce', ['get', 'severity_rank'], 1], 11]
            ],
            'circle-color': [
              'match', ['coalesce', ['get', 'risk_category'], 'LOW'],
              'CRITICAL', '#dc2626',
              'HIGH', '#f97316',
              'MODERATE', '#f59e0b',
              'LOW', '#10b981',
              '#64748b'
            ],
            'circle-opacity': 0.85,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
          }
        });
      }

      const popup = new Popup({ maxWidth: '300px' });
      map.on('click', 'risk-core', (e: any) => {
        const p: RiskProperty = e.features?.[0]?.properties ? e.features[0].properties : null;
        if (!p) return;
        const parsed: RiskProperty = {
          ...p,
          terrain: typeof p.terrain === 'string' ? JSON.parse(p.terrain) : p.terrain,
          explanation_notes: p.explanation_notes ? (typeof p.explanation_notes === 'string' ? JSON.parse(p.explanation_notes) : p.explanation_notes) : []
        };

        const target = locations.find(loc => loc.id === parsed.location_id);
        if (target) onSelectLocation(target);

        const html = `
          <div style="font-family:system-ui;min-width:230px">
            <div style="font-weight:800;font-size:13px">${parsed.name}</div>
            <div style="font-size:11px;color:#64748b">${parsed.district}, ${parsed.state}</div>
            <div style="margin-top:6px;font-size:11px">
              <b>${parsed.primary_hazard === 'FLOOD' ? 'Flood' : 'Landslide'} risk:</b>
              <span style="font-weight:700">${parsed.risk_category}</span>
              ${parsed.probability != null ? ` (${(parsed.probability * 100).toFixed(0)}%)` : ''}
            </div>
            <div style="font-size:11px">
              <b>Confidence:</b> ${parsed.confidence != null ? (parsed.confidence * 100).toFixed(0) + '%' : 'N/A'} — ${parsed.uncertainty.replace('_', ' ')}
            </div>
            <div style="font-size:10px;color:#64748b;margin-top:3px">
              ARI ${parsed.ari_mm?.toFixed(0) ?? '—'}mm • Engine ${parsed.generated_at ? new Date(parsed.generated_at).toLocaleTimeString() : ''}
            </div>
          </div>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
      map.on('mouseenter', 'risk-core', () => map.getCanvas().style.cursor = 'pointer');
      map.on('mouseleave', 'risk-core', () => { map.getCanvas().style.cursor = ''; popup.remove(); });

      setLastUpdated(riskData.generated_at ?? null);
    }

    /* ---- Weather location points. Values load only after selecting a point. ---- */
    if (layers.weather && weatherLocations.length) {
      map.addSource('weather-location-src', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: weatherLocations.map(location => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [location.longitude, location.latitude] },
            properties: { id: location.id, city: location.city, name: location.name, state: location.state, district: location.district }
          }))
        }
      });
      map.addLayer({
        id: 'weather-location-points',
        type: 'circle',
        source: 'weather-location-src',
        filter: selectedState === 'ALL' ? undefined : ['==', ['get', 'state'], selectedState],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 8, 9],
          'circle-color': '#0f766e',
          'circle-opacity': 0.96,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5
        }
      });
      map.addLayer({
        id: 'weather-location-labels',
        type: 'symbol',
        source: 'weather-location-src',
        filter: selectedState === 'ALL' ? undefined : ['==', ['get', 'state'], selectedState],
        minzoom: 7,
        layout: {
          'text-field': ['get', 'city'],
          'text-size': 10,
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular'],
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-allow-overlap': false
        },
        paint: { 'text-color': '#134e4a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }
      });
      const onWeatherClick = (event: any) => {
        const props = event.features?.[0]?.properties;
        if (!props) return;
        const point = weatherLocations.find(item => item.id === props.id);
        if (point) {
          setSelectedWeatherLocation(point);
          map.easeTo({ center: [point.longitude, point.latitude], zoom: Math.max(map.getZoom(), 7), duration: 450 });
        }
      };
      weatherClickHandler.current = onWeatherClick;
      map.on('click', 'weather-location-points', onWeatherClick);
    }

    if (layers.history && history.length) {
      const points = history.filter(h => h.latitude != null && h.longitude != null);
      map.addSource('hist-src', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: points.map(h => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [h.longitude!, h.latitude!] },
            properties: h as any
          }))
        }
      });
      map.addLayer({
        id: 'hist-ring',
        type: 'circle',
        source: 'hist-src',
        paint: {
          'circle-radius': 10,
          'circle-color': ['match', ['get', 'hazard_type'], 'FLOOD', '#2563eb', '#7c3aed'],
          'circle-opacity': 0.25,
          'circle-stroke-width': 2,
          'circle-stroke-color': ['match', ['get', 'hazard_type'], 'FLOOD', '#1d4ed8', '#5b21b6']
        }
      });
      map.on('click', 'hist-ring', (e: any) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        new Popup({ maxWidth: '300px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:system-ui;min-width:240px">
              <div style="font-size:10px;font-weight:800;letter-spacing:.05em;color:${p.hazard_type === 'FLOOD' ? '#1d4ed8' : '#7c3aed'}">VALIDATED ${p.hazard_type} EVENT</div>
              <div style="font-weight:800;font-size:13px">${p.location_name}</div>
              <div style="font-size:11px">${new Date(p.event_start).toLocaleDateString()} — severity ${p.severity}</div>
              <div style="font-size:11px;margin-top:4px">${p.description}</div>
              <div style="font-size:10px;color:#64748b;margin-top:4px">Source: ${p.source_reference}</div>
            </div>`)
          .addTo(map);
      });
      map.on('mouseenter', 'hist-ring', () => map.getCanvas().style.cursor = 'pointer');
      map.on('mouseleave', 'hist-ring', () => map.getCanvas().style.cursor = '');
    }

    /* ---- Verified shelters layer (always shown status data from /shelters) ---- */
    if (layers.shelters && shelters.length) {
      const shelterPoints = shelters.filter(s => s.latitude != null && s.longitude != null);
      if (shelterPoints.length) {
        map.addSource('shelter-src', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: shelterPoints.map(s => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [s.longitude!, s.latitude!] },
              properties: {
                id: s.id,
                name: s.name,
                type: 'SHELTER',
                capacity: s.capacity ?? null,
                occupancy: s.current_occupancy ?? null,
                status: s.operational_status,
                location_name: s.location_name ?? ''
              }
            }))
          }
        });
        map.addLayer({
          id: 'shelter-core',
          type: 'circle',
          source: 'shelter-src',
          paint: {
            'circle-radius': 8,
            'circle-color': '#16a34a',
            'circle-opacity': 0.9,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
          }
        });
        map.on('click', 'shelter-core', (e: any) => {
          const p = e.features?.[0]?.properties;
          if (!p) return;
          new Popup({ maxWidth: '280px' })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font-family:system-ui;min-width:220px">
                <div style="font-size:10px;font-weight:800;letter-spacing:.05em;color:#16a34a">VERIFIED SHELTER</div>
                <div style="font-weight:800;font-size:13px">${p.name}</div>
                <div style="font-size:11px;color:#64748b">${p.location_name}</div>
                <div style="font-size:11px;margin-top:4px">Type: ${p.type}</div>
                <div style="font-size:11px">Capacity: ${p.capacity ?? '—'} (occupied ${p.occupancy ?? '—'}) · Status: ${p.status}</div>
              </div>`)
            .addTo(map);
        });
        map.on('mouseenter', 'shelter-core', () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', 'shelter-core', () => map.getCanvas().style.cursor = '');
      }
    }

    /* ---- Citizen incident reports layer (UNVERIFIED marker until reviewed) ---- */
    if (layers.incidents && reports.length) {
      const incidentPoints = reports.filter(r => r.latitude != null && r.longitude != null);
      if (incidentPoints.length) {
        map.addSource('incident-src', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: incidentPoints.map(r => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [r.longitude!, r.latitude!] },
              properties: {
                id: r.id,
                category: r.category,
                status: r.verification_status,
                description: r.description ?? '',
                location_name: r.location_name ?? '',
                reported_at: r.report_time ?? ''
              }
            }))
          }
        });
        map.addLayer({
          id: 'incident-core',
          type: 'circle',
          source: 'incident-src',
          paint: {
            'circle-radius': 7,
            'circle-color': [
              'match', ['get', 'status'],
              'VERIFIED', '#0d9488',
              'REJECTED', '#94a3b8',
              '#f59e0b' /* UNVERIFIED */
            ],
            'circle-opacity': 0.85,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
          }
        });
        map.on('click', 'incident-core', (e: any) => {
          const p = e.features?.[0]?.properties;
          if (!p) return;
          new Popup({ maxWidth: '280px' })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font-family:system-ui;min-width:220px">
                <div style="font-size:10px;font-weight:800;letter-spacing:.05em;color:${p.status === 'VERIFIED' ? '#0f766e' : '#b45309'}">CITIZEN REPORT · ${p.status}</div>
                <div style="font-weight:800;font-size:13px">${p.category}</div>
                <div style="font-size:11px;color:#64748b">${p.location_name}</div>
                <div style="font-size:11px;margin-top:4px">${p.description}</div>
                <div style="font-size:10px;color:#64748b;margin-top:4px">${p.reported_at ? new Date(p.reported_at).toLocaleString() : ''}</div>
              </div>`)
            .addTo(map);
        });
        map.on('mouseenter', 'incident-core', () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', 'incident-core', () => map.getCanvas().style.cursor = '');
      }
    }
  }, [ready, styleVersion, riskData, history, layers, baseMapProvider, locations, predictions, alerts, shelters, reports, boundaryData, weatherLocations, selectedState]);

  const flyToState = (state: string) => {
    setSelectedState(state);
    const map = mlRef.current;
    if (!map) return;
    const weatherLocs = weatherLocations.filter(l => state === 'ALL' || l.state === state);
    const locs = weatherLocs.length ? weatherLocs : state === 'ALL' ? locations : locations.filter(l => l.state === state);
    if (locs.length) {
      const lats = locs.map(l => l.latitude);
      const lngs = locs.map(l => l.longitude);
      map.fitBounds(
        [[Math.min(...lngs) - 0.6, Math.min(...lats) - 0.6], [Math.max(...lngs) + 0.6, Math.max(...lats) + 0.6]],
        { padding: 60, maxZoom: 9.5, duration: 900 }
      );
    }
  };

  const toggleLayer = (key: 'risk' | 'terrain' | 'history' | 'shelters' | 'incidents' | 'districts' | 'weather') => setLayers(prev => ({ ...prev, [key]: !prev[key] }));

  const activeAlertCount = alerts.filter(a => a.lifecycle_status === 'ISSUED' || a.lifecycle_status === 'PROPOSED').length;

  return (
    <div className="relative bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-[640px]">
      <div ref={mapRef} className="absolute inset-0 w-full h-full" />
      {!ready && (
        <div className="absolute inset-0 z-[350] flex items-center justify-center bg-slate-100/70 text-sm font-bold text-slate-500">
          Rendering Northeast India map…
        </div>
      )}

      {/* State selector + layer switches */}
      <div className="absolute top-4 left-4 z-[400] flex flex-wrap items-center gap-2">
        <div className="bg-white/95 backdrop-blur-sm p-1 rounded-lg shadow-md border border-slate-200 flex items-center gap-1.5 px-2">
          <MapPin className="w-3.5 h-3.5 text-blue-600" />
          <select
            value={selectedState}
            onChange={(e) => flyToState(e.target.value)}
            className="text-xs font-bold bg-transparent border-none text-slate-800 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All 8 Northeast States (NER)</option>
            {["Assam", "Arunachal Pradesh", "Meghalaya", "Manipur", "Mizoram", "Nagaland", "Tripura", "Sikkim"].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="bg-white/95 backdrop-blur-sm p-1 rounded-lg shadow-md border border-slate-200 flex items-center gap-1">
          <button
            onClick={() => toggleLayer('weather')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md transition-all ${layers.weather ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            aria-pressed={layers.weather}
          >
            <CloudRain className="w-3.5 h-3.5" /> Weather points
          </button>
          <button
            onClick={() => toggleLayer('risk')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md transition-all ${layers.risk ? 'bg-red-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Radio className="w-3.5 h-3.5" />
            Live AI Risk
          </button>
          <button
            onClick={() => toggleLayer('terrain')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md transition-all ${layers.terrain ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Mountain className="w-3.5 h-3.5" />
            Terrain / GSI Susceptibility
          </button>
          <button
            onClick={() => toggleLayer('history')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md transition-all ${layers.history ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Info className="w-3.5 h-3.5" />
            Validated History
          </button>
          <button
            onClick={() => toggleLayer('shelters')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md transition-all ${layers.shelters ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Shelters
          </button>
          <button
            onClick={() => toggleLayer('incidents')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md transition-all ${layers.incidents ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Megaphone className="w-3.5 h-3.5" />
            Citizen Reports
          </button>
          <button
            onClick={() => toggleLayer('districts')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md transition-all ${layers.districts ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Layers className="w-3.5 h-3.5" />
            Districts
          </button>
        </div>

        <div className="bg-white/95 backdrop-blur-sm p-1 rounded-lg shadow-md border border-slate-200 flex items-center gap-1">
          {hasMapTilerKey() && (
            <span className="text-[10px] font-bold text-teal-700 flex items-center gap-1 px-1.5 hidden sm:flex">
              <CheckCircle2 className="w-3 h-3 text-teal-600" />
              MapTiler
            </span>
          )}
          {(['MAPTILER_STREETS', 'MAPTILER_OUTDOOR', 'SATELLITE', 'OSM'] as BaseMapProvider[]).map(p => (
            <button
              key={p}
              onClick={() => setBaseMapProvider(p)}
              className={`px-2 py-1 text-[11px] font-bold rounded-md transition-all ${
                baseMapProvider === p
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {baseProviderLabel(p)}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-[400] bg-white/95 backdrop-blur-sm p-2.5 rounded-lg shadow-md border border-slate-200 text-xs font-medium text-slate-700">
        <div className="font-bold text-slate-900 mb-1.5 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-blue-600" />
          <span>NER Risk Layers (MapLibre)</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-teal-700" /><span>Weather point · select for conditions</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-600" /><span>CRITICAL</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-orange-500" /><span>HIGH</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /><span>MODERATE</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /><span>LOW / normal</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-600 opacity-60" /><span>Historical flood</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-violet-600 opacity-60" /><span>Historical landslide</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-teal-600" /><span>Verified shelter</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /><span>Report (unverified)</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-teal-500" /><span>Report (verified)</span></div>
        </div>
        <div className="legend-attribution">
          Boundaries: public India district dataset (geohacker/india) · Map tiles © OpenStreetMap / Esri
        </div>
        {lastUpdated && (
          <div className="text-[10px] text-slate-400 mt-1.5 border-t border-slate-100 pt-1">
            Assessment updated {new Date(lastUpdated).toLocaleTimeString()} • See source details for threshold provenance
          </div>
        )}
      </div>

      {selectedWeatherLocation && (
        <aside className="absolute right-3 top-16 z-[410] w-[min(390px,calc(100%-1.5rem))] max-h-[calc(100%-5rem)] overflow-y-auto rounded-xl bg-white/95 p-2 shadow-xl backdrop-blur-sm" aria-label="Selected weather location">
          <div className="flex items-center justify-between px-2 pb-1">
            <div><p className="text-[10px] font-bold uppercase tracking-wide text-teal-800">Selected weather point</p><p className="text-xs text-slate-500">{selectedWeatherLocation.district}, {selectedWeatherLocation.state}</p></div>
            <button onClick={() => setSelectedWeatherLocation(null)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close selected weather point"><X className="h-4 w-4" /></button>
          </div>
          <p className="px-2 pb-2 text-[10px] text-slate-500">Coordinates: {selectedWeatherLocation.latitude.toFixed(4)}, {selectedWeatherLocation.longitude.toFixed(4)} · <a className="underline decoration-teal-500 underline-offset-2" href={selectedWeatherLocation.coordinate_reference_url} target="_blank" rel="noreferrer">{selectedWeatherLocation.coordinate_source}</a></p>
          <LiveWeatherCard location={selectedWeatherLocation.name} locationId={selectedWeatherLocation.id} />
        </aside>
      )}
      {layers.weather && !weatherLocations.length && (weatherLocationsLoading || weatherLocationsError) && (
        <div className="absolute right-3 top-16 z-[410] rounded-lg border border-slate-200 bg-white/95 p-3 text-xs text-slate-700 shadow" role="status">
          {weatherLocationsLoading ? 'Loading weather monitoring points…' : weatherLocationsError}
        </div>
      )}

      {activeAlertCount > 0 && (
        <div className="absolute top-4 right-14 z-[400] bg-red-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shadow">
          {activeAlertCount} active alert(s) on map
        </div>
      )}

      {!ready && (
        <div className="absolute inset-0 z-[350] flex items-center justify-center bg-slate-100/70 text-sm font-bold text-slate-500">
          Rendering MapLibre map of Northeast India...
        </div>
      )}
    </div>
  );
};
