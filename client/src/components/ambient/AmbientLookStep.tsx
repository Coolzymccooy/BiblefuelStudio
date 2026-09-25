import { useState } from 'react';
import toast from 'react-hot-toast';
import { ambientApi, isAmbientTransient } from '../../lib/ambientApi';
import type { AmbientProject } from '../../lib/ambientTypes';
import { AmbientCaptionsPanel, type AmbientScripturePatch } from './AmbientCaptionsPanel';
import { panelCls, primaryBtnCls } from '../story/formStyles';
import { AmbientMovementTile } from './AmbientMovementTile';
import { AmbientLibraryPicker } from './AmbientLibraryPicker';

export interface AmbientLookStepProps {
  project: AmbientProject;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  refresh: () => void;
}

/**
 * One still per movement — generated, picked from your library, or your own
 * photo — plus how the scripture shows on screen.
 */
export function AmbientLookStep({ project, busy, setBusy, refresh }: AmbientLookStepProps) {
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  // While a stage rewrites the movement list, a change here would be lost
  // underneath it (the server answers 409); say so by disabling, not failing.
  const locked = busy || isAmbientTransient(project.status);
  const pickingIndex = project.movements.findIndex((m) => m.id === pickingFor);
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

  const onCaptionsChange = async (patch: AmbientScripturePatch) => {
    try {
      await ambientApi.setScriptureDisplay(project.projectId, patch);
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
          disabled={locked || project.movements.length === 0}
          className={`${primaryBtnCls} ml-auto px-3 py-1.5`}
        >
          Generate images
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {project.movements.map((m, i) => (
          <AmbientMovementTile
            key={m.id}
            projectId={project.projectId}
            movement={m}
            index={i}
            locked={locked}
            onChooseFromLibrary={() => setPickingFor(m.id)}
            refresh={refresh}
          />
        ))}
      </div>

      {pickingFor && pickingIndex >= 0 && (
        <AmbientLibraryPicker
          projectId={project.projectId}
          movementId={pickingFor}
          movementNumber={pickingIndex + 1}
          onClose={() => setPickingFor(null)}
          onChosen={() => { setPickingFor(null); refresh(); }}
        />
      )}

      <AmbientCaptionsPanel value={project} onChange={onCaptionsChange} busy={busy} />
    </div>
  );
}
