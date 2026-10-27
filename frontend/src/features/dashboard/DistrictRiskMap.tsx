import { useEffect, useMemo, useRef } from 'react';
import { Map as MapLibreMap, NavigationControl, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl';
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
        map.on('click', 'district-fill', (event: MapLayerMouseEvent) => {
          const properties = event.features?.[0]?.properties;
          if (!properties) return;
          const match = districtsRef.current.find(item => (boundaryNameFor(item.district) ?? item.district) === properties.district && item.state === properties.state);
          if (match) selectRef.current(match);
        });
        map.on('mouseenter', 'district-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'district-fill', () => { map.getCanvas().style.cursor = ''; });
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
  }, [summaryByBoundary, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource('districts')) return;
    map.setFilter('district-fill', state === 'ALL' ? null : ['==', ['get', 'state'], state]);
    map.setFilter('district-lines', state === 'ALL' ? null : ['==', ['get', 'state'], state]);
    map.setFilter('district-selected', state === 'ALL' ? ['==', ['get', 'is_selected'], true] : ['all', ['==', ['get', 'state'], state], ['==', ['get', 'is_selected'], true]]);
  }, [state]);

  return <div ref={container} className="h-[430px] w-full bg-slate-100 sm:h-[540px]" aria-label="Northeast India district risk map" />;
}

export type { District as DistrictSummary };
