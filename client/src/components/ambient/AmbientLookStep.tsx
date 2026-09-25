import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { ambientApi } from '../../lib/ambientApi';
import type { AmbientMovement, AmbientProject } from '../../lib/ambientTypes';
import type { StoryCaptionSettings } from '../../lib/storyTypes';
import { StoryCaptionsPanel } from '../story/StoryCaptionsPanel';
import { panelCls, primaryBtnCls } from '../story/formStyles';

export interface AmbientLookStepProps {
  project: AmbientProject;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  refresh: () => void;
}

/** One still per movement, generated library-first, plus the shared caption controls. */
export function AmbientLookStep({ project, busy, setBusy, refresh }: AmbientLookStepProps) {
  const generateImages = async () => {
    setBusy(true);
    try {
      await ambientApi.generateImages(project.projectId);
      refresh();
      toast.success('Generating images…');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to generate images');
    } finally {
      setBusy(false);
    }
  };

  const onCaptionsChange = async (patch: StoryCaptionSettings) => {
    try {
      await ambientApi.setCaptions(project.projectId, patch);
      refresh();
    } catch (e) {
      toast.error((e as Error).message || 'Failed to update captions');
    }
  };

  return (
    <div className="space-y-4">
      <div className={`${panelCls} flex flex-wrap items-center gap-2`}>
        <span className="text-help">{project.movements.length} movement{project.movements.length === 1 ? '' : 's'}</span>
        <button
          type="button"
          onClick={generateImages}
          disabled={busy || project.movements.length === 0}
          className={`${primaryBtnCls} ml-auto px-3 py-1.5`}
        >
          Generate images
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {project.movements.map((m, i) => <MovementThumb key={m.id} movement={m} index={i} />)}
      </div>

      <StoryCaptionsPanel value={project} onChange={onCaptionsChange} busy={busy} />
    </div>
  );
}

function MovementThumb({ movement, index }: { movement: AmbientMovement; index: number }) {
  return (
    <div className="space-y-1 overflow-hidden rounded-lg border border-white/10 bg-black/20">
      <div className="flex aspect-video items-center justify-center bg-black/30">
        {movement.imageUrl ? (
          <img src={movement.imageUrl} alt={`Movement ${index + 1}`} className="h-full w-full object-cover" />
        ) : movement.imageStatus === 'generating' ? (
          <Loader2 size={18} className="animate-spin text-content-tertiary" />
        ) : (
          <span className="text-[11px] text-content-tertiary">No image</span>
        )}
      </div>
      <div className="flex items-center justify-between px-1.5 pb-1 text-[10px]">
        <span className="text-content-tertiary">Movement {index + 1}</span>
        <span
          className={
            movement.imageStatus === 'done'
              ? 'text-emerald-300'
              : movement.imageStatus === 'error'
                ? 'text-red-300'
                : 'text-content-tertiary'
          }
          title={movement.imageError || undefined}
        >
          {movement.imageStatus}
        </span>
      </div>
    </div>
  );
}
