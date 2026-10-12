import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { momentsApi } from '../lib/momentsApi';
import { isRunning } from '../lib/momentsWizard';
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
import { segmentCls, segmentedCls } from '../components/story/formStyles';

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
const RESULT_STATUSES = new Set(['running', 'interrupted', 'error']);

const isNotFound = (e: unknown) => isApiError(e) && e.status === 404;

export interface MomentStepProps {
  project: MomentProject;
  meta: MomentMeta;
  refresh: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}

function StepPlaceholder({ name }: { name: string }) {
  return <p className="text-help">{name}</p>;
}

export function MomentsPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [step, setStep] = useState<Step>('photos');
  const [busy, setBusy] = useState(false);
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

  const refresh = () => { if (projectId) qc.invalidateQueries({ queryKey: ['moment', projectId] }); };

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
    ? { project, meta, refresh, busy: busy || isRunning(project), setBusy }
    : null;
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
          {step === 'words' && <MomentsWordsStep key={stepProps.project.projectId} {...stepProps} />}
          {step === 'style' && <StepPlaceholder name="Style" />}
          {step === 'result' && <StepPlaceholder name="Result" />}
        </div>
      )}
    </div>
  );
}
