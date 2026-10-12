import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Wand2 } from 'lucide-react';
import { momentsApi } from '../lib/momentsApi';
import { canMake, isRunning, newSeed } from '../lib/momentsWizard';
import { toastError } from '../lib/errors';
import { isApiError } from '../lib/apiError';
import type { MomentMeta, MomentProject } from '../lib/momentsTypes';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { MomentsHistory, MOMENTS_LIST_KEY } from '../components/moments/MomentsHistory';
import { MomentsOccasionPicker } from '../components/moments/MomentsOccasionPicker';
import { MomentsDetailsStep } from '../components/moments/MomentsDetailsStep';
import { MomentsPhotosStep } from '../components/moments/MomentsPhotosStep';
import { MomentsSoundStep } from '../components/moments/MomentsSoundStep';
import { MomentsWordsStep } from '../components/moments/MomentsWordsStep';
import { MomentsStyleStep } from '../components/moments/MomentsStyleStep';
import { MomentsResult } from '../components/moments/MomentsResult';
import { primaryBtnCls, segmentCls, segmentedCls } from '../components/story/formStyles';

const ACTIVE_KEY = 'BF_MOMENTS_ACTIVE';
const POLL_MS = 2500;
export const MOMENTS_META_KEY = ['moments-meta'];

export type Step = 'details' | 'photos' | 'sound' | 'words' | 'style' | 'result';
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'details', label: 'Occasion' },
  { id: 'photos', label: 'Photos' },
  { id: 'sound', label: 'Sound' },
  { id: 'words', label: 'Words' },
  { id: 'style', label: 'Style' },
  { id: 'result', label: 'Result' },
];

/** A Moment in one of these render states opens on the Result step, where the outcome (or the retry) is. */
const RESULT_STATUSES = new Set(['running', 'done', 'interrupted', 'error']);

const isNotFound = (e: unknown) => isApiError(e) && e.status === 404;

export interface MomentStepProps {
  project: MomentProject;
  meta: MomentMeta;
  refresh: () => void;
  busy: boolean;
  /** Calls nest: every setBusy(true) is paired with a setBusy(false), and the page stays busy until all are released. */
  setBusy: (b: boolean) => void;
  /** Registers a save that does not hold busy (a blur-save), so Make it waits for it before rendering. */
  track: (save: Promise<unknown>) => void;
}

