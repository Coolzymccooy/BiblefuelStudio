import { useCallback, useEffect, useRef, useState } from 'react';
import { visualLibraryApi } from '../../lib/sceneScriptApi';
import type { RerollJob } from '../../lib/sceneScriptTypes';

export const REROLL_POLL_MS = 5000;
export const isRerollInFlight = (j: RerollJob) => j.status === 'queued' || j.status === 'generating';

/**
 * Re-rolls for this library, polled while any is being made. onFinished runs
 * when one turns into a clip, so the library can show it. checkedAt is when
 * the list was last fetched, for showing how recent a failure is.
 */
export function useRerolls(onFinished: () => void) {
  const [jobs, setJobs] = useState<RerollJob[]>([]);
  const [checkedAt, setCheckedAt] = useState(0);
  const [tick, setTick] = useState(0);
  const seen = useRef(new Map<string, RerollJob['status']>());
  // Started here but not yet in a fetched list: a poll that began before the start must not drop them.
  const pending = useRef(new Map<string, RerollJob>());
  const finished = useRef(onFinished);
  useEffect(() => { finished.current = onFinished; }, [onFinished]);

  useEffect(() => {
    let current = true;
    visualLibraryApi.rerolls()
      .then(({ jobs: list }) => {
        if (!current) return;
        for (const j of list) pending.current.delete(j.id);
        const merged = [...pending.current.values(), ...list];
        const madeOne = list.some((j) => j.status === 'done' && seen.current.has(j.id) && seen.current.get(j.id) !== 'done');
        seen.current = new Map(merged.map((j) => [j.id, j.status]));
        setJobs(merged);
        setCheckedAt(Date.now());
        if (madeOne) finished.current();
      })
      .catch(() => { /* the next poll tries again */ });
    return () => { current = false; };
  }, [tick]);

  const running = jobs.some(isRerollInFlight);
  useEffect(() => {
    if (!running) return undefined;
    const t = setTimeout(() => setTick((n) => n + 1), REROLL_POLL_MS);
    return () => clearTimeout(t);
  }, [running, tick]);

  const started = useCallback((job: RerollJob) => {
    seen.current.set(job.id, job.status);
    pending.current.set(job.id, job);
    setJobs((list) => [job, ...list.filter((j) => j.id !== job.id)]);
  }, []);

  return { jobs, checkedAt, started };
}
