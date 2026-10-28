import { useEffect, useMemo, useRef } from 'react';
import { Map as MapLibreMap, NavigationControl, Popup, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { NE_BOUNDS, NE_CENTER, NE_ZOOM, boundaryNameFor, SEVERITY_COLORS } from '../../components/mapStyle';

type District = {
  district: string;
  state: string | null;
  monitored_locations: { id: string; latitude: number; longitude: number; name: string }[];
  observed_rainfall_24h: { value: number; unit: string; observed_at: string; age_hours: number; location: string } | null;
  rainfall_status: 'FRESH' | 'STALE' | 'MISSING';
  river_level_all_locations: { value: number; unit: string; observed_at: string; age_hours: number; location: string }[];
  flood_risk: { risk_category: string; probability: number | null };
  landslide_risk: { risk_category: string; probability: number | null };
  official_warning_count: number;
  data_quality: { rainfall: string; river: string; missing_inputs: string[] };
  boundary: { status: string };
};

type FeatureCollection = { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }> };

const palette = SEVERITY_COLORS;
const rank: Record<string, number> = { UNAVAILABLE: 0, UNKNOWN: 0, LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 };

function riskFor(district: District) {
  const flood = district.flood_risk?.risk_category ?? 'UNAVAILABLE';
  const landslide = district.landslide_risk?.risk_category ?? 'UNAVAILABLE';
  return (rank[flood] ?? 0) >= (rank[landslide] ?? 0) ? flood : landslide;
}

