/**
 * One cartoon, kept fresh: polled every 3 s while the server says something is
 * running (portraits, film or render), and never overwritten by a response
 * older than the latest one applied. Polling stops on unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cartoonApi } from '../../lib/cartoonApi';
import type { CartoonMonth, CartoonProject } from '../../lib/cartoonTypes';

const POLL_MS = 3000;

export function isRunning(p: CartoonProject): boolean {
  return Object.values(p.running ?? {}).some(Boolean);
}

export function useCartoonProject(id: string) {
  const [project, setProject] = useState<CartoonProject | null>(null);
  const [month, setMonth] = useState<CartoonMonth | null>(null);
  const [seedance, setSeedance] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failedPolls, setFailedPolls] = useState(0);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const r = await cartoonApi.get(id);
    if (mine !== seq.current) return;
    setProject(r.project);
    setMonth(r.month);
    setSeedance(r.seedance);
    setError(null);
  }, [id]);

  /** Apply a project returned by an action; anything still in flight is now stale. */
  const apply = useCallback((next: CartoonProject) => {
    seq.current += 1;
    setProject(next);
  }, []);

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the cartoon.'));
    // Replies landing after unmount (or after the id changes) are ignored.
    return () => { seq.current += 1; };
  }, [load]);

  useEffect(() => {
    if (!project || !isRunning(project)) return undefined;
    // A failed poll changes failedPolls, which schedules the next one.
    const t = setTimeout(() => { load().catch(() => setFailedPolls((n) => n + 1)); }, POLL_MS);
    return () => clearTimeout(t);
  }, [project, load, failedPolls]);

  return { project, month, seedance, error, load, apply };
}
