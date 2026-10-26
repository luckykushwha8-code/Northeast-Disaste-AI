import {
  LocationItem, DataSourceItem, ObservationItem, PredictionItem,
  AlertItem, ShelterItem, IncidentReportItem, AuditLogItem, ModelVersionItem,
  LiveNewsFeedItem, LiveDataSyncItem,
  RescueRequestItem, RescueRequestCreate, UpdateRescueStatusPayload, AnalyticsOverview,
  ImdApiStatus, AlertDistrictItem, SubscriptionResult,
  TinyFishStatus, TinyFishRetrievalRequest, TinyFishRetrievalResult, AuthenticatedUser
} from '../types';

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? '/api/v1' : 'http://127.0.0.1:8000/api/v1');
const AUTH_TOKEN_KEY = 'nesafe.session-token';

async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401 && token) {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    window.dispatchEvent(new Event('nesafe:auth-expired'));
  }
  return response;
}

export const api = {
  async explainDistrictRisk(district: string, state: string) {
    const res = await apiFetch(`${API_BASE}/ai/district-explanation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ district, state })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || 'Could not explain district risk');
    return data;
  },

  async summarizeSituationReport() {
    const res = await apiFetch(`${API_BASE}/ai/report-summary`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || 'Could not summarize the report');
    return data;
  },

  async askPreparednessAssistant(question: string) {
    const res = await apiFetch(`${API_BASE}/ai/preparedness`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || 'Assistant is unavailable');
    return data;
  },

  async login(username: string, password: string): Promise<AuthenticatedUser> {
    const res = await apiFetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || 'Login failed');
    sessionStorage.setItem(AUTH_TOKEN_KEY, data.access_token);
    return data.user as AuthenticatedUser;
  },

  async getCurrentUser(): Promise<AuthenticatedUser> {
    const res = await apiFetch(`${API_BASE}/auth/me`);
    if (!res.ok) throw new Error('Login required');
    return res.json();
  },

  logout() {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
  },

  async getHealth() {
    const res = await apiFetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error("Health check failed");
    return res.json();
  },

  async getLocations(): Promise<LocationItem[]> {
    const res = await apiFetch(`${API_BASE}/locations`);
    if (!res.ok) throw new Error("Failed to fetch locations");
    return res.json();
  },

  async getDataStatus(): Promise<DataSourceItem[]> {
    const res = await apiFetch(`${API_BASE}/system/data-status`);
    if (!res.ok) throw new Error("Failed to fetch data status");
    return res.json();
  },

  async getObservations(params?: { location_id?: string; variable?: string }): Promise<ObservationItem[]> {
    const query = new URLSearchParams(params as any).toString();
    const res = await apiFetch(`${API_BASE}/observations?${query}`);
    if (!res.ok) throw new Error("Failed to fetch observations");
    return res.json();
  },

  async getPredictions(params?: { location_id?: string; hazard_type?: string }): Promise<PredictionItem[]> {
    const query = new URLSearchParams(params as any).toString();
    const res = await apiFetch(`${API_BASE}/predictions?${query}`);
    if (!res.ok) throw new Error("Failed to fetch predictions");
    return res.json();
  },

  async generatePredictions(): Promise<any> {
    const res = await apiFetch(`${API_BASE}/predictions/generate`, { method: 'POST' });
    if (!res.ok) throw new Error("Failed to generate assessments");
    return res.json();
  },

  async getAlerts(params?: { lifecycle_status?: string; hazard_type?: string }): Promise<AlertItem[]> {
    const query = new URLSearchParams(params as any).toString();
    const res = await apiFetch(`${API_BASE}/alerts?${query}`);
    if (!res.ok) throw new Error("Failed to fetch alerts");
    return res.json();
  },

  async createAlert(data: {
    location_id: string;
    hazard_type: string;
    severity: string;
    title: string;
    description: string;
    action_instructions: string;
    simulation_flag?: boolean;
  }): Promise<AlertItem> {
    const res = await apiFetch(`${API_BASE}/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error("Failed to create alert proposal");
    return res.json();
  },

  async approveAlert(alertId: string, reason?: string): Promise<AlertItem> {
    const res = await apiFetch(`${API_BASE}/alerts/${alertId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Approval failed");
    }
    return res.json();
  },

  async acknowledgeAlert(alertId: string): Promise<AlertItem> {
    const res = await apiFetch(`${API_BASE}/alerts/${alertId}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!res.ok) throw new Error("Acknowledgement failed");
    return res.json();
  },

  async resolveAlert(alertId: string): Promise<AlertItem> {
    const res = await apiFetch(`${API_BASE}/alerts/${alertId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!res.ok) throw new Error("Resolution failed");
    return res.json();
  },

  async getShelters(): Promise<ShelterItem[]> {
    const res = await apiFetch(`${API_BASE}/shelters`);
    if (!res.ok) throw new Error("Failed to fetch shelters");
    return res.json();
  },

  async getReports(): Promise<IncidentReportItem[]> {
    const res = await apiFetch(`${API_BASE}/reports`);
    if (!res.ok) throw new Error("Failed to fetch reports");
    return res.json();
  },

  async submitReport(data: {
    reporter_name: string;
    category: string;
    location_name: string;
    latitude: number;
    longitude: number;
    description: string;
  }): Promise<IncidentReportItem> {
    const res = await apiFetch(`${API_BASE}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error("Failed to submit report");
    return res.json();
  },

  async verifyReport(reportId: string, status: string): Promise<IncidentReportItem> {
    const res = await apiFetch(`${API_BASE}/reports/${reportId}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error("Failed to verify report");
    return res.json();
  },

  async getAuditLogs(): Promise<AuditLogItem[]> {
    const res = await apiFetch(`${API_BASE}/system/audit-logs`);
    if (!res.ok) throw new Error("Failed to fetch audit logs");
    return res.json();
  },

  async getModels(): Promise<ModelVersionItem[]> {
    const res = await apiFetch(`${API_BASE}/models`);
    if (!res.ok) throw new Error("Failed to fetch models");
    return res.json();
  },

  async triggerScenario(scenario: string): Promise<any> {
    const res = await apiFetch(`${API_BASE}/simulation/scenario/${scenario}`, { method: 'POST' });
    if (!res.ok) throw new Error(`Failed to trigger scenario ${scenario}`);
    return res.json();
  },

  async getImdWarnings(): Promise<any> {
    const res = await apiFetch(`${API_BASE}/sources/imd/warnings`);
    if (!res.ok) throw new Error("Failed to fetch IMD warnings");
    return res.json();
  },

  async getCwcStations(): Promise<any> {
    const res = await apiFetch(`${API_BASE}/sources/cwc/stations`);
    if (!res.ok) throw new Error("Failed to fetch CWC stations");
    return res.json();
  },

  async getGsiSusceptibility(): Promise<any> {
    const res = await apiFetch(`${API_BASE}/sources/gsi/susceptibility`);
    if (!res.ok) throw new Error("Failed to fetch GSI susceptibility");
    return res.json();
  },

  async getBhuvanLayers(): Promise<any> {
    const res = await apiFetch(`${API_BASE}/sources/bhuvan/layers`);
    if (!res.ok) throw new Error("Failed to fetch Bhuvan layers");
    return res.json();
  },

  async syncLiveData(): Promise<LiveDataSyncItem> {
    const res = await apiFetch(`${API_BASE}/data/sync`, { method: 'POST' });
    if (!res.ok) throw new Error("Live data sync failed");
    return res.json();
  },

  async getLiveNews(hazardOnly?: boolean): Promise<LiveNewsFeedItem> {
    const q = hazardOnly ? '?hazard_only=true' : '';
    const res = await apiFetch(`${API_BASE}/data/live-news${q}`);
    if (!res.ok) throw new Error("Failed to fetch live news");
    return res.json();
  },

  async getAnalyticsOverview(hoursWindow?: number): Promise<AnalyticsOverview> {
    const q = hoursWindow ? `?hours_window=${hoursWindow}` : '';
    const res = await apiFetch(`${API_BASE}/analytics/overview${q}`);
    if (!res.ok) throw new Error("Failed to load analytics");
    return res.json();
  },

  async submitRescueRequest(payload: RescueRequestCreate): Promise<RescueRequestItem> {
    const res = await apiFetch(`${API_BASE}/rescue-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Failed to submit rescue request");
    return res.json();
  },

  async trackRescueRequest(errorOrPublicReferenceIgnored: string): Promise<RescueRequestItem[]> {
    const res = await apiFetch(`${API_BASE}/rescue-requests?public_reference=${encodeURIComponent(errorOrPublicReferenceIgnored)}`);
    if (!res.ok) throw new Error("Failed to track rescue request");
    return res.json();
  },

  async listRescueRequests(status?: string): Promise<RescueRequestItem[]> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await apiFetch(`${API_BASE}/rescue-requests${q}`);
    if (!res.ok) throw new Error("Failed to list rescue requests");
    return res.json();
  },

  async updateRescueRequestStatus(requestId: string, payload: UpdateRescueStatusPayload): Promise<RescueRequestItem> {
    const res = await apiFetch(`${API_BASE}/rescue-requests/${requestId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || "Failed to update rescue status");
    }
    return res.json();
  },

  getReportUrl(format: 'pdf' | 'csv'): string {
    return `${API_BASE}/reports/situation?format=${format}`;
  },

  async getImdApiStatus(): Promise<ImdApiStatus> {
    const res = await apiFetch(`${API_BASE}/imd/status`);
    if (!res.ok) throw new Error("Failed to fetch IMD REST status");
    return res.json();
  },

  async runImdSync(): Promise<any> {
    const res = await apiFetch(`${API_BASE}/imd/sync`, { method: 'POST' });
    if (!res.ok) throw new Error("IMD REST refresh failed");
    return res.json();
  },

  async getAlertDistricts(): Promise<AlertDistrictItem[]> {
    const res = await apiFetch(`${API_BASE}/alerts/districts`);
    if (!res.ok) throw new Error("Failed to fetch alert districts");
    return res.json();
  },

  async subscribeToAlerts(email: string, district: string, consent: boolean): Promise<SubscriptionResult> {
    const res = await apiFetch(`${API_BASE}/alerts/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, district, consent })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data?.detail || "Subscription failed");
      (err as any).response = { data: data ?? {} };
      throw err;
    }
    return res.json();
  },

  async unsubscribeFromAlerts(email: string, district: string): Promise<any> {
    const res = await apiFetch(`${API_BASE}/alerts/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, district, consent: false })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data?.detail || "Unsubscribe failed");
      (err as any).response = { data: data ?? {} };
      throw err;
    }
    return res.json();
  },

  async getTinyFishStatus(): Promise<TinyFishStatus> {
    const res = await apiFetch(`${API_BASE}/sources/tinyfish/status`);
    if (!res.ok) throw new Error("Failed to fetch TinyFish status");
    return res.json();
  },

  async requestTinyFishRetrieval(payload: TinyFishRetrievalRequest): Promise<TinyFishRetrievalResult> {
    const res = await apiFetch(`${API_BASE}/sources/tinyfish/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.detail || "TinyFish retrieval failed");
    }
    return res.json();
  },

  async getTinyFishHistory(limit = 20): Promise<TinyFishRetrievalResult[]> {
    const res = await apiFetch(`${API_BASE}/sources/tinyfish/history?limit=${limit}`);
    if (!res.ok) throw new Error("Failed to fetch TinyFish extraction history");
    return res.json();
  }
};
