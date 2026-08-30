import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Sparkles, ListOrdered, Play } from 'lucide-react';
import { seriesApi, type SeriesPlan, type SeriesRecord } from '../../lib/bibleApi';
import { api } from '../../lib/api';
import { toastError } from '../../lib/errors';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

/**
 * The Series QUICK job, docked in the Timeline editor.
 *
 * Same seriesApi the Series page uses: preview the verse partition, then
 * Generate enqueues one auto-publish job per part (watch them in Queue). The
 * frame follows the PROJECT's Output frame - one setting, everywhere. Full
 * publish options (destination, title prefix, tone, niche, AI artwork) stay
 * on the Series page; generation here uses those sane defaults.
 */

const PART_OPTIONS = [3, 4, 5, 6, 7, 8];
/** Public-domain translations work without an API key; the full catalog
 *  (incl. keyed ones) lives on the Series page. */
const TRANSLATIONS = [
  { code: 'kjv', label: 'KJV — King James' },
  { code: 'web', label: 'WEB — World English' },
  { code: 'asv', label: 'ASV — American Standard' },
  { code: 'bbe', label: 'BBE — Basic English' },
  { code: 'ylt', label: 'YLT — Young’s Literal' },
];

export interface SeriesQuickPanelProps {
  /** Mapped from the project's Output frame so parts match the timeline. */
  defaultAspect: 'portrait' | 'square' | 'landscape';
  onViewJobs: () => void;
  /** Plays a finished part center-stage, right here in the editor. */
  onPreviewVideo: (outputPath: string) => void;
}

interface TrackedJob {
  id: string;
  partNumber: number;
  status: string;
  outFile?: string;
}

const TERMINAL = new Set(['done', 'failed', 'error']);
const POLL_MS = 4000;

