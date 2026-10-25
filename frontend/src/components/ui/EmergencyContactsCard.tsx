import React from 'react';
import { Phone, Shield } from 'lucide-react';

const CONTACTS = [
  { label: 'Emergency', number: '112', sublabel: 'National Emergency', color: 'bg-red-600' },
  { label: 'MHA Disaster Control Room', number: '011-1070', sublabel: 'National Emergency Response Center', color: 'bg-blue-700' },
  { label: 'NDRF', number: '011-24363260', sublabel: 'National Disaster Response Force', color: 'bg-orange-600' },
  { label: 'Assam ASDMA', number: '0361-2237221', sublabel: 'Assam State Disaster Management Authority', color: 'bg-teal-700' },
];

interface EmergencyContactsCardProps {
  className?: string;
}

export const EmergencyContactsCard: React.FC<EmergencyContactsCardProps> = ({ className = '' }) => (
  <div className={`bg-white border border-slate-200 rounded-xl p-4 shadow-sm ${className}`}>
    <div className="flex items-center gap-2 mb-3">
      <Shield className="w-4 h-4 text-red-600" />
      <h3 className="text-sm font-bold text-slate-900">Emergency Contacts</h3>
    </div>
    <div className="space-y-2">
      {CONTACTS.map(contact => (
        <a
          key={contact.number}
          href={`tel:${contact.number.replace(/[^0-9+]/g, '')}`}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl text-white font-bold ${contact.color} hover:opacity-90 active:opacity-80 transition min-h-[3.5rem]`}
          aria-label={`Call ${contact.label}: ${contact.number}`}
        >
          <Phone className="w-5 h-5 flex-shrink-0" />
          <div>
            <div className="text-base font-black">{contact.number}</div>
            <div className="text-xs font-normal opacity-90">{contact.sublabel}</div>
          </div>
        </a>
      ))}
    </div>
    <div className="mt-3 space-y-1 text-center">
      <p className="text-[10px] text-slate-500">NDRF number is headquarters; use 112 for immediate emergency response.</p>
      <a className="block text-[11px] font-semibold text-teal-700 hover:underline" href="https://ndmindia.mha.gov.in/ndmi/contact-us" target="_blank" rel="noreferrer">Official national disaster contacts ↗</a>
      <a className="block text-[11px] font-semibold text-teal-700 hover:underline" href="https://onlineasdma.assam.gov.in/ngo/public/contact" target="_blank" rel="noreferrer">Assam district control room directory ↗</a>
    </div>
  </div>
);
