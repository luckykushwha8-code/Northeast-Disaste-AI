import { useEffect, useRef } from 'react';

/** Refresh mounted live views on a quiet cadence, pausing while the tab is hidden. */
export function useVisibleRefresh(refresh: () => void | Promise<void>, intervalMs: number) {
  const refreshRef = useRef(refresh);
  const runningRef = useRef(false);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible' || runningRef.current) return;
      runningRef.current = true;
      void Promise.resolve(refreshRef.current())
        .catch(() => {})
        .finally(() => { runningRef.current = false; });
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs]);
}
