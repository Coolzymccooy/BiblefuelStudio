import { useEffect, useMemo, useState } from 'react';
import { GitCompare, Loader2, Plus, Trash2, Star, Copy, Check } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { api, GENERATE_TIMEOUT_MS } from '../../lib/api';
import { STORAGE_KEYS, loadJson, saveJson, toOutputUrl } from '../../lib/storage';

type TTSProvider = 'elevenlabs' | 'azure' | 'fish' | 'edge' | 'chatterbox';
const PROVIDERS: TTSProvider[] = ['elevenlabs', 'azure', 'fish', 'edge', 'chatterbox'];

interface Candidate {
  uiId: string;        // local UI key only — server assigns its own id
  provider: TTSProvider;
  voiceId?: string;
  label?: string;
}

interface CompareResult {
  id: string;
  provider: TTSProvider;
  voiceId?: string;
  label?: string;
  status: 'ok' | 'error';
  file?: string;
  voice?: string;
  latencyMs: number;
  error?: string;
}

interface RatingEntry { stars: number; notes: string }
type RatingMap = Record<string, RatingEntry>;

const MAX_CANDIDATES = 4;
const MIN_CANDIDATES = 2;

// FNV-1a 32-bit hash → 8-char hex. Stable across sessions, no deps.
function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function ratingKey(text: string, provider: string, voiceId?: string): string {
  return `${hash32(text.trim())}:${provider}:${voiceId || 'default'}`;
}

function nextUiId(): string {
  return `c-${Math.random().toString(36).slice(2, 9)}`;
}

const DEFAULT_CANDIDATES: Candidate[] = [
  { uiId: nextUiId(), provider: 'azure', label: 'Azure' },
  { uiId: nextUiId(), provider: 'edge', label: 'Edge' },
];

/**
 * Voice Lab side-by-side compare panel. Synthesises the same text across
 * 2–4 providers in parallel via POST /api/tts/compare and renders each
 * result as a card with audio playback, latency, a 1-5 star rating, and
 * a notes textarea. Ratings persist per (text, provider, voiceId) tuple.
 */
