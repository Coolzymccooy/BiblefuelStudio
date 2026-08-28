import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Mic, Wand2, ArrowDownToLine, Loader2 } from 'lucide-react';
import { api, GENERATE_TIMEOUT_MS } from '../../lib/api';
import { loadJson, pushUnique, saveJson, STORAGE_KEYS } from '../../lib/storage';
import { cleanSpeakableText } from '../../lib/speakableScript';
import { useVoiceSynthesisDefaults } from '../../lib/voiceSynthesisDefaults';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';

/**
 * The Voice & Audio QUICK job, docked in the Timeline editor.
 *
 * Same providers and endpoints as the Voice & Audio page (ElevenLabs, Azure,
 * Fish, Chatterbox, Edge-TTS, or the Voice Synthesis category orchestrator
 * when its defaults are on), same shared libraries (BF_SCRIPTS in,
 * BF_AUDIO_HISTORY + BF_AUDIO_PATH out) - so a take made here is the Voice
 * page's Current audio and vice versa. The difference is where it LANDS:
 * straight onto this timeline's voice-over lane.
 */

type Provider = 'elevenlabs' | 'azure' | 'fish' | 'chatterbox' | 'edge';
type ProviderInfo = { available: boolean; reachable?: boolean; reason?: string };

const PROVIDERS: Array<{ id: Provider; label: string; note: string }> = [
  { id: 'elevenlabs', label: 'ElevenLabs', note: 'premium' },
  { id: 'azure', label: 'Azure', note: 'word-sync' },
  { id: 'fish', label: 'Fish', note: 'premium' },
  { id: 'chatterbox', label: 'Chatterbox', note: 'self-hosted' },
  { id: 'edge', label: 'Edge-TTS', note: 'free' },
];

interface Script { title?: string; hook?: string; verse?: string; reflection?: string; cta?: string }
interface AudioItem { id: string; path: string; kind: string; label?: string; createdAt: string }

export interface VoiceTake { path: string; label: string; durationSec?: number }

export interface VoiceQuickPanelProps {
  /** Adds the take as a clip on the voice-over lane. */
  onLandVoiceover: (take: VoiceTake) => void;
  onUseAsSource: (path: string) => void;
  /** Landing needs a documentary timeline to have a lane to land on. */
  hasProject: boolean;
}

function latestScriptText(): string {
  const scripts = loadJson<Script[]>(STORAGE_KEYS.scripts, []);
  const s = scripts[0];
  if (!s) return '';
  return [s.hook, s.verse, s.reflection, s.cta].filter(Boolean).join('\n\n');
}

/** Read the take's duration from the browser so the VO clip is cut to size. */
function probeDurationSec(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      const a = new Audio();
      // No media engine (jsdom, some webviews): canPlayType is '' and the
      // metadata event never fires. Skip rather than hang; the clip falls
      // back to a default length and the operator can trim it.
      if (!a.canPlayType || !a.canPlayType('audio/mpeg')) { resolve(undefined); return; }
      let settled = false;
      const done = (v?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        a.onloadedmetadata = null; a.onerror = null;
        resolve(v);
      };
      const timer = setTimeout(() => done(undefined), 4000);
      a.onloadedmetadata = () => done(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : undefined);
      a.onerror = () => done(undefined);
      a.src = url;
    } catch {
      resolve(undefined);
    }
  });
}

