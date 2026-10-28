import { API_BASE } from './client';

export interface WeatherLocationItem {
  id: string;
  city: string;
  name: string;
  state: string;
  district: string;
  latitude: number;
  longitude: number;
  location_type: string;
  coordinate_source: string;
  coordinate_reference_url: string;
}

export interface WeatherForecastItem {
  forecast_at: string;
  precipitation_probability?: number | null;
  rainfall_3h_mm?: number | null;
}

export interface WeatherForecastResponse {
  location_id: string;
  source: string;
  forecast: WeatherForecastItem[];
  retrieved_at: string;
  data_mode: 'LIVE' | 'CACHED' | 'UNAVAILABLE';
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Weather API returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export function getWeatherLocations() {
  return getJson<{ locations: WeatherLocationItem[] }>('/weather/locations');
}

export function getWeatherForecast(locationId: string) {
  const query = new URLSearchParams({ location_id: locationId, provider: 'openweather' });
  return getJson<WeatherForecastResponse>(`/weather/forecast?${query}`);
}