export function CompareVoices({ className = '' }: { className?: string }) {
  const [text, setText] = useState<string>(() =>
    loadJson<string>(STORAGE_KEYS.compareText, '') ||
    loadJson<string>(STORAGE_KEYS.ttsText, 'For God so loved the world.'),
  );
  const [candidates, setCandidates] = useState<Candidate[]>(DEFAULT_CANDIDATES);
  const [results, setResults] = useState<CompareResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ratings, setRatings] = useState<RatingMap>(() => loadJson<RatingMap>(STORAGE_KEYS.compareRatings, {}));
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    saveJson(STORAGE_KEYS.compareText, text);
  }, [text]);

  const canRun = useMemo(
    () =>
      !loading &&
      text.trim().length > 0 &&
      candidates.length >= MIN_CANDIDATES &&
      candidates.every((c) => !!c.provider),
    [loading, text, candidates],
  );

  const addCandidate = () => {
    if (candidates.length >= MAX_CANDIDATES) return;
    setCandidates((cs) => [...cs, { uiId: nextUiId(), provider: 'edge' }]);
  };

  const removeCandidate = (uiId: string) => {
    setCandidates((cs) => (cs.length <= MIN_CANDIDATES ? cs : cs.filter((c) => c.uiId !== uiId)));
  };

  const updateCandidate = (uiId: string, patch: Partial<Candidate>) => {
    setCandidates((cs) => cs.map((c) => (c.uiId === uiId ? { ...c, ...patch } : c)));
  };

  const runCompare = async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    const body = {
      text: text.trim(),
      candidates: candidates.map((c) => ({
        provider: c.provider,
        voiceId: c.voiceId?.trim() || undefined,
        label: c.label?.trim() || undefined,
      })),
    };
    const res = await api.post<{ ok: boolean; results: CompareResult[] }>('/api/tts/compare', body, undefined, { timeout: GENERATE_TIMEOUT_MS });
    if (res.ok && res.data?.results) {
      setResults(res.data.results);
    } else {
      setError(res.error || 'Compare failed');
    }
    setLoading(false);
  };

  const rateResult = (result: CompareResult, stars: number) => {
    const key = ratingKey(text, result.provider, result.voiceId);
    const prev = ratings[key] || { stars: 0, notes: '' };
    const next: RatingMap = { ...ratings, [key]: { ...prev, stars } };
    setRatings(next);
    saveJson(STORAGE_KEYS.compareRatings, next);
  };

  const setNotes = (result: CompareResult, notes: string) => {
    const key = ratingKey(text, result.provider, result.voiceId);
    const prev = ratings[key] || { stars: 0, notes: '' };
    const next: RatingMap = { ...ratings, [key]: { ...prev, notes } };
    setRatings(next);
    saveJson(STORAGE_KEYS.compareRatings, next);
  };

  const getRating = (result: CompareResult): RatingEntry =>
    ratings[ratingKey(text, result.provider, result.voiceId)] || { stars: 0, notes: '' };

  const copyVoice = async (result: CompareResult) => {
    const payload = result.voiceId || result.voice || '';
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedId(result.id);
      setTimeout(() => setCopiedId((c) => (c === result.id ? null : c)), 1500);
    } catch {
      /* clipboard blocked; silently ignore */
    }
  };

  return (
    <Card
      title="Compare voices (Voice Lab A/B)"
      icon={GitCompare}
      className={className}
      collapsible
      defaultOpen={false}
      tooltip="Synthesise the same line across 2–4 voice candidates in parallel, listen back, and pick the keeper. Your ratings persist so the best-rated voice surfaces first next time."
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-300 mb-1">Text to synthesize</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#7fb5aa]/40"
            placeholder="Type the line you want all candidates to speak…"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Candidates ({candidates.length}/{MAX_CANDIDATES})</span>
            <button
              type="button"
              onClick={addCandidate}
              disabled={candidates.length >= MAX_CANDIDATES}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={12} /> Add candidate
            </button>
          </div>
          {candidates.map((c) => (
            <div key={c.uiId} className="grid grid-cols-12 gap-2 items-center">
              <select
                value={c.provider}
                onChange={(e) => updateCandidate(c.uiId, { provider: e.target.value as TTSProvider })}
                className="col-span-3 rounded bg-black/30 border border-white/10 px-2 py-1.5 text-gray-100 text-xs"
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <input
                type="text"
                value={c.voiceId || ''}
                onChange={(e) => updateCandidate(c.uiId, { voiceId: e.target.value })}
                placeholder="voice id (optional)"
                className="col-span-5 rounded bg-black/30 border border-white/10 px-2 py-1.5 text-gray-100 text-xs"
              />
              <input
                type="text"
                value={c.label || ''}
                onChange={(e) => updateCandidate(c.uiId, { label: e.target.value })}
                placeholder="label (optional)"
                className="col-span-3 rounded bg-black/30 border border-white/10 px-2 py-1.5 text-gray-100 text-xs"
              />
              <button
                type="button"
                onClick={() => removeCandidate(c.uiId)}
                disabled={candidates.length <= MIN_CANDIDATES}
                aria-label="Remove candidate"
                className="col-span-1 inline-flex items-center justify-center rounded p-1.5 bg-white/5 hover:bg-red-500/20 border border-white/10 text-gray-300 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={runCompare}
            disabled={!canRun}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 bg-[#e8f2f0]0/90 hover:bg-[#e8f2f0]0 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <GitCompare size={14} />}
            {loading ? 'Synthesising…' : 'Compare'}
          </button>
          {error && <span className="text-xs text-red-300">{error}</span>}
        </div>

        {results.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            {results.map((r) => {
              const rating = getRating(r);
              const ok = r.status === 'ok';
              return (
                <div
                  key={r.id}
                  className={`rounded-xl p-3 border ${ok ? 'border-white/10 bg-white/5' : 'border-red-500/30 bg-red-500/5'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant={ok ? 'success' : 'warning'}>{r.provider}</Badge>
                      <span className="text-sm font-medium text-gray-100 truncate">
                        {r.label || r.voice || r.voiceId || r.provider}
                      </span>
                    </div>
                    <span className="text-[10px] text-content-secondary shrink-0">{r.latencyMs} ms</span>
                  </div>

                  {ok ? (
                    <>
                      <audio
                        controls
                        src={toOutputUrl(r.file, api.mediaBaseUrl)}
                        className="w-full mt-2"
                      />
                      <div className="mt-2 flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => rateResult(r, n)}
                            aria-label={`Rate ${n} stars`}
                            className="p-0.5 text-content-tertiary hover:text-yellow-300"
                          >
                            <Star
                              size={16}
                              className={n <= rating.stars ? 'text-yellow-400 fill-yellow-400' : ''}
                            />
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => copyVoice(r)}
                          title="Copy voice id"
                          className="ml-auto inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-300"
                        >
                          {copiedId === r.id ? <Check size={11} /> : <Copy size={11} />}
                          {copiedId === r.id ? 'copied' : 'copy voice'}
                        </button>
                      </div>
                      <textarea
                        value={rating.notes}
                        onChange={(e) => setNotes(r, e.target.value)}
                        rows={2}
                        placeholder="notes (e.g. too robotic, perfect for narration…)"
                        className="w-full mt-2 rounded bg-black/30 border border-white/10 px-2 py-1.5 text-gray-100 text-xs focus:outline-none focus:ring-1 focus:ring-[#7fb5aa]/40"
                      />
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-red-300">{r.error || 'failed'}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
