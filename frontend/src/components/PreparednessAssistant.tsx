import { useEffect, useState } from 'react';
import { Bot, Loader2, Send } from 'lucide-react';
import { api } from '../api/client';

type AssistantResult = {
  summary: string;
  supporting_observations: string[];
  uncertainties: string[];
  preparedness_actions: string[];
  evidence_sufficient: boolean;
  disclaimer?: string;
  generated_at?: string | null;
  model?: string | null;
};

type AIStatus = {
  available: boolean;
  provider: string;
  status?: string;
  connectivity_verified?: boolean;
  model?: string | null;
};

export function PreparednessAssistant() {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);

  useEffect(() => {
    let active = true;
    api.getAIStatus().then(value => { if (active) setAiStatus(value); }).catch(() => {
      if (active) setAiStatus(null);
    });
    return () => { active = false; };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true); setError(''); setResult(null);
    try { setResult(await api.askPreparednessAssistant(question.trim())); }
    catch (e) { setError(e instanceof Error ? e.message : 'Assistant is unavailable.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" aria-labelledby="preparedness-title">
      <h2 id="preparedness-title" className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-800">
        <Bot className="h-4 w-4 text-teal-700" /> Preparedness assistant
      </h2>
      {aiStatus && <p className="mb-2 text-[10px] text-slate-500" aria-live="polite">
        {aiStatus.provider}: {aiStatus.connectivity_verified ? 'verified' : aiStatus.available ? 'configured, not verified' : aiStatus.status ?? 'unavailable'}
        {aiStatus.model ? ` · ${aiStatus.model}` : ''}
      </p>}
      <form onSubmit={submit} className="flex gap-2">
        <label className="sr-only" htmlFor="preparedness-question">Ask about preparedness</label>
        <input id="preparedness-question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={600}
          placeholder="Ask about flood or landslide safety" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-600" />
        <button disabled={busy || !question.trim()} className="rounded-lg bg-teal-700 px-2.5 text-white disabled:opacity-50" aria-label="Ask assistant">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      {result && <div className="mt-3 space-y-2 border-t border-slate-100 pt-2 text-xs text-slate-700">
        <p className="font-medium">AI-generated guidance{result.model ? ` · ${result.model}` : ''}</p><p>{result.summary}</p>
        {result.preparedness_actions.length > 0 && <ul className="list-disc space-y-1 pl-4">{result.preparedness_actions.map((item, i) => <li key={i}>{item}</li>)}</ul>}
        {!result.evidence_sufficient && <p className="text-amber-800">Evidence is limited. Check official updates.</p>}
        <p className="text-[10px] text-slate-500">{result.generated_at ? `Generated ${new Date(result.generated_at).toLocaleString()}. ` : ''}{result.disclaimer ?? 'Follow current official instructions. For immediate danger in India, call 112. This assistant does not dispatch rescue.'}</p>
      </div>}
    </section>
  );
}
