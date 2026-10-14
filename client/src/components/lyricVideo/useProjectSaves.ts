import { useCallback, useEffect, useRef } from 'react';
import type { LyricProject } from '../../lib/lyricVideoTypes';

/** One write to the project; resolves with the project as the server saved it. */
export type ProjectWrite = () => Promise<LyricProject>;
/** Runs a write after any still running, files its reply, and resolves with it (rejects when it failed). */
export type SaveProject = (write: ProjectWrite) => Promise<LyricProject>;

/**
 * The one writer for a step's changes. Each write starts only when the one before it has answered,
 * and each answer is filed on the project in that order, so the server never handles two writes to
 * the project at once and a later choice is never overwritten by an earlier reply. A failed write
 * rejects for its caller and the next one still runs.
 */
export function useProjectSaves(onChange: (p: LyricProject) => void): SaveProject {
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const fileReply = useRef(onChange);
  useEffect(() => {
    fileReply.current = onChange;
  }, [onChange]);

  return useCallback((write: ProjectWrite) => {
    const run = tail.current.then(async () => {
      const saved = await write();
      fileReply.current(saved);
      return saved;
    });
    tail.current = run.catch(() => undefined);
    return run;
  }, []);
}
