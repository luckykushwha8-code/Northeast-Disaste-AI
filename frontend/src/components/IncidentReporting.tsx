import React, { useState } from 'react';
import { IncidentReportItem, UserRole, Language } from '../types';
import { api } from '../api/client';
import { PlusCircle, ShieldCheck } from 'lucide-react';

interface IncidentReportingProps {
  reports: IncidentReportItem[];
  userRole: UserRole;
  lang: Language;
  onRefresh: () => void;
}

export const IncidentReporting: React.FC<IncidentReportingProps> = ({
  reports,
  userRole,
  lang: _lang,
  onRefresh
}) => {
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [reporterName, setReporterName] = useState('');
  const [category, setCategory] = useState('ROAD_BLOCKED');
  const [locationName, setLocationName] = useState('Kharghuli Hillside Road');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.submitReport({
        reporter_name: reporterName || "Local Resident",
        category,
        location_name: locationName,
        latitude: 26.18,
        longitude: 91.75,
        description
      });
      setIsSubmitModalOpen(false);
      setDescription('');
      setReporterName('');
      setMessage("Report submitted successfully. Awaiting responder verification.");
      onRefresh();
      setTimeout(() => setMessage(null), 4000);
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (reportId: string, status: 'VERIFIED' | 'REJECTED') => {
    try {
      await api.verifyReport(reportId, status, `usr_${userRole.toLowerCase()}`, userRole);
      setMessage(`Report marked as ${status}.`);
      onRefresh();
      setTimeout(() => setMessage(null), 4000);
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
  };

  const isResponderOrAdmin = ['RESPONDER', 'OPERATOR', 'ADMIN'].includes(userRole);

  return (
    <div className="space-y-4">
      {/* Notice on Rule R-12 */}
      <div className="bg-slate-100 rounded-xl p-3 border border-slate-200 text-xs text-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-blue-600 flex-shrink-0" />
          <span>Rule R-12 & FR-USER-06: Community incident reports remain unverified until checked by authorized responders.</span>
        </div>
        <button
          onClick={() => setIsSubmitModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>Submit Report</span>
        </button>
      </div>

      {message && (
        <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold rounded-lg">
          {message}
        </div>
      )}

      {/* Reports List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {reports.length === 0 ? (
          <div className="col-span-2 bg-white rounded-xl p-8 text-center text-slate-500 text-xs border border-slate-200">
            No incident reports recorded yet.
          </div>
        ) : (
          reports.map((rep) => {
            const isVerified = rep.verification_status === 'VERIFIED';
            const isRejected = rep.verification_status === 'REJECTED';

            return (
              <div key={rep.id} className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-800">
                      {rep.category.replace('_', ' ')}
                    </span>
                    <h4 className="text-xs font-bold text-slate-900 mt-1">{rep.location_name}</h4>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    isVerified ? 'bg-emerald-100 text-emerald-800' :
                    isRejected ? 'bg-red-100 text-red-800' :
                    'bg-amber-100 text-amber-800'
                  }`}>
                    {rep.verification_status}
                  </span>
                </div>

                <p className="text-xs text-slate-600">{rep.description}</p>

                <div className="pt-2 border-t border-slate-100 flex justify-between items-center text-[11px] text-slate-500">
                  <span>By: {rep.reporter_name}</span>
                  <span>{new Date(rep.report_time).toLocaleTimeString()}</span>
                </div>

                {isResponderOrAdmin && rep.verification_status === 'UNVERIFIED' && (
                  <div className="pt-2 border-t border-slate-100 flex justify-end gap-2">
                    <button
                      onClick={() => handleVerify(rep.id, 'REJECTED')}
                      className="px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-50 rounded border border-red-200"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleVerify(rep.id, 'VERIFIED')}
                      className="px-3 py-1 text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 rounded shadow-sm"
                    >
                      Verify Incident
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Submit Modal */}
      {isSubmitModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Report Flood Waterlogging or Slope Damage</h3>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Your Name / Ward Resident:</label>
              <input
                type="text"
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                placeholder="e.g. Ramesh Kalita"
                className="w-full text-xs p-2 rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Hazard Category:</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-xs p-2 rounded-lg border border-slate-300"
              >
                <option value="WATERLOGGING">Severe Waterlogging</option>
                <option value="RIVER_BREACH">Embankment / River Breach</option>
                <option value="SLOPE_CRACK">Slope Tension Crack / Ground Subsidence</option>
                <option value="ROAD_BLOCKED">Road Blocked by Debris / Tree</option>
                <option value="DEBRIS_FALL">Active Mudslide / Rockfall</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Exact Location / Landmark:</label>
              <input
                type="text"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                required
                className="w-full text-xs p-2 rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Description:</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={3}
                placeholder="Describe water depth, visible cracks, blocked vehicles, or urgent safety hazards."
                className="w-full text-xs p-2 rounded-lg border border-slate-300"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsSubmitModalOpen(false)}
                className="px-3 py-1.5 text-xs font-semibold bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Submit Report
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
