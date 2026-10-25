import React, { createContext, useCallback, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, Info, X, XCircle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (t: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
}

const ICON_MAP: Record<ToastType, React.ElementType> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLOR_MAP: Record<ToastType, string> = {
  success: 'border-l-4 border-green-500 bg-green-50 text-green-900',
  error: 'border-l-4 border-red-500 bg-red-50 text-red-900',
  warning: 'border-l-4 border-amber-500 bg-amber-50 text-amber-900',
  info: 'border-l-4 border-blue-500 bg-blue-50 text-blue-900',
};

const ICON_COLOR_MAP: Record<ToastType, string> = {
  success: 'text-green-500',
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    const toast: Toast = { id, ...t };
    setToasts(prev => [...prev, toast]);
    const duration = t.duration ?? 5000;
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      {createPortal(
        <div
          className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none"
          aria-live="polite"
        >
          {toasts.map(toast => {
            const Icon = ICON_MAP[toast.type];
            return (
              <div
                key={toast.id}
                className={`pointer-events-auto flex items-start gap-3 p-3 rounded-xl shadow-lg border ${COLOR_MAP[toast.type]} animate-in slide-in-from-right-4`}
              >
                <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${ICON_COLOR_MAP[toast.type]}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold">{toast.title}</p>
                  {toast.message && <p className="text-xs mt-0.5 opacity-80">{toast.message}</p>}
                </div>
                <button
                  onClick={() => removeToast(toast.id)}
                  className="p-0.5 rounded opacity-60 hover:opacity-100"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
};