export function MomentsPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [step, setStep] = useState<Step>('photos');
  const [busy, setBusyState] = useState(false);
  // Counted in a ref so Make it can read it synchronously, and so overlapping long saves don't release each other.
  const busyCount = useRef(0);
  const setBusy = useCallback((b: boolean) => {
    busyCount.current = Math.max(0, busyCount.current + (b ? 1 : -1));
    setBusyState(busyCount.current > 0);
  }, []);
  const pending = useRef<Set<Promise<unknown>>>(new Set());
  const track = useCallback((save: Promise<unknown>) => {
    pending.current.add(save);
    const done = () => { pending.current.delete(save); };
    save.then(done, done);
  }, []);
  const making = useRef(false);
  /** Bumped when Make it writes the words itself, so a mounted Words step reloads them. */
  const [wordsKey, setWordsKey] = useState(0);
  /** The Moment already routed to its starting step, so a refetch never pulls the user back. */
  const routedFor = useRef<string | null>(null);

  const { data: meta, isError: metaFailed, refetch: refetchMeta } = useQuery({
    queryKey: MOMENTS_META_KEY,
    queryFn: () => momentsApi.meta(),
    staleTime: Infinity,
  });
  const { data: project, error: projectError, refetch: refetchProject } = useQuery({
    queryKey: ['moment', projectId],
    queryFn: () => momentsApi.get(projectId as string),
    enabled: Boolean(projectId),
    // A missing Moment will not come back; anything else gets one quick retry before the error state.
    retry: (count, e) => !isNotFound(e) && count < 1,
    retryDelay: 300,
    refetchInterval: (query) => (query.state.data && isRunning(query.state.data) ? POLL_MS : false),
  });

  const missing = isNotFound(projectError);
  useEffect(() => {
    if (missing) setActive(null);
    // setActive only touches state and the cache; it is recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);

  useEffect(() => {
    if (!project || routedFor.current === project.projectId) return;
    routedFor.current = project.projectId;
    if (project.render && RESULT_STATUSES.has(project.render.status)) setStep('result');
  }, [project]);

  /** Resolves once the refetch has landed. */
  const refreshNow = async () => { if (projectId) await qc.invalidateQueries({ queryKey: ['moment', projectId] }); };
  const refresh = () => { void refreshNow(); };

  const makeIt = async (seed?: number) => {
    // Refs, not state: two presses can land before React re-renders with busy set.
    if (!project || making.current || busyCount.current > 0) return;
    making.current = true;
    setBusy(true);
    const id = project.projectId;
    try {
      const wasEmpty = (p: MomentProject) => !p.title.trim() && p.statements.length === 0;
      let current = project;
      const waited = pending.current.size > 0;
      // Let blur-saves land first.
      if (waited) await Promise.allSettled([...pending.current]);
      // This render's copy can lag behind words that were just saved, and suggesting would overwrite them. So
      // after a pending save, or before suggesting at all, judge from what the server holds now.
      if (waited || wasEmpty(current)) {
        current = await qc.fetchQuery({ queryKey: ['moment', id], queryFn: () => momentsApi.get(id), staleTime: 0 });
      }
      if (wasEmpty(current)) {
        const s = await momentsApi.suggest(id);
        const saved = await momentsApi.update(id, { title: s.title, statements: s.statements });
        qc.setQueryData(['moment', id], saved);
        setWordsKey((k) => k + 1);
      }
      await momentsApi.render(id, seed);
      setStep('result');
      // Stay busy until the new state lands, so the old video and its Shuffle are never live beside a new render.
      await refreshNow();
    } catch (e) {
      toastError(e);
    } finally {
      making.current = false;
      setBusy(false);
    }
  };

  const cancelling = useRef(false);
  const cancel = async () => {
    if (!project || cancelling.current) return;
    cancelling.current = true;
    try {
      await momentsApi.cancel(project.projectId);
    } catch (e) {
      toastError(e);
    }
    try {
      await refreshNow();
    } finally {
      cancelling.current = false;
    }
  };

  const setActive = (id: string | null, startAt: Step = 'photos') => {
    routedFor.current = null;
    setProjectId(id);
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
    setStep(startAt);
    if (!id) qc.invalidateQueries({ queryKey: MOMENTS_LIST_KEY });
  };

  const create = async (occasion: string) => {
    setBusy(true);
    try {
      const created = await momentsApi.create(occasion);
      qc.setQueryData(['moment', created.projectId], created);
      setActive(created.projectId, 'photos');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  if (metaFailed) {
    return (
      <div className="space-y-3">
        <p className="text-help">Could not load Moments.</p>
        <button type="button" onClick={() => refetchMeta()} className="btn btn-secondary px-3 py-1.5 text-sm">Retry</button>
      </div>
    );
  }
  if (!meta) return <Loader2 className="animate-spin text-primary-400" />;

  if (projectId && !project) {
    if (projectError && !missing) {
      return (
        <div className="space-y-3">
          <p className="text-help">Couldn't open your last Moment.</p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => refetchProject()} className="btn btn-secondary px-3 py-1.5 text-sm">Retry</button>
            <button type="button" onClick={() => setActive(null)} className="text-xs text-content-tertiary hover:text-bf-cream">Start new</button>
          </div>
        </div>
      );
    }
    return <Loader2 className="animate-spin text-primary-400" />;
  }

  const tabs = project && (
    <div className="flex max-w-full items-center gap-3">
      <div className="min-w-0 overflow-x-auto">
        <div className={`${segmentedCls} whitespace-nowrap`} role="tablist" aria-label="Moment step">
          {STEPS.map((s) => (
            <button key={s.id} type="button" aria-pressed={step === s.id} disabled={busy} onClick={() => setStep(s.id)} className={`${segmentCls(step === s.id)} shrink-0`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <button type="button" disabled={busy} onClick={() => setActive(null)} className="shrink-0 text-xs text-content-tertiary hover:text-bf-cream disabled:opacity-50">Start new</button>
    </div>
  );

  // Tasks 3-7 replace each placeholder with its step, which receives these props.
  const stepProps: MomentStepProps | null = project
    ? { project, meta, refresh, busy: busy || isRunning(project), setBusy, track }
    : null;
  const ready = project ? canMake(project, meta) : null;
  // A failed or interrupted render has its own "Make it again" on the Result step, so the sticky button steps aside.
  const ownRetry = step === 'result' && (project?.render?.status === 'error' || project?.render?.status === 'interrupted');
  return (
    <div className="w-full">
      <ScreenHeader
        className="flex-wrap lg:pr-14"
        eyebrow={project ? 'Create · Moments' : 'Create'}
        title={project ? (project.title || 'Your Moment') : <>Photos that <em>speak</em>.</>}
        subtitle={project ? undefined : 'Birthdays, sermons, events: your photos, cut to the beat, with words that land.'}
        right={tabs || undefined}
      />
      <div className="h-5" />
      {!project && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <MomentsOccasionPicker meta={meta} onPick={create} busy={busy} />
          <MomentsHistory meta={meta} onOpen={(id, finished) => setActive(id, finished ? 'result' : 'photos')} />
        </div>
      )}
      {stepProps && (
        <div className="space-y-4">
          {step === 'details' && <MomentsDetailsStep key={stepProps.project.projectId} {...stepProps} />}
          {step === 'photos' && <MomentsPhotosStep {...stepProps} />}
          {step === 'sound' && <MomentsSoundStep {...stepProps} />}
          {step === 'words' && <MomentsWordsStep key={`${stepProps.project.projectId}:${wordsKey}`} {...stepProps} />}
          {step === 'style' && <MomentsStyleStep {...stepProps} />}
          {step === 'result' && (
            <MomentsResult project={stepProps.project} busy={stepProps.busy} onShuffle={() => makeIt(newSeed())} onRetry={() => makeIt()} onCancel={cancel} />
          )}
          {!ownRetry && (
            <div className="sticky bottom-4 mt-6 flex flex-col items-center gap-1">
              <button type="button" onClick={() => makeIt()} disabled={!ready?.ok || stepProps.busy} className={`${primaryBtnCls} px-8 py-3`}>
                <Wand2 size={18} /> Make it
              </button>
              {ready && !ready.ok && <span className="text-help">{ready.reason}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
