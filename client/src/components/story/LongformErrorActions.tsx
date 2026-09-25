import { useState } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import { longformApi } from '../../lib/longformApi';
import type { StoryProject } from '../../lib/storyTypes';
import { primaryBtnCls, secondaryBtnCls } from './formStyles';

interface LongformErrorActionsProps {
  project: StoryProject;
  /** Called after either action succeeds so the page can refetch the project. */
  onChanged: () => void;
  /** Disables both buttons while the page is busy elsewhere. */
  busy?: boolean;
}

/**
 * Whether a project's error happened during long-form narration: it has an
 * outline but never got as far as a transcript. Only then do "Retry
 * narration" and "Back to outline" make sense — a render failure after
 * narration has other recovery paths.
 */
export function isFailedLongformNarration(project: StoryProject | null | undefined): boolean {
  if (!project || project.status !== 'error') return false;
  const sections = project.longform?.sections?.length ?? 0;
  const words = project.transcript?.words?.length ?? 0;
  return sections > 0 && words === 0;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}

export function LongformErrorActions({ project, onChanged, busy = false }: LongformErrorActionsProps) {
  const [pending, setPending] = useState<'retry' | 'reopen' | null>(null);
  const disabled = busy || pending !== null;

  const retry = async () => {
    setPending('retry');
    try {
      await longformApi.narrate(project.projectId);
      toast.success('Narrating again — cached chunks are reused');
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  const reopen = async () => {
    setPending('reopen');
    try {
      await longformApi.reopen(project.projectId);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={retry}
        disabled={disabled}
        title="Re-run narration. Chunks already synthesised are reused."
        className={`${primaryBtnCls} px-3 py-1.5`}
      >
        <RefreshCw size={13} /> Retry narration
      </button>
      <button
        type="button"
        onClick={reopen}
        disabled={disabled}
        title="Go back to the outline to edit sections or pick another voice."
        className={`${secondaryBtnCls} px-3 py-1.5`}
      >
        Back to outline
      </button>
    </>
  );
}
