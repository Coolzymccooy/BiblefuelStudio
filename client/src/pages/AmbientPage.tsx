import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { ambientApi, isAmbientTransient } from '../lib/ambientApi';
import type { AmbientAspect } from '../lib/ambientTypes';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { AmbientSoundStep } from '../components/ambient/AmbientSoundStep';
import { AmbientWordStep } from '../components/ambient/AmbientWordStep';
import { AmbientLookStep } from '../components/ambient/AmbientLookStep';
import { AmbientRenderStep } from '../components/ambient/AmbientRenderStep';
import { AmbientLengthField } from '../components/ambient/AmbientLengthField';
import {
  fieldLabelCls, inputCls, primaryBtnCls, segmentCls, segmentedCls, statusRowCls,
} from '../components/story/formStyles';

const ACTIVE_KEY = 'BF_AMBIENT_ACTIVE';
const POLL_MS = 2500;

type Step = 'sound' | 'word' | 'look' | 'render';
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'sound', label: 'Sound' },
  { id: 'word', label: 'Word' },
  { id: 'look', label: 'Look' },
  { id: 'render', label: 'Render' },
];

export function AmbientPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [step, setStep] = useState<Step>('sound');
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [theme, setTheme] = useState('');
  const [minutes, setMinutes] = useState('120');
  const [aspect, setAspect] = useState<AmbientAspect>('landscape');

  const { data: project } = useQuery({
    queryKey: ['ambient-project', projectId],
    queryFn: () => ambientApi.getProject(projectId as string),
    enabled: Boolean(projectId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isAmbientTransient(status) ? POLL_MS : false;
    },
  });

  const refresh = () => { if (projectId) qc.invalidateQueries({ queryKey: ['ambient-project', projectId] }); };

  const setActive = (id: string | null) => {
    setProjectId(id);
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
    setStep('sound');
  };

  const createProject = async () => {
    if (!title.trim() || !theme.trim()) { toast.error('Add a title and a theme'); return; }
    setBusy(true);
    try {
      const targetSec = Math.max(1, Math.round(Number(minutes) * 60));
      const created = await ambientApi.createProject(title.trim(), theme.trim(), targetSec, aspect);
      setActive(created.projectId);
      qc.invalidateQueries({ queryKey: ['ambient-project', created.projectId] });
    } catch (e) {
      toast.error((e as Error).message || 'Failed to create project');
    } finally {
      setBusy(false);
    }
  };

  const transient = project ? isAmbientTransient(project.status) : false;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <ScreenHeader
        eyebrow="Create"
        title={<>Scripture over an <em>ambient</em> bed.</>}
        subtitle={project ? `${project.theme} · ${project.title}` : undefined}
        right={project ? (
          <button onClick={() => setActive(null)} className="text-xs text-content-tertiary hover:text-bf-cream">Start new</button>
        ) : undefined}
      />
      <div className="h-5" />

      {!project && (
        <div className="space-y-4">
          <label className={fieldLabelCls}>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Rest in His presence" className={inputCls} />
          </label>
          <label className={fieldLabelCls}>
            Theme
            <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Peace in the storm" className={inputCls} />
          </label>
          <AmbientLengthField minutes={minutes} onChange={setMinutes} />
          <div>
            <div className={fieldLabelCls}>Aspect</div>
            <div className={segmentedCls} role="tablist" aria-label="Aspect">
              <button type="button" onClick={() => setAspect('landscape')} className={segmentCls(aspect === 'landscape')}>Landscape</button>
              <button type="button" onClick={() => setAspect('portrait')} className={segmentCls(aspect === 'portrait')}>Portrait</button>
            </div>
          </div>
          <button onClick={createProject} disabled={busy} className={`${primaryBtnCls} w-full justify-center px-4 py-3`}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : 'Create project'}
          </button>
        </div>
      )}

      {project && (
        <div className="mt-2 space-y-4">
          {transient && (
            <div className={`flex items-center gap-2 text-sm text-primary-100 ${statusRowCls}`}>
              <Loader2 className="animate-spin text-primary-400" size={16} />
              {project.status.replace(/_/g, ' ')}
            </div>
          )}

          <div className={segmentedCls} role="tablist" aria-label="Ambient step">
            {STEPS.map((s) => (
              <button key={s.id} type="button" onClick={() => setStep(s.id)} className={segmentCls(step === s.id)}>
                {s.label}
              </button>
            ))}
          </div>

          {step === 'sound' && <AmbientSoundStep project={project} busy={busy} setBusy={setBusy} refresh={refresh} />}
          {step === 'word' && <AmbientWordStep project={project} busy={busy} setBusy={setBusy} refresh={refresh} />}
          {step === 'look' && <AmbientLookStep project={project} busy={busy} setBusy={setBusy} refresh={refresh} />}
          {step === 'render' && <AmbientRenderStep project={project} busy={busy} setBusy={setBusy} refresh={refresh} />}
        </div>
      )}
    </div>
  );
}