export function VoiceQuickPanel({ onLandVoiceover, onUseAsSource, hasProject }: VoiceQuickPanelProps) {
  const [text, setText] = useState<string>(() => latestScriptText());
  const [provider, setProvider] = useState<Provider>('elevenlabs');
  const [availability, setAvailability] = useState<Record<string, ProviderInfo>>({});
  const [voiceId, setVoiceId] = useState('');
  const [stability, setStability] = useState(0.5);
  const [similarity, setSimilarity] = useState(0.75);
  const [busy, setBusy] = useState(false);
  const [lastTake, setLastTake] = useState<VoiceTake | null>(null);
  const [history, setHistory] = useState<AudioItem[]>(() => loadJson<AudioItem[]>(STORAGE_KEYS.audioHistory, []));
  const [voiceDefaults] = useVoiceSynthesisDefaults();

  useEffect(() => {
    let cancelled = false;
    api.get<{ ok: boolean; providers: Record<string, ProviderInfo> }>('/api/tts/providers?probe=1')
      .then((res) => { if (!cancelled && res.ok && res.data?.providers) setAvailability(res.data.providers); })
      .catch(() => { /* availability is advisory */ });
    return () => { cancelled = true; };
  }, []);

  const isUp = (id: Provider) => {
    const p = availability[id];
    if (!p) return id === 'elevenlabs' || id === 'edge';
    if (id === 'chatterbox') return Boolean(p.available && p.reachable !== false);
    return Boolean(p.available);
  };

  const remember = (take: VoiceTake) => {
    const item: AudioItem = { id: take.path, path: take.path, kind: 'tts', label: take.label, createdAt: new Date().toISOString() };
    const next = pushUnique(STORAGE_KEYS.audioHistory, item, (i) => i.id, 30);
    setHistory(next);
    saveJson(STORAGE_KEYS.audioPath, take.path);
  };

  const handleGenerate = async () => {
    const clean = cleanSpeakableText(text);
    if (!clean.trim()) { toast.error('Enter some text first'); return; }
    if (clean !== text) setText(clean);
    setBusy(true);
    try {
      let url: string;
      let payload: Record<string, unknown>;
      if (voiceDefaults.enabled) {
        url = '/api/tts/synthesize-category';
        payload = {
          text: clean,
          category: voiceDefaults.category,
          preferredProvider: voiceDefaults.providerOverride || undefined,
          withTimestamps: true,
          overrides: { forcedAlignmentFallback: voiceDefaults.cinematicMode },
        };
      } else if (provider === 'edge') {
        url = '/api/tts/edge'; payload = { text: clean, voiceId: voiceId || undefined };
      } else if (provider === 'chatterbox') {
        url = '/api/tts/chatterbox'; payload = { text: clean, voiceId: voiceId || undefined };
      } else if (provider === 'azure') {
        url = '/api/tts/azure'; payload = { text: clean, voiceId: voiceId || undefined, withTimestamps: true };
      } else if (provider === 'fish') {
        url = '/api/tts/fish'; payload = { text: clean, voiceId: voiceId || undefined };
      } else {
        url = '/api/tts/elevenlabs';
        payload = { text: clean, voiceId: voiceId || undefined, voiceSettings: { stability, similarity_boost: similarity } };
      }
      const response = await api.post(url, payload, undefined, { timeout: GENERATE_TIMEOUT_MS });
      if (!response.ok || !response.data?.file) {
        toast.error(response.error || response.data?.error || 'Voice generation failed');
        return;
      }
      const path: string = response.data.file;
      const label = `${PROVIDERS.find((p) => p.id === provider)?.label || 'Voice'} · ${clean.slice(0, 40)}`;
      const durationSec = await probeDurationSec(api.mediaUrl(path));
      const take = { path, label, durationSec };
      remember(take);
      setLastTake(take);
      toast.success('Take ready — listen below, then land it on the VO lane');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What should the voice say?"
        aria-label="Voice script"
        className="h-28 bg-black/20 text-[12px]"
      />
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setText(latestScriptText() || text)} className="inline-flex h-7 items-center gap-1 rounded-md border border-editor-line px-2 text-[10px] text-editor-dim hover:text-editor-text">
          <Wand2 size={10} /> Use Latest Script
        </button>
        <button type="button" onClick={() => setText(cleanSpeakableText(text))} className="inline-flex h-7 items-center rounded-md border border-editor-line px-2 text-[10px] text-editor-dim hover:text-editor-text">
          Format for Voice
        </button>
      </div>

      <div>
        <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[.1em] text-editor-faint">Provider</p>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Voice provider">
          {PROVIDERS.map((p) => {
            const up = isUp(p.id);
            const active = provider === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setProvider(p.id)}
                disabled={!up}
                aria-pressed={active}
                title={up ? `${p.label} · ${p.note}` : (availability[p.id]?.reason || `${p.label} is not configured`)}
                className={`rounded-md border px-2 py-1 text-[10px] transition ${
                  active ? 'border-editor-accent/50 bg-editor-hover font-semibold text-editor-accent'
                    : 'border-editor-line text-editor-dim hover:text-editor-text'
                } disabled:opacity-40`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {provider !== 'edge' && (
        <Input value={voiceId} onChange={(e) => setVoiceId(e.target.value)} placeholder="Voice ID · optional, server default if blank" aria-label="Voice ID" className="bg-black/20 font-mono text-[11px]" />
      )}
      {provider === 'elevenlabs' && !voiceDefaults.enabled && (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[10px] text-editor-dim">
            Stability <span className="font-mono text-editor-text">{stability.toFixed(2)}</span>
            <input type="range" min={0} max={1} step={0.05} value={stability} onChange={(e) => setStability(Number(e.target.value))} aria-label="Stability" className="mt-1 w-full accent-editor-accent" />
          </label>
          <label className="text-[10px] text-editor-dim">
            Similarity <span className="font-mono text-editor-text">{similarity.toFixed(2)}</span>
            <input type="range" min={0} max={1} step={0.05} value={similarity} onChange={(e) => setSimilarity(Number(e.target.value))} aria-label="Similarity boost" className="mt-1 w-full accent-editor-accent" />
          </label>
        </div>
      )}

      <Button onClick={handleGenerate} isLoading={busy} className="h-9 w-full text-xs">
        <Mic size={13} className="mr-1.5" />
        {voiceDefaults.enabled ? `Generate · ${voiceDefaults.category}` : 'Generate voice'}
      </Button>
      {busy && provider === 'chatterbox' && (
        <p className="flex items-center gap-1.5 text-[10px] text-editor-faint"><Loader2 size={10} className="animate-spin" /> Chatterbox takes 10–90s on a self-hosted box.</p>
      )}

      {lastTake && (
        <div className="space-y-2 rounded-xl border border-editor-line bg-white/[0.02] p-3">
          <p className="break-words text-[11px] font-semibold text-editor-text">{lastTake.label}</p>
          <audio controls src={api.mediaUrl(lastTake.path)} className="w-full" aria-label="Play the take" />
          <Button
            onClick={() => onLandVoiceover(lastTake)}
            disabled={!hasProject}
            className="h-9 w-full text-xs"
            title={hasProject ? 'Add this take as a clip on the voice-over lane' : 'Create a documentary timeline first (Scenes tool)'}
          >
            <ArrowDownToLine size={13} className="mr-1.5" />
            Land on VO lane
          </Button>
          <button type="button" onClick={() => onUseAsSource(lastTake.path)} className="w-full text-center text-[10px] text-editor-dim underline-offset-2 hover:underline">
            or use as source media
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] font-bold uppercase tracking-[.1em] text-editor-faint">Recent takes · shared with Voice &amp; Audio</p>
          {history.slice(0, 4).map((item) => (
            <div key={item.id} className="flex items-center gap-2 rounded-lg border border-editor-line px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-editor-dim" title={item.path}>{item.label || item.kind}</span>
              <button
                type="button"
                onClick={() => onLandVoiceover({ path: item.path, label: item.label || item.kind })}
                disabled={!hasProject}
                className="shrink-0 rounded-md border border-editor-line px-1.5 py-0.5 text-[9.5px] font-semibold text-editor-accent hover:bg-editor-hover disabled:opacity-40"
              >
                Land
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
