import { useState } from 'react';
import { momentsApi } from '../../lib/momentsApi';
import { DETAIL_LABELS } from '../../lib/momentsWizard';
import { toastError } from '../../lib/errors';
import type { DetailField } from '../../lib/momentsTypes';
import type { MomentStepProps } from '../../pages/MomentsPage';
import { fieldLabelCls, inputCls } from '../story/formStyles';

export function MomentsDetailsStep({ project, meta, refresh, busy, track }: MomentStepProps) {
  const occasion = meta.occasions.find((o) => o.id === project.occasion) ?? meta.occasions[0];
  // Local state is authoritative while mounted: a refetch must never overwrite what is being typed.
  // The page keys this step by projectId, so opening another Moment starts from its own details.
  const [details, setDetails] = useState(project.details);

  const save = (patch: Parameters<typeof momentsApi.update>[1]) => {
    const run = (async () => {
      try {
        await momentsApi.update(project.projectId, patch);
        refresh();
      } catch (e) {
        toastError(e);
      }
    })();
    // Not held busy (typing stays possible), but Make it waits for it.
    track(run);
    return run;
  };

  return (
    <div className="space-y-4">
      <label className={fieldLabelCls}>
        Occasion
        {/* Changing the occasion deliberately does not reset style, Energy or song: the occasion only sets
            those defaults when the Moment is created. Pick a new occasion on the start screen for a fresh start. */}
        <select value={project.occasion} disabled={busy} onChange={(e) => save({ occasion: e.target.value })} className={inputCls}>
          {meta.occasions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      {occasion.fields.map((field: DetailField) => (
        <label key={field} className={fieldLabelCls}>
          {DETAIL_LABELS[field].label}
          <input
            value={details[field] ?? ''}
            maxLength={meta.limits.detail}
            placeholder={DETAIL_LABELS[field].placeholder}
            disabled={busy}
            onChange={(e) => setDetails({ ...details, [field]: e.target.value })}
            onBlur={() => { if ((details[field] ?? '') !== (project.details[field] ?? '')) save({ details }); }}
            className={inputCls}
          />
        </label>
      ))}
      <p className="text-help">These help the AI write your statements. Nothing here is required.</p>
    </div>
  );
}
