import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { momentsApi } from '../lib/momentsApi';
import { canMake, isRunning, newSeed } from '../lib/momentsWizard';
import { toastError } from '../lib/errors';
import { isApiError } from '../lib/apiError';
import type { MomentMeta, MomentProject } from '../lib/momentsTypes';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { StartNewButton } from '../components/ui/StartNewButton';
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

const NO_WORDS_GUIDANCE = "Couldn't write words for you right now. Add a title or a statement on the Words step, then press Make it.";

/** Storage can be blocked (private windows, site settings): the active Moment is a convenience, never a requirement. */
const readActive = (): string | null => {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
};
const writeActive = (id: string | null) => {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* the Moment still opens; it just is not remembered */ }
};

export interface MomentStepProps {
  project: MomentProject;
  meta: MomentMeta;
  refresh: () => void;
  busy: boolean;
  /** Calls nest: every setBusy(true) is paired with a setBusy(false), and the page stays busy until all are released. */
  setBusy: (b: boolean) => void;
  /** Registers a save that does not hold busy (a blur-save), so Make it waits for it before rendering. */
  track: (save: Promise<unknown>) => void;
  /** Every successful PUT hands its response here, so the page's copy is current before the background refetch lands. */
  commit: (saved: MomentProject) => void;
}

export function MomentsPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(readActive);
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
  const commit = useCallback((saved: MomentProject) => {
    qc.setQueryData(['moment', saved.projectId], saved);
  }, [qc]);
  // A step seeds its editors from the page copy when it mounts, so a tab switch waits for any
  // blur-save still in flight; otherwise coming straight back would show (and later re-save) old text.
  const stepRequest = useRef(0);
  const goTo = useCallback(async (next: Step) => {
    const ticket = ++stepRequest.current;
    if (pending.current.size) await Promise.allSettled([...pending.current]);
    if (ticket === stepRequest.current) setStep(next);
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
        let s: Awaited<ReturnType<typeof momentsApi.suggest>>;
        try {
          s = await momentsApi.suggest(id);
        } catch (e) {
          // Nothing was written: send the user to write their own, and do not render.
          if (isApiError(e) && e.code) toastError(e);
          toast.error(NO_WORDS_GUIDANCE);
          setStep('words');
          return;
        }
        commit(await momentsApi.update(id, { title: s.title, statements: s.statements }));
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
    writeActive(id);
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
            <StartNewButton onClick={() => setActive(null)} />
          </div>
        </div>
      );
    }
    return <Loader2 className="animate-spin text-primary-400" />;
  }

  // Start new sits beside the title and the tabs get a row of their own: on a
  // phone the six tabs are wider than the screen, and sharing their row pushed
  // Start new off the right edge and made the whole page scroll sideways.
  const startNew = project && <StartNewButton disabled={busy} onClick={() => setActive(null)} />;

  const tabs = project && (
    <div className="max-w-full overflow-x-auto pb-1">
      <div className={`${segmentedCls} whitespace-nowrap`} role="group" aria-label="Moment step">
        {STEPS.map((s) => (
          <button key={s.id} type="button" aria-pressed={step === s.id} disabled={busy} onClick={() => { void goTo(s.id); }} className={`${segmentCls(step === s.id)} shrink-0`}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );

  // Tasks 3-7 replace each placeholder with its step, which receives these props.
  const stepProps: MomentStepProps | null = project
    ? { project, meta, refresh, busy: busy || isRunning(project), setBusy, track, commit }
    : null;
  const ready = project ? canMake(project, meta) : null;
  // The Result step has its own button for each finished render (Shuffle, or Make it again), so the sticky one steps aside.
  const renderStatus = project?.render?.status;
  const ownRetry = step === 'result' && (renderStatus === 'done' || renderStatus === 'error' || renderStatus === 'interrupted');
  return (
    <div className="w-full">
      <ScreenHeader
        className="flex-wrap lg:pr-14"
        eyebrow={project ? 'Create · Moments' : 'Create'}
        title={project ? (project.title || 'Your Moment') : <>Photos that <em>speak</em>.</>}
        subtitle={project ? undefined : 'Birthdays, sermons, events: your photos, cut to the beat, with words that land.'}
        right={startNew || undefined}
      />
      {tabs && <div className="mt-4">{tabs}</div>}
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
          {/* On phones the fixed tab bar (about 60 px plus the safe area) covers bottom-4, so Make it sits above it. */}
          {!ownRetry && (
            <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] mt-6 flex flex-col items-center gap-1 lg:bottom-4">
              <button type="button" onClick={() => makeIt()} disabled={!ready?.ok || stepProps.busy} className={`${primaryBtnCls} px-8 py-3`}>
                <Wand2 size={18} /> Make it
              </button>
              {ready && !ready.ok && <span className="text-help rounded-full bg-bf-bg/90 px-3 py-1 backdrop-blur">{ready.reason}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
