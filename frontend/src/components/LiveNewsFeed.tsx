import React, { useEffect, useState } from 'react';
import { LiveNewsFeedItem } from '../types';
import { api } from '../api/client';
import { Newspaper, RefreshCw, AlertTriangle, ExternalLink } from 'lucide-react';

export const LiveNewsFeed: React.FC = () => {
  const [feed, setFeed] = useState<LiveNewsFeedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFeed = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLiveNews();
      setFeed(data);
    } catch (e: any) {
      setError(e.message || 'Live news unavailable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeed();
  }, []);

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Newspaper className="w-5 h-5 text-orange-600" />
          <h3 className="text-sm font-bold text-slate-900">Live Northeast Disaster & Regional News</h3>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
            {feed?.data_mode || '...'}
          </span>
        </div>
        <button
          onClick={loadFeed}
          disabled={loading}
          className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <p className="text-xs text-slate-500 mb-4">
        Real-time headlines extracted live from verified Northeast regional outlets
        (EastMojo, The Sentinel Assam). Headlines marked in amber are flood / landslide /
        monsoon-related.
      </p>

      {error && (
        <div className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="text-xs text-slate-400 py-4 text-center">Fetching live headlines...</div>
      )}

      {feed && !loading && (
        <>
          {feed.disaster_related_count > 0 && (
            <div className="flex items-center gap-2 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {feed.disaster_related_count} hazard-related headline(s) detected in current regional coverage
            </div>
          )}

          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {feed.articles.slice(0, 25).map((a, i) => (
              <a
                key={i}
                href={a.article_link}
                target="_blank"
                rel="noreferrer"
                className={`flex items-start gap-2 p-2.5 rounded-lg border transition text-xs ${
                  a.disaster_related
                    ? 'border-amber-200 bg-amber-50/60 hover:bg-amber-50'
                    : 'border-slate-100 bg-slate-50/50 hover:bg-slate-100'
                }`}
              >
                <span className={`flex-shrink-0 mt-0.5 text-[9px] font-black px-1.5 py-0.5 rounded ${
                  a.disaster_related ? 'bg-amber-200 text-amber-900' : 'bg-slate-200 text-slate-600'
                }`}>
                  {a.source_domain.split('.')[0].toUpperCase()}
                </span>
                <span className={`flex-1 font-semibold leading-snug ${a.disaster_related ? 'text-amber-900' : 'text-slate-700'}`}>
                  {a.title}
                </span>
                <ExternalLink className="w-3 h-3 flex-shrink-0 text-slate-400 mt-1" />
              </a>
            ))}
          </div>

          <p className="text-[10px] text-slate-400 mt-3 border-t border-slate-100 pt-2">
            Attribution: {feed.attribution} — retrieved {new Date(feed.retrieved_at).toLocaleTimeString()} |
            {feed.total_articles} headlines total
          </p>
        </>
      )}
    </div>
  );
};
