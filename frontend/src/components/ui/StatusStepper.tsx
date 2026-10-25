import React from 'react';
import { Check } from 'lucide-react';
import type { RescueStatus } from '../../types';

interface StatusStepperProps {
  currentStatus: RescueStatus;
  className?: string;
}

const STEPS: { status: RescueStatus; label: string; honest: string }[] = [
  { status: 'SUBMITTED', label: 'Submitted', honest: 'Request logged' },
  { status: 'RECEIVED', label: 'Received', honest: 'Acknowledged by system' },
  { status: 'ASSIGNED', label: 'Assigned', honest: 'Responder assigned' },
  { status: 'EN_ROUTE', label: 'En Route', honest: 'Help is on the way' },
  { status: 'SERVED', label: 'Served', honest: 'Assistance provided' },
  { status: 'CLOSED', label: 'Closed', honest: 'Request closed' },
];

const STATUS_ORDER: Record<RescueStatus, number> = {
  SUBMITTED: 0,
  RECEIVED: 1,
  ASSIGNED: 2,
  EN_ROUTE: 3,
  SERVED: 4,
  CLOSED: 5,
  UNREACHABLE: -1,
};

export const StatusStepper: React.FC<StatusStepperProps> = ({ currentStatus, className = '' }) => {
  const currentIdx = STATUS_ORDER[currentStatus] ?? 0;

  if (currentStatus === 'UNREACHABLE') {
    return (
      <div className={`flex items-center gap-2 text-sm text-red-700 font-semibold ${className}`}>
        <span className="w-5 h-5 rounded-full bg-red-100 border-2 border-red-500 flex items-center justify-center text-xs">!</span>
        Unreachable — please call 112 immediately
      </div>
    );
  }

  return (
    <div className={`w-full overflow-x-auto ${className}`}>
      <div className="flex items-start gap-0 min-w-max">
        {STEPS.map((step, idx) => {
          const isDone = idx < currentIdx;
          const isCurrent = idx === currentIdx;

          return (
            <div key={step.status} className="flex items-start">
              <div className="flex flex-col items-center">
                <div
                  className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${
                    isDone
                      ? 'bg-teal-600 border-teal-600 text-white'
                      : isCurrent
                      ? 'bg-white border-teal-600 text-teal-700'
                      : 'bg-white border-slate-200 text-slate-400'
                  }`}
                >
                  {isDone ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                </div>
                <span
                  className={`text-[10px] mt-1 text-center max-w-16 leading-tight ${
                    isCurrent ? 'text-teal-700 font-bold' : isDone ? 'text-slate-600' : 'text-slate-400'
                  }`}
                >
                  {step.honest}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={`w-8 h-0.5 mt-3.5 mx-1 transition-colors ${
                    idx < currentIdx ? 'bg-teal-500' : 'bg-slate-200'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
