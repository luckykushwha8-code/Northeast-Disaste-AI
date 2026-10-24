import {
  LocationItem, DataSourceItem, ObservationItem, PredictionItem,
  AlertItem, ShelterItem, IncidentReportItem, AuditLogItem, ModelVersionItem,
  LiveNewsFeedItem, LiveDataSyncItem,
  RescueRequestItem, RescueRequestCreate, UpdateRescueStatusPayload, AnalyticsOverview,
  ImdApiStatus, AlertDistrictItem, SubscriptionResult,
  TinyFishStatus, TinyFishRetrievalRequest, TinyFishRetrievalResult
} from '../types';

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api/v1';

export const api = {
  async getHealth() {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error("Health check failed");
    return res.json();
  },

  async getLocations(): Promise<LocationItem[]> {
    const res = await fetch(`${API_BASE}/locations`);
    if (!res.ok) throw new Error("Failed to fetch locations");
    return res.json();
  },

  async getDataStatus(): Promise<DataSourceItem[]> {
    const res = await fetch(`${API_BASE}/system/data-status`);
    if (!res.ok) throw new Error("Failed to fetch data status");
    return res.json();
  },

  async getObservations(params?: { location_id?: string; variable?: string }): Promise<ObservationItem[]> {
    const query = new URLSearchParams(params as any).toString();
    const res = await fetch(`${API_BASE}/observations?${query}`);
    if (!res.ok) throw new Error("Failed to fetch observations");
    return res.json();
  },

  async getPredictions(params?: { location_id?: string; hazard_type?: string }): Promise<PredictionItem[]> {
    const query = new URLSearchParams(params as any).toString();
    const res = await fetch(`${API_BASE}/predictions?${query}`);
    if (!res.ok) throw new Error("Failed to fetch predictions");
    return res.json();
  },

  async generatePredictions(): Promise<any> {
    const res = await fetch(`${API_BASE}/predictions/generate`, { method: 'POST' });
    if (!res.ok) throw new Error("Failed to generate assessments");
    return res.json();
  },

  async getAlerts(params?: { lifecycle_status?: string; hazard_type?: string }): Promise<AlertItem[]> {
    const query = new URLSearchParams(params as any).toString();
    const res = await fetch(`${API_BASE}/alerts?${query}`);
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
    const res = await fetch(`${API_BASE}/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error("Failed to create alert proposal");
    return res.json();
  },

  async approveAlert(alertId: string, actorId: string, role: string, reason?: string): Promise<AlertItem> {
    const res = await fetch(`${API_BASE}/alerts/${alertId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-role': role
      },
      body: JSON.stringify({ actor_id: actorId, reason })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Approval failed");
    }
    return res.json();
  },

  async acknowledgeAlert(alertId: string, actorId: string, role: string): Promise<AlertItem> {
    const res = await fetch(`${API_BASE}/alerts/${alertId}/acknowledge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-role': role
      },
      body: JSON.stringify({ actor_id: actorId })
    });
    if (!res.ok) throw new Error("Acknowledgement failed");
    return res.json();
  },

  async resolveAlert(alertId: string, actorId: string, role: string): Promise<AlertItem> {
    const res = await fetch(`${API_BASE}/alerts/${alertId}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-role': role
      },
      body: JSON.stringify({ actor_id: actorId })
    });
    if (!res.ok) throw new Error("Resolution failed");
    return res.json();
  },

  async getShelters(): Promise<ShelterItem[]> {
    const res = await fetch(`${API_BASE}/shelters`);
    if (!res.ok) throw new Error("Failed to fetch shelters");
    return res.json();
  },

  async getReports(): Promise<IncidentReportItem[]> {
    const res = await fetch(`${API_BASE}/reports`);
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
    const res = await fetch(`${API_BASE}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error("Failed to submit report");
    return res.json();
  },

  async verifyReport(reportId: string, status: string, reviewerId: string, role: string): Promise<IncidentReportItem> {
    const res = await fetch(`${API_BASE}/reports/${reportId}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-role': role
      },
      body: JSON.stringify({ reviewer_id: reviewerId, status })
    });
    if (!res.ok) throw new Error("Failed to verify report");
    return res.json();
  },

  async getAuditLogs(): Promise<AuditLogItem[]> {
    const res = await fetch(`${API_BASE}/system/audit-logs`);
    if (!res.ok) throw new Error("Failed to fetch audit logs");
    return res.json();
  },

  async getModels(): Promise<ModelVersionItem[]> {
    const res = await fetch(`${API_BASE}/models`);
    if (!res.ok) throw new Error("Failed to fetch models");
    return res.json();
  },

  async triggerScenario(scenario: string): Promise<any> {
    const res = await fetch(`${API_BASE}/simulation/scenario/${scenario}`, { method: 'POST' });
    if (!res.ok) throw new Error(`Failed to trigger scenario ${scenario}`);
    return res.json();
  },

  async getImdWarnings(): Promise<any> {
    const res = await fetch(`${API_BASE}/sources/imd/warnings`);
    if (!res.ok) throw new Error("Failed to fetch IMD warnings");
    return res.json();
  },

  async getCwcStations(): Promise<any> {
    const res = await fetch(`${API_BASE}/sources/cwc/stations`);
    if (!res.ok) throw new Error("Failed to fetch CWC stations");
    return res.json();
  },

  async getGsiSusceptibility(): Promise<any> {
    const res = await fetch(`${API_BASE}/sources/gsi/susceptibility`);
    if (!res.ok) throw new Error("Failed to fetch GSI susceptibility");
    return res.json();
  },

  async getBhuvanLayers(): Promise<any> {
    const res = await fetch(`${API_BASE}/sources/bhuvan/layers`);
    if (!res.ok) throw new Error("Failed to fetch Bhuvan layers");
    return res.json();
  },

  async syncLiveData(): Promise<LiveDataSyncItem> {
    const res = await fetch(`${API_BASE}/data/sync`, { method: 'POST' });
    if (!res.ok) throw new Error("Live data sync failed");
    return res.json();
  },

  async getLiveNews(hazardOnly?: boolean): Promise<LiveNewsFeedItem> {
    const q = hazardOnly ? '?hazard_only=true' : '';
    const res = await fetch(`${API_BASE}/data/live-news${q}`);
    if (!res.ok) throw new Error("Failed to fetch live news");
    return res.json();
  },

  async getAnalyticsOverview(hoursWindow?: number): Promise<AnalyticsOverview> {
    const q = hoursWindow ? `?hours_window=${hoursWindow}` : '';
    const res = await fetch(`${API_BASE}/analytics/overview${q}`);
    if (!res.ok) throw new Error("Failed to load analytics");
    return res.json();
  },

  async submitRescueRequest(payload: RescueRequestCreate): Promise<RescueRequestItem> {
    const res = await fetch(`${API_BASE}/rescue-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Failed to submit rescue request");
    return res.json();
  },

  async trackRescueRequest(errorOrPublicReferenceIgnored: string): Promise<RescueRequestItem[]> {
    const res = await fetch(`${API_BASE}/rescue-requests?public_reference=${encodeURIComponent(errorOrPublicReferenceIgnored)}`);
    if (!res.ok) throw new Error("Failed to track rescue request");
    return res.json();
  },

  async listRescueRequests(status?: string): Promise<RescueRequestItem[]> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await fetch(`${API_BASE}/rescue-requests${q}`);
    if (!res.ok) throw new Error("Failed to list rescue requests");
    return res.json();
  },

  async updateRescueRequestStatus(requestId: string, payload: UpdateRescueStatusPayload): Promise<RescueRequestItem> {
    const res = await fetch(`${API_BASE}/rescue-requests/${requestId}/status`, {
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
    const res = await fetch(`${API_BASE}/imd/status`);
    if (!res.ok) throw new Error("Failed to fetch IMD REST status");
    return res.json();
  },

  async runImdSync(): Promise<any> {
    const res = await fetch(`${API_BASE}/imd/sync`, { method: 'POST' });
    if (!res.ok) throw new Error("IMD REST refresh failed");
    return res.json();
  },

  async getAlertDistricts(): Promise<AlertDistrictItem[]> {
    const res = await fetch(`${API_BASE}/alerts/districts`);
    if (!res.ok) throw new Error("Failed to fetch alert districts");
    return res.json();
  },

  async subscribeToAlerts(email: string, district: string, consent: boolean): Promise<SubscriptionResult> {
    const res = await fetch(`${API_BASE}/alerts/subscribe`, {
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
    const res = await fetch(`${API_BASE}/alerts/unsubscribe`, {
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
    const res = await fetch(`${API_BASE}/sources/tinyfish/status`);
    if (!res.ok) throw new Error("Failed to fetch TinyFish status");
    return res.json();
  },

  async requestTinyFishRetrieval(payload: TinyFishRetrievalRequest): Promise<TinyFishRetrievalResult> {
    const res = await fetch(`${API_BASE}/sources/tinyfish/retrieve`, {
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
    const res = await fetch(`${API_BASE}/sources/tinyfish/history?limit=${limit}`);
    if (!res.ok) throw new Error("Failed to fetch TinyFish extraction history");
    return res.json();
  }
};