function monitoredPointFeatures(districts: District[], selected: District | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: districts.flatMap(district => district.monitored_locations
      .filter(location => Number.isFinite(location.longitude) && Number.isFinite(location.latitude))
      .map(location => ({
        type: 'Feature' as const,
        geometry: { type: 'Point', coordinates: [location.longitude, location.latitude] },
        properties: {
          id: location.id,
          name: location.name,
          district: district.district,
          state: district.state ?? 'Northeast India',
          risk_category: riskFor(district),
          flood_risk: district.flood_risk?.risk_category ?? 'UNKNOWN',
          landslide_risk: district.landslide_risk?.risk_category ?? 'UNKNOWN',
          rainfall_status: district.rainfall_status ?? 'MISSING',
          official_warning_count: district.official_warning_count ?? 0,
          is_selected: selected?.district === district.district && selected?.state === district.state
        }
      })))
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function DistrictRiskMap({ districts, state, selected, onSelect }: {
  districts: District[];
  state: string;
  selected: District | null;
  onSelect: (district: District) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectRef = useRef(onSelect);
  const districtsRef = useRef(districts);
  const selectedRef = useRef(selected);
  const summariesRef = useRef<Map<string, District>>(new Map());
  const boundariesRef = useRef<FeatureCollection | null>(null);
  selectRef.current = onSelect;
  districtsRef.current = districts;
  selectedRef.current = selected;

  const summaryByBoundary = useMemo(() => {
    const map = new Map<string, District>();
    districts.forEach(item => {
      if (item.boundary?.status !== 'UNKNOWN') map.set(boundaryNameFor(item.district) ?? item.district, item);
    });
    return map;
  }, [districts]);
  summariesRef.current = summaryByBoundary;

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: container.current,
      style: {
        version: 8,
        sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
        layers: [{ id: 'base', type: 'raster', source: 'osm' }]
      },
      center: NE_CENTER,
      zoom: NE_ZOOM,
      maxZoom: 10
    });
    map.fitBounds(NE_BOUNDS, { padding: 24, maxZoom: 6.3, duration: 0 });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', async () => {
      try {
        const response = await fetch('/geo/ne_districts.geojson');
        if (!response.ok) return;
        const sourceData = await response.json() as FeatureCollection;
        boundariesRef.current = sourceData;
        const enriched: FeatureCollection = {
          ...sourceData,
          features: sourceData.features.map(feature => {
            const summary = summariesRef.current.get(String(feature.properties.district ?? ''));
            return { ...feature, properties: { ...feature.properties, risk_category: summary ? riskFor(summary) : 'UNKNOWN', is_selected: summary?.district === selectedRef.current?.district && summary?.state === selectedRef.current?.state } };
          })
        };
        map.addSource('districts', { type: 'geojson', data: enriched as never });
        map.addLayer({
          id: 'district-fill', type: 'fill', source: 'districts',
          paint: {
            'fill-color': ['match', ['get', 'risk_category'], 'CRITICAL', palette.CRITICAL, 'HIGH', palette.HIGH, 'MODERATE', palette.MODERATE, 'LOW', palette.LOW, '#94a3b8'],
            'fill-opacity': ['case', ['==', ['get', 'risk_category'], 'UNKNOWN'], 0.16, 0.56]
          }
        });
        map.addLayer({ id: 'district-lines', type: 'line', source: 'districts', paint: { 'line-color': '#fff', 'line-width': 1.1, 'line-opacity': 0.95 } });
        map.addLayer({ id: 'district-selected', type: 'line', source: 'districts', filter: ['==', ['get', 'is_selected'], true], paint: { 'line-color': '#0f172a', 'line-width': 3 } });
        map.addSource('monitored-points', { type: 'geojson', data: monitoredPointFeatures(districtsRef.current, selectedRef.current) as never });
        map.addLayer({
          id: 'monitored-point-circles', type: 'circle', source: 'monitored-points',
          paint: {
            'circle-radius': ['case', ['==', ['get', 'is_selected'], true], 8, 6],
            'circle-color': ['match', ['get', 'risk_category'], 'CRITICAL', palette.CRITICAL, 'HIGH', palette.HIGH, 'MODERATE', palette.MODERATE, 'LOW', palette.LOW, palette.UNKNOWN],
            'circle-stroke-color': ['case', ['==', ['get', 'is_selected'], true], '#0f172a', '#ffffff'],
            'circle-stroke-width': ['case', ['==', ['get', 'is_selected'], true], 2.5, 1.5],
            'circle-opacity': 0.98
          }
        });
        map.addLayer({
          id: 'monitored-point-labels', type: 'symbol', source: 'monitored-points', minzoom: 7,
          layout: { 'text-field': ['get', 'name'], 'text-size': 10, 'text-offset': [0, 1.25], 'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-allow-overlap': false },
          paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }
        });
        map.on('click', 'district-fill', (event: MapLayerMouseEvent) => {
          const properties = event.features?.[0]?.properties;
          if (!properties) return;
          const match = districtsRef.current.find(item => (boundaryNameFor(item.district) ?? item.district) === properties.district && item.state === properties.state);
          if (match) selectRef.current(match);
        });
        map.on('mouseenter', 'district-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'district-fill', () => { map.getCanvas().style.cursor = ''; });
        map.on('click', 'monitored-point-circles', (event: MapLayerMouseEvent) => {
          const properties = event.features?.[0]?.properties;
          if (!properties) return;
          const match = districtsRef.current.find(item => item.district === properties.district && item.state === properties.state);
          if (match) selectRef.current(match);
          new Popup({ closeButton: true, maxWidth: '300px' }).setLngLat(event.lngLat).setHTML(`
            <div style="font-family:system-ui;min-width:210px">
              <div style="font-weight:800">${escapeHtml(properties.name)}</div>
              <div style="font-size:11px;color:#64748b">${escapeHtml(properties.district)}, ${escapeHtml(properties.state)}</div>
              <div style="margin-top:6px;font-size:11px"><b>Prototype risk:</b> ${escapeHtml(properties.risk_category)}<br/><b>Flood:</b> ${escapeHtml(properties.flood_risk)} · <b>Landslide:</b> ${escapeHtml(properties.landslide_risk)}</div>
              <div style="margin-top:5px;font-size:10px;color:#64748b">Rainfall observations: ${escapeHtml(properties.rainfall_status)} · Official warnings: ${escapeHtml(properties.official_warning_count)}</div>
              <div style="margin-top:5px;font-size:10px;color:#64748b">Risk estimates are prototype output. Missing data and no warning record do not mean safe conditions.</div>
            </div>`).addTo(map);
        });
        map.on('mouseenter', 'monitored-point-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'monitored-point-circles', () => { map.getCanvas().style.cursor = ''; });
      } catch (error) {
        console.error('District boundary map could not load', error);
      }
    });
    mapRef.current = map;
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    return () => { resize.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource('districts')) return;
    const sourceData = boundariesRef.current;
    if (!sourceData) return;
    const enriched: FeatureCollection = {
      ...sourceData,
      features: sourceData.features.map(feature => {
        const summary = summaryByBoundary.get(String(feature.properties.district ?? ''));
        return { ...feature, properties: { ...feature.properties, risk_category: summary ? riskFor(summary) : 'UNKNOWN', is_selected: summary?.district === selected?.district && summary?.state === selected?.state } };
      })
    };
    (map.getSource('districts') as GeoJSONSource).setData(enriched as never);
    const points = map.getSource('monitored-points') as GeoJSONSource | undefined;
    points?.setData(monitoredPointFeatures(districts, selected) as never);
  }, [summaryByBoundary, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource('districts')) return;
    map.setFilter('district-fill', state === 'ALL' ? null : ['==', ['get', 'state'], state]);
    map.setFilter('district-lines', state === 'ALL' ? null : ['==', ['get', 'state'], state]);
    map.setFilter('district-selected', state === 'ALL' ? ['==', ['get', 'is_selected'], true] : ['all', ['==', ['get', 'state'], state], ['==', ['get', 'is_selected'], true]]);
    if (map.getLayer('monitored-point-circles')) map.setFilter('monitored-point-circles', state === 'ALL' ? null : ['==', ['get', 'state'], state]);
    if (map.getLayer('monitored-point-labels')) map.setFilter('monitored-point-labels', state === 'ALL' ? null : ['==', ['get', 'state'], state]);
  }, [state]);

  return <div ref={container} className="h-[430px] w-full bg-slate-100 sm:h-[540px]" aria-label="Northeast India district risk map" />;
}

export type { District as DistrictSummary };
