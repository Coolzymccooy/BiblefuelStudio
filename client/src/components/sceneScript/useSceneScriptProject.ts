import { useCallback, useEffect, useRef, useState } from 'react';
import { toastError } from '../../lib/errors';
import { sceneScriptApi } from '../../lib/sceneScriptApi';
import type { SceneScriptProject } from '../../lib/sceneScriptTypes';

const POLL_MS = 3000;

export function inProgress(p: SceneScriptProject) {
  return p.running.voice || p.running.shots || p.running.render
    || ['queued', 'rendering', 'running'].includes(p.render.status)
    || p.shots.some((s) => s.clip?.status === 'queued' || s.clip?.status === 'generating');
}

/**
 * One scene script, kept fresh: polled while a step runs, and never
 * overwritten by a response older than the latest one applied.
 */
export function useSceneScriptProject(id: string) {
  const [project, setProject] = useState<SceneScriptProject | null>(null);
  const [month, setMonth] = useState<{ spentUsd: number; capUsd: number } | null>(null);
  const [seedance, setSeedance] = useState(true);
  const [failedPolls, setFailedPolls] = useState(0);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const r = await sceneScriptApi.get(id);
    if (mine !== seq.current) return;
    setProject(r.project);
    setMonth(r.month);
    setSeedance(r.seedance);
  }, [id]);

  /** Apply a project returned by an action; anything still in flight is now stale. */
  const apply = useCallback((next: SceneScriptProject) => {
    seq.current += 1;
    setProject(next);
  }, []);

  useEffect(() => { load().catch(toastError); }, [load]);
  useEffect(() => {
    if (!project || !inProgress(project)) return undefined;
    // A failed poll changes failedPolls, which schedules the next one.
    const t = setTimeout(() => { load().catch(() => setFailedPolls((n) => n + 1)); }, POLL_MS);
    return () => clearTimeout(t);
  }, [project, load, failedPolls]);

  return { project, month, seedance, load, apply };
}
