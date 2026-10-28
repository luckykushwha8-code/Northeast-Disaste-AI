import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, Send, Volume2, VolumeX } from 'lucide-react';
import { api } from '../api/client';
import type { Language } from '../types';

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

type SpeechRecognitionResult = { 0: { transcript: string } };
type SpeechRecognitionEvent = { results: ArrayLike<SpeechRecognitionResult> };
type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type AIStatus = {
  available: boolean;
  provider: string;
  status?: string;
  connectivity_verified?: boolean;
  model?: string | null;
};

const SPEECH_LANG: Record<Language, string> = { en: 'en-IN', as: 'as-IN', bn: 'bn-IN', hi: 'hi-IN' };

export function VoiceAssistant({ lang = 'en' }: { lang?: Language }) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState('');
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    let active = true;
    api.getAIStatus().then(value => { if (active) setAiStatus(value); }).catch(() => {
      if (active) setAiStatus(null);
    });
    return () => {
      active = false;
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setQuestion(text);
    setBusy(true); setError(''); setResult(null); setVoiceNotice('');
    try {
      const response = await api.askVoiceAssistant(text.trim());
      setResult(response);
      const spoken = [response.summary, ...(response.preparedness_actions ?? [])].join('. ');
      if ('speechSynthesis' in window && spoken) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(spoken);
        utterance.lang = SPEECH_LANG[lang];
        utterance.onstart = () => setSpeaking(true);
        utterance.onend = () => setSpeaking(false);
        utterance.onerror = () => setSpeaking(false);
        window.speechSynthesis.speak(utterance);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Assistant is unavailable.'); }
    finally { setBusy(false); }
  }

  function toggleMicrophone() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const speechWindow = window as Window & {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceNotice('Voice input is not supported in this browser. You can still type a question.');
      return;
    }
    const recognition = new Recognition();
    recognition.lang = SPEECH_LANG[lang];
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = event => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setQuestion(transcript);
        void ask(transcript);
      }
    };
    recognition.onerror = event => {
      setVoiceNotice(event.error === 'not-allowed' ? 'Allow microphone access to ask by voice.' : `Voice input stopped${event.error ? `: ${event.error}` : '.'}`);
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setVoiceNotice('Listening… Ask about Northeast weather, rain, news, safety, or request a short spoken briefing.');
    setListening(true);
    recognition.start();
  }

  function toggleSpeech() {
    if (!('speechSynthesis' in window)) {
      setVoiceNotice('Spoken replies are not supported in this browser.');
      return;
    }
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    if (!result) return;
    const spoken = [result.summary, ...result.preparedness_actions].join('. ');
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = SPEECH_LANG[lang];
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" aria-labelledby="preparedness-title">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="preparedness-title" className="flex items-center gap-2 text-xs font-bold text-slate-800">
          <Mic className="h-4 w-4 text-teal-700" /> Talk with GeoShield
        </h2>
        {aiStatus && <span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${aiStatus.connectivity_verified ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`} aria-live="polite">
          {aiStatus.connectivity_verified ? `${aiStatus.provider} online` : aiStatus.available ? `${aiStatus.provider} configured` : 'AI service unavailable'}
        </span>}
      </div>
      <p className="mb-3 text-[10px] leading-relaxed text-slate-500">Tap the microphone and ask about Northeast rain, weather, news, safety, or request a short spoken briefing.</p>
      <button type="button" onClick={toggleMicrophone} disabled={busy}
        className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition disabled:opacity-60 ${listening ? 'bg-rose-600 hover:bg-rose-700' : 'bg-teal-700 hover:bg-teal-800'}`}
        aria-label={listening ? 'Stop listening' : 'Tap to talk to GeoShield'}>
        {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Preparing reply…</> : listening ? 'Listening · tap to stop' : 'Tap to talk'}
      </button>
      {question && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><span className="font-semibold">You said:</span> {question}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] font-semibold text-slate-500">Type a question instead</summary>
        <form onSubmit={event => { event.preventDefault(); void ask(question); }} className="mt-2 flex gap-2">
          <label className="sr-only" htmlFor="preparedness-question">Ask GeoShield by text</label>
          <input id="preparedness-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={600}
            placeholder="For example: rain outlook for Assam?" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-600" />
          <button type="submit" disabled={busy || !question.trim()} className="rounded-lg bg-teal-700 px-2.5 text-white disabled:opacity-50" aria-label="Send question">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </details>
      {(voiceNotice || listening) && <p className="mt-2 text-[10px] text-slate-500" aria-live="polite">{voiceNotice}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      {result && <div className="mt-3 space-y-2 border-t border-slate-100 pt-2 text-xs text-slate-700">
        <div className="flex items-center justify-between gap-2"><p className="font-medium">AI response{result.model ? ` · ${result.model}` : ''}</p><button type="button" onClick={toggleSpeech} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50" aria-label={speaking ? 'Stop spoken reply' : 'Play spoken reply'}>{speaking ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}{speaking ? 'Stop' : 'Listen'}</button></div>
        <p>{result.summary}</p>
        {result.supporting_observations.length > 0 && <div><p className="font-semibold text-slate-600">Evidence</p><ul className="list-disc space-y-1 pl-4">{result.supporting_observations.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
        {result.preparedness_actions.length > 0 && <ul className="list-disc space-y-1 pl-4">{result.preparedness_actions.map((item, i) => <li key={i}>{item}</li>)}</ul>}
        {result.uncertainties.length > 0 && <p className="text-amber-800">Data limits: {result.uncertainties.join(' ')}</p>}
        {!result.evidence_sufficient && <p className="text-amber-800">Current feed evidence is limited. Check official updates.</p>}
        <p className="text-[10px] text-slate-500">{result.generated_at ? `Generated ${new Date(result.generated_at).toLocaleString()}. ` : ''}{result.disclaimer ?? 'For immediate danger in India, call 112. This assistant does not dispatch rescue.'}</p>
      </div>}
    </section>
  );
}