export function SeriesQuickPanel({ defaultAspect, onViewJobs, onPreviewVideo }: SeriesQuickPanelProps) {
  const [reference, setReference] = useState('John 3');
  const [parts, setParts] = useState(5);
  const [translation, setTranslation] = useState('kjv');
  const [plan, setPlan] = useState<SeriesPlan | null>(null);
  const [history, setHistory] = useState<SeriesRecord[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  // Part jobs being watched LIVE, so a generated series shows up here - on
  // the fly - instead of sending the operator to the Jobs page to find out.
  const [trackedLabel, setTrackedLabel] = useState('');
  const [trackedJobs, setTrackedJobs] = useState<TrackedJob[]>([]);

  useEffect(() => {
    seriesApi.list(5).then(({ series }) => setHistory(series)).catch(() => setHistory([]));
  }, []);

  const track = (label: string, jobIds: string[]) => {
    setTrackedLabel(label);
    setTrackedJobs(jobIds.map((id, i) => ({ id, partNumber: i + 1, status: 'queued' })));
  };

  // Poll the jobs API while any tracked part is still working. First tick is
  // immediate so a just-finished part shows without waiting a full interval.
  useEffect(() => {
    if (trackedJobs.length === 0) return;
    if (trackedJobs.every((j) => TERMINAL.has(j.status))) return;
    let cancelled = false;
    const tick = async () => {
      const res = await api.get<{ jobs?: Array<{ id: string; status: string; result?: { outFile?: string; file?: string } }> }>('/api/jobs');
      if (cancelled || !res.ok || !res.data?.jobs) return;
      const byId = new Map(res.data.jobs.map((j) => [j.id, j]));
      setTrackedJobs((prev) => prev.map((t) => {
        const j = byId.get(t.id);
        return j ? { ...t, status: j.status, outFile: j.result?.outFile || j.result?.file } : t;
      }));
    };
    tick();
    const iv = window.setInterval(tick, POLL_MS);
    return () => { cancelled = true; window.clearInterval(iv); };
    // Re-arm when the set of tracked ids changes or all become terminal.
  }, [trackedJobs.length, trackedJobs.every((j) => TERMINAL.has(j.status))]);

  const handlePreview = async () => {
    if (!reference.trim()) {
      toast.error('Enter a chapter reference, e.g. "John 3"');
      return;
    }
    setIsPreviewLoading(true);
    try {
      const result = await seriesApi.preview({ reference: reference.trim(), parts, translation });
      setPlan(result.plan);
      toast.success(`Previewing ${result.plan.totalParts} segments`);
    } catch (err) {
      toastError(err);
      setPlan(null);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!plan) {
      toast.error('Preview the segments first');
      return;
    }
    setIsGenerating(true);
    try {
      const result = await seriesApi.generate({
        reference: reference.trim(),
        parts,
        translation,
        aspect: defaultAspect,
        durationSec: 22,
      });
      toast.success(`${result.jobIds.length} part job${result.jobIds.length === 1 ? '' : 's'} queued — watch them below`);
      setHistory((prev) => [result.series, ...prev].slice(0, 5));
      track(result.series.chapterReference, result.jobIds);
      setPlan(null);
    } catch (err) {
      toastError(err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-editor-dim">
        One chapter, a series — each part is one auto-publish job, framed to this project's Output frame ({defaultAspect}).
      </p>
      <label className="block text-[10px] font-semibold text-editor-dim">
        Chapter or verse range
        <Input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder='e.g. "John 3" or "Isaiah 60:5-8"'
          className="mt-1 bg-black/20"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 text-[10px] font-semibold text-editor-dim">
          Split into
          <Select value={String(parts)} onChange={(e) => setParts(Number(e.target.value))} className="mt-1">
            {PART_OPTIONS.map((n) => <option key={n} value={n}>{n} videos</option>)}
          </Select>
        </label>
        <label className="min-w-0 text-[10px] font-semibold text-editor-dim">
          Translation
          <Select value={translation} onChange={(e) => setTranslation(e.target.value)} className="mt-1">
            {TRANSLATIONS.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
          </Select>
        </label>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={handlePreview} isLoading={isPreviewLoading} className="h-9 flex-1 text-xs">
          Preview segments
        </Button>
        <Button onClick={handleGenerate} isLoading={isGenerating} disabled={!plan || isGenerating} className="h-9 flex-1 text-xs">
          <Sparkles size={13} className="mr-1.5" />
          Generate series
        </Button>
      </div>

      {plan && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-bold uppercase tracking-[.1em] text-editor-faint">
            Segments · {plan.chapterReference}, {plan.totalParts} parts
          </p>
          {plan.segments.map((seg) => (
            <details key={seg.partNumber} className="rounded-lg border border-editor-line bg-white/[0.02] px-2.5 py-1.5">
              <summary className="cursor-pointer select-none text-[11px] text-editor-dim [&::-webkit-details-marker]:hidden">
                <span className="font-bold text-editor-accent">Pt {seg.partNumber}</span>
                {' '}· <span className="break-words text-editor-text">{seg.reference}</span>
              </summary>
              {/* Full text, never clipped - expandable so the list stays scannable. */}
              {seg.hook && <p className="mt-1 break-words text-[10.5px] text-editor-text">{seg.hook}</p>}
              <p className="mt-1 break-words text-[10.5px] leading-relaxed text-editor-dim">{seg.caption}</p>
            </details>
          ))}
        </div>
      )}

      {trackedJobs.length > 0 && (
        <div className="space-y-1.5 border-t border-editor-line pt-2.5">
          <p className="text-[9px] font-bold uppercase tracking-[.1em] text-editor-faint">
            Parts · {trackedLabel}
          </p>
          {trackedJobs.map((j) => (
            <div key={j.id} className="flex items-center gap-2">
              <span className="w-9 shrink-0 text-[10px] font-bold text-editor-accent">Pt {j.partNumber}</span>
              <span className={`flex-1 text-[10px] font-semibold uppercase tracking-wide ${
                j.status === 'done' ? 'text-bf-success'
                  : TERMINAL.has(j.status) ? 'text-bf-danger'
                  : j.status === 'queued' ? 'text-editor-faint' : 'text-editor-accent'
              }`}>
                {j.status === 'done' ? 'Ready' : TERMINAL.has(j.status) ? 'Failed' : j.status === 'queued' ? 'Queued' : 'Rendering'}
              </span>
              {j.status === 'done' && j.outFile && (
                <button
                  type="button"
                  onClick={() => onPreviewVideo(j.outFile as string)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-editor-line px-2 py-1 text-[10px] font-semibold text-editor-accent hover:bg-editor-hover"
                >
                  <Play size={10} />
                  Preview on stage
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-1.5 border-t border-editor-line pt-2.5">
          <p className="text-[9px] font-bold uppercase tracking-[.1em] text-editor-faint">Recent series</p>
          {history.map((s) => (
            <div key={s.seriesId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 break-words text-[11px] text-editor-dim">
                <span className="font-semibold text-editor-text">{s.chapterReference}</span>
                {' '}· {s.totalParts} part{s.totalParts === 1 ? '' : 's'} · {s.translation.toUpperCase()} · {s.jobIds.length} job{s.jobIds.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => track(s.chapterReference, s.jobIds)}
                className="shrink-0 rounded-md border border-editor-line px-2 py-0.5 text-[10px] text-editor-dim hover:text-editor-accent"
              >
                Track parts
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={onViewJobs}
            className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-editor-accent hover:underline"
          >
            <ListOrdered size={12} />
            Watch the jobs in Queue
          </button>
        </div>
      )}
      <p className="text-[10px] leading-relaxed text-editor-faint">
        Destination, title prefix, tone, niche and AI artwork live under Publish &amp; render options on the Series page.
      </p>
    </div>
  );
}
