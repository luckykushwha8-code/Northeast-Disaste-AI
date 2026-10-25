import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export const OfflineBanner: React.FC = () => {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      className="w-full bg-amber-600 text-white py-2 px-4 flex items-center justify-center gap-2 text-sm font-semibold"
      role="alert"
    >
      <WifiOff className="w-4 h-4 flex-shrink-0" />
      You are offline. Data shown may be outdated. Changes will retry when reconnected.
    </div>
  );
};
