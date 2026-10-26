import React, { useState } from 'react';
import { AlertItem, PredictionItem, UserRole, Language } from '../types';
import { api } from '../api/client';
import { translations } from '../locales/translations';
import { AlertCircle, CheckCircle, Send, BellRing, UserCheck, ShieldAlert, PlusCircle, Check, X, Gauge } from 'lucide-react';

interface AlertQueueProps {
  alerts: AlertItem[];
  predictions: PredictionItem[];
  userRole: UserRole;
  lang: Language;
  onRefresh: () => void;
}

export const AlertQueue: React.FC<AlertQueueProps> = ({
  alerts,
  predictions,
  userRole,
  lang,
  onRefresh
}) => {
  const t = translations[lang] || translations.en;
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('ALL');
  const [actionModalAlert, setActionModalAlert] = useState<AlertItem | null>(null);
  const [actionReason, setActionReason] = useState<string>('');
  const [isNewProposalModalOpen, setIsNewProposalModalOpen] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // New Proposal form state
  const [newLocationId, setNewLocationId] = useState<string>('loc_pandu_ghat');
  const [newHazardType, setNewHazardType] = useState<string>('FLOOD');
  const [newSeverity, setNewSeverity] = useState<string>('HIGH');
  const [newTitle, setNewTitle] = useState<string>('');
  const [newDescription, setNewDescription] = useState<string>('');
  const [newInstructions, setNewInstructions] = useState<string>('');

  const handleApprove = async (alertId: string) => {
    try {
      setErrorMessage(null);
      await api.approveAlert(alertId, actionReason || 'Operator verified against hydrometeorological radar');
      setSuccessMessage("Alert approved & test notification dispatched!");
      setActionModalAlert(null);
      setActionReason('');
      onRefresh();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  const handleAcknowledge = async (alertId: string) => {
    try {
      setErrorMessage(null);
      await api.acknowledgeAlert(alertId);
      setSuccessMessage("Alert acknowledged by response team!");
      onRefresh();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  const handleResolve = async (alertId: string) => {
    try {
      setErrorMessage(null);
      await api.resolveAlert(alertId);
      setSuccessMessage("Alert successfully resolved.");
      onRefresh();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  const handleCreateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setErrorMessage(null);
      await api.createAlert({
        location_id: newLocationId,
        hazard_type: newHazardType,
        severity: newSeverity,
        title: newTitle || `ELEVATED ${newHazardType} ADVISORY`,
        description: newDescription || `Elevated environmental risk detected for ${newLocationId}.`,
        action_instructions: newInstructions || `Check official bulletins and avoid lowlands/slopes.`,
        simulation_flag: true
      });
      setIsNewProposalModalOpen(false);
      setSuccessMessage("New alert proposal created into review queue!");
      onRefresh();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  const filteredAlerts = alerts.filter(a => {
    if (selectedStatusFilter === 'ALL') return true;
    return a.lifecycle_status === selectedStatusFilter;
  });

  return (
    <div className="space-y-4">
      {/* Messages */}
      {errorMessage && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)}><X className="w-4 h-4" /></button>
        </div>
      )}
      {successMessage && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Header & Controls */}
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <BellRing className="w-5 h-5 text-blue-600" />
            <span>Alert & Early Warning Queue</span>
          </h2>
          <p className="text-xs text-slate-500">
            PRD 6-State Lifecycle: PROPOSED → REVIEWED → APPROVED → ISSUED → ACKNOWLEDGED → RESOLVED
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Status Filter */}
          <select
            value={selectedStatusFilter}
            onChange={(e) => setSelectedStatusFilter(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 font-semibold text-slate-700 focus:outline-none"
          >
            <option value="ALL">All States ({alerts.length})</option>
            <option value="PROPOSED">PROPOSED</option>
            <option value="ISSUED">ISSUED</option>
            <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
            <option value="RESOLVED">RESOLVED</option>
          </select>

          {/* Create Manual Proposal Button */}
          <button
            onClick={() => setIsNewProposalModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition shadow-sm"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Propose Alert</span>
          </button>
        </div>
      </div>

      {/* Alerts Grid */}
      <div className="grid grid-cols-1 gap-3">
        {filteredAlerts.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center border border-slate-200 text-slate-500 text-xs font-medium">
            No alerts currently in '{selectedStatusFilter}' state.
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            const isProposed = alert.lifecycle_status === 'PROPOSED';
            const isIssued = alert.lifecycle_status === 'ISSUED';
            const isAcknowledged = alert.lifecycle_status === 'ACKNOWLEDGED';
            const isResolved = alert.lifecycle_status === 'RESOLVED';

            return (
              <div
                key={alert.id}
                className={`bg-white rounded-xl p-4 border transition-all shadow-sm ${
                  isProposed ? 'border-amber-300 bg-amber-50/20' :
                  isIssued ? 'border-red-400 bg-red-50/20' :
                  isAcknowledged ? 'border-blue-300 bg-blue-50/20' :
                  'border-slate-200'
                }`}
              >
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black tracking-wide uppercase ${
                      alert.severity === 'CRITICAL' ? 'bg-red-600 text-white' :
                      alert.severity === 'HIGH' ? 'bg-orange-500 text-white' :
                      'bg-amber-400 text-slate-900'
                    }`}>
                      {alert.severity}
                    </span>

                    <span className="text-xs font-bold text-slate-800 uppercase px-2 py-0.5 bg-slate-100 rounded-md">
                      {alert.hazard_type}
                    </span>

                    <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-md border ${
                      isProposed ? 'bg-amber-100 text-amber-900 border-amber-300' :
                      isIssued ? 'bg-red-100 text-red-900 border-red-300 animate-pulse' :
                      isAcknowledged ? 'bg-blue-100 text-blue-900 border-blue-300' :
                      isResolved ? 'bg-emerald-100 text-emerald-900 border-emerald-300' :
                      'bg-slate-100 text-slate-800 border-slate-300'
                    }`}>
                      STATUS: {alert.lifecycle_status}
                    </span>

                    {alert.simulation_flag && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200">
                        SIMULATION DATA
                      </span>
                    )}

                    {(() => {
                      const supporting = predictions.find(
                        p => p.location_id === alert.location_id && p.hazard_type === alert.hazard_type
                      );
                      if (!supporting) return null;
                      return (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-100 text-sky-900 border border-sky-200 flex items-center gap-1">
                          <Gauge className="w-3 h-3" />
                          MODEL: {supporting.probability != null ? `${(supporting.probability * 100).toFixed(0)}% probability` : 'n/a'}
                          {` • ${supporting.data_quality_status}`}
                        </span>
                      );
                    })()}
                  </div>

                  <span className="text-[11px] text-slate-500 font-medium">
                    {alert.issued_at ? `Issued: ${new Date(alert.issued_at).toLocaleTimeString()}` : 'Awaiting Operator Approval'}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-slate-900 mt-1">{alert.title}</h3>
                <p className="text-xs text-slate-600 mt-1">{alert.description}</p>

                <div className="mt-2.5 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                  <span className="font-bold text-slate-800">Direct Actions: </span>
                  <span className="text-slate-700">{alert.action_instructions}</span>
                </div>

                {/* Notification Deliveries Section (FR-ALERT-08) */}
                {alert.deliveries && alert.deliveries.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-slate-200">
                    <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5 text-blue-600" />
                      <span>Notification Delivery Audit Receipts:</span>
                    </div>
                    <div className="space-y-1">
                      {alert.deliveries.map((del) => (
                        <div key={del.id} className="flex justify-between items-center text-xs p-1.5 bg-white rounded border border-slate-200">
                          <span className="font-medium text-slate-700">{del.channel} → {del.recipient_reference}</span>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              del.provider_status === 'ACCEPTED_BY_PROVIDER' ? 'bg-blue-100 text-blue-800'
                                : del.provider_status === 'SIMULATED' ? 'bg-purple-100 text-purple-800'
                                : del.provider_status === 'QUEUED' ? 'bg-amber-100 text-amber-800'
                                : del.provider_status === 'BLOCKED_DISABLED' ? 'bg-slate-100 text-slate-700'
                                  : 'bg-red-100 text-red-800'
                            }`}>
                              {del.provider_status}
                            </span>
                            <span className="text-[10px] text-slate-400">ID: {del.provider_message_id}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Operator Actions Bar */}
                <div className="mt-3 pt-2 border-t border-slate-200 flex flex-wrap justify-end gap-2">
                  {isProposed && (
                    <button
                      onClick={() => setActionModalAlert(alert)}
                      className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 transition flex items-center gap-1 shadow-sm"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{t.approveAndIssue}</span>
                    </button>
                  )}

                  {isIssued && (
                    <button
                      onClick={() => handleAcknowledge(alert.id)}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition flex items-center gap-1 shadow-sm"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>{t.acknowledgeAlert}</span>
                    </button>
                  )}

                  {(isIssued || isAcknowledged) && (
                    <button
                      onClick={() => handleResolve(alert.id)}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition flex items-center gap-1 shadow-sm"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>{t.resolveAlert}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Operator Review & Approval Modal */}
      {actionModalAlert && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 animate-fade-in">
            <h3 className="text-base font-bold text-slate-900 mb-2 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-600" />
              <span>Operator Authorization & Approval</span>
            </h3>
            <p className="text-xs text-slate-600 mb-4">
              Per Rule R-11 and FR-ADMIN-02: Approving will immediately transition status to <strong>ISSUED</strong>, trigger test-channel notifications, and log an audit record under role <strong>{userRole}</strong>.
            </p>

            <div className="mb-4 p-3 bg-slate-50 rounded-lg text-xs border border-slate-200">
              <div className="font-bold text-slate-800">{actionModalAlert.title}</div>
              <div className="text-slate-600 mt-1">{actionModalAlert.description}</div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-700 mb-1">Reason for Authorization (Audit Log):</label>
              <textarea
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder="e.g. Cross-checked with Pandu CWC gauge rising at +0.18 m/hr; local inundation verified."
                rows={3}
                className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setActionModalAlert(null)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={() => handleApprove(actionModalAlert.id)}
                className="px-4 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 shadow-sm"
              >
                Confirm Approval & Dispatch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Manual Proposal Modal */}
      {isNewProposalModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreateProposal} className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 animate-fade-in space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-blue-600" />
              <span>Create Proposed Warning Record</span>
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Location:</label>
                <select
                  value={newLocationId}
                  onChange={(e) => setNewLocationId(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300"
                >
                  <option value="loc_pandu_ghat">Pandu Ghat (Brahmaputra)</option>
                  <option value="loc_bharalu_basin">Bharalu River Basin</option>
                  <option value="loc_kharghuli_hills">Kharghuli Hill Slope</option>
                  <option value="loc_kamakhya_nilachal">Nilachal/Kamakhya Slope</option>
                  <option value="loc_narakasur_hills">Narakasur / GMCH Hills</option>
                  <option value="loc_boragaon_wetland">Deepor Beel / Boragaon</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Hazard Type:</label>
                <select
                  value={newHazardType}
                  onChange={(e) => setNewHazardType(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300"
                >
                  <option value="FLOOD">Flood</option>
                  <option value="LANDSLIDE">Landslide</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Severity:</label>
                <select
                  value={newSeverity}
                  onChange={(e) => setNewSeverity(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300"
                >
                  <option value="CRITICAL">CRITICAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MODERATE">MODERATE</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Alert Headline:</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. FLASH FLOOD IMMINENT — Water Overtopping Riverbank"
                required
                className="w-full text-xs p-2 rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Hazard Description:</label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Describe current environmental hazard, river surge, or slope deformation."
                required
                rows={2}
                className="w-full text-xs p-2 rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Action Instructions for Public:</label>
              <textarea
                value={newInstructions}
                onChange={(e) => setNewInstructions(e.target.value)}
                placeholder="e.g. Relocate to Sarusajai or Commerce College relief shelters immediately. Avoid hillside roads."
                required
                rows={2}
                className="w-full text-xs p-2 rounded-lg border border-slate-300"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsNewProposalModalOpen(false)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 shadow-sm"
              >
                Submit Proposal
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
