import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  consequenceText: string;
  auditNote?: string;
  requireComment?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (comment?: string) => void;
  onCancel: () => void;
  loading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  consequenceText,
  auditNote,
  requireComment = false,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  loading = false,
}) => {
  const [comment, setComment] = useState('');
  const [clicked, setClicked] = useState(false);

  if (!open) return null;

  const canConfirm = !requireComment || comment.trim().length >= 3;

  function handleConfirm() {
    if (!canConfirm || loading) return;
    if (!clicked) {
      // Double-click protection: first click shows a warning, second confirms
      setClicked(true);
      return;
    }
    onConfirm(comment || undefined);
    setComment('');
    setClicked(false);
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
      />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">{title}</h2>
              {auditNote && (
                <p className="text-xs text-slate-500 mt-0.5">{auditNote}</p>
              )}
            </div>
          </div>
          <button onClick={onCancel} className="p-1 text-slate-400 hover:text-slate-700 rounded-md">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Consequence text */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          {consequenceText}
        </div>

        {/* Optional comment */}
        {requireComment && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Reason / comment <span className="text-red-500">*</span>
            </label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={2}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
              placeholder="Required for audit trail…"
            />
          </div>
        )}

        {/* Double-click warning */}
        {clicked && (
          <p className="text-xs text-red-700 font-semibold bg-red-50 border border-red-200 rounded-lg p-2">
            ⚠ Click <strong>{confirmLabel}</strong> once more to confirm.
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || loading}
            className="px-4 py-2 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loading ? 'Processing…' : clicked ? `Confirm (click to proceed)` : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
