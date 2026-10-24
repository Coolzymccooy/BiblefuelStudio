import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import { useAuth } from '../hooks/useAuth';
import { toastError } from '../lib/errors';
import { isApiError } from '../lib/apiError';
import { sceneScriptApi, type ProjectEdit } from '../lib/sceneScriptApi';
import type { SceneScriptProject, SceneScriptSummary, VoiceOption } from '../lib/sceneScriptTypes';
import { inProgress, useSceneScriptProject } from '../components/sceneScript/useSceneScriptProject';
import { ScriptPaste } from '../components/sceneScript/ScriptPaste';
import { ScriptView } from '../components/sceneScript/ScriptView';
import { CastPanel } from '../components/sceneScript/CastPanel';
import { ShotsPanel } from '../components/sceneScript/ShotsPanel';
import { MusicPanel } from '../components/sceneScript/MusicPanel';
import { ProductionBar } from '../components/sceneScript/ProductionBar';
import { cartoonApi } from '../lib/cartoonApi';
import type { CartoonSummary } from '../lib/cartoonTypes';
import { ModeChoice, type SceneScriptMode } from '../components/cartoon/ModeChoice';
import { cartoonPath } from '../components/cartoon/steps';

interface ListRow { id: string; title: string; updatedAt: number; renderStatus: string; cartoon: boolean }

/** Both kinds in one list, newest first. Each list is optional: one failing never hides the other. */
function mergeProjects(human: SceneScriptSummary[], cartoons: CartoonSummary[]): ListRow[] {
  return [
    ...human.map((p) => ({ ...p, cartoon: false })),
    ...cartoons.map((p) => ({ id: p.id, title: p.title, updatedAt: p.updatedAt, renderStatus: p.renderStatus, cartoon: true })),
  ].sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
}

function ProjectList() {
  const [projects, setProjects] = useState<ListRow[] | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.allSettled([sceneScriptApi.list(), cartoonApi.list()]).then(([human, cartoons]) => {
      if (human.status === 'rejected') toastError(human.reason);
      if (cartoons.status === 'rejected') toastError(cartoons.reason);
      if (!live) return;
      setProjects(mergeProjects(
        human.status === 'fulfilled' ? human.value : [],
        cartoons.status === 'fulfilled' ? cartoons.value : [],
      ));
    });
    return () => { live = false; };
  }, []);
  if (!projects?.length) return null;
  return (
    <section aria-labelledby="scene-script-list-heading" className="space-y-3">
      <h2 id="scene-script-list-heading" className="text-sm font-semibold text-bf-cream">Your projects</h2>
      <ul className="space-y-2" aria-label="Your scene scripts">
        {projects.map((p) => (
          <li key={`${p.cartoon ? 'cartoon' : 'human'}-${p.id}`}>
            <Link to={p.cartoon ? cartoonPath(p.id) : `/app/scene-script/${p.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-editor-line bg-bf-card px-4 py-3 hover:border-editor-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bf-gold">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium text-bf-cream">{p.title}</span>
                {p.cartoon && <span className="shrink-0 rounded-full border border-editor-line px-2 py-0.5 text-xs text-bf-sub">Cartoon</span>}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-bf-muted">{p.renderStatus === 'done' ? 'Rendered' : new Date(p.updatedAt).toLocaleDateString('en-GB')}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProjectEditor({ id }: { id: string }) {
  const navigate = useNavigate();
  const { project, month, seedance, load, apply } = useSceneScriptProject(id);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [rooms, setRooms] = useState<string[]>(['hall']);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { sceneScriptApi.voices().then((v) => { setVoices(v.voices); setRooms(v.rooms); }).catch(() => {}); }, []);
  /** Runs a step; resolves false when it failed (the error is already shown). */
  const run = async (name: string, fn: () => Promise<SceneScriptProject | void>): Promise<boolean> => {
    setBusy(name);
    try {
      const next = await fn();
      if (next) apply(next);
      else await load();
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const editChecked = (edit: ProjectEdit) => run('edit', () => sceneScriptApi.update(id, edit));
  const onEdit = async (edit: ProjectEdit) => { await editChecked(edit); };
  const order = (confirmOverBenchmark: boolean, only?: string[]) => run('order', async () => {
    try {
      return await sceneScriptApi.orderShots(id, { only, confirmOverBenchmark });
    } catch (e) {
      if (isApiError(e) && e.code === 'OVER_BENCHMARK' && window.confirm(`${e.message}`)) {
        return sceneScriptApi.orderShots(id, { only, confirmOverBenchmark: true });
      }
      throw e;
    }
  });

  if (!project) return <p className="text-help">Loading…</p>;

  return (
    <div className="space-y-5">
      <div>
        <Link to="/app/scene-script" className="inline-flex items-center gap-1 text-sm text-bf-sub hover:text-bf-cream">
          <ArrowLeft size={14} aria-hidden="true" /> All scene scripts
        </Link>
        <ScreenHeader eyebrow="Scene script" title={project.meta.title || 'Untitled'} subtitle={project.meta.reference || undefined} className="mt-2" />
      </div>

      <ProductionBar
        project={project} month={month} seedance={seedance} busy={busy}
        onVoice={() => run('voice', () => sceneScriptApi.voice(id))}
        onSuggest={() => run('suggest', async () => { const p = await sceneScriptApi.suggestShots(id); toast.success('Shot prompts suggested. Review them below.'); return p; })}
        onOrder={(confirm) => order(confirm)}
        onCancelShots={() => run('cancel', () => sceneScriptApi.cancelShots(id))}
        onRender={() => run('render', () => sceneScriptApi.render(id))}
        onCancelRender={() => run('cancel', () => sceneScriptApi.cancelRender(id))}
      />

      <Section title="Script and voices" subtitle="Every spoken line, exactly as you wrote it." defaultOpen>
        <ScriptView project={project} voices={voices} onEdit={onEdit} />
      </Section>
      <Section title="Cast" subtitle="A voice for each speaker, the ensemble, and the main character's look.">
        <CastPanel project={project} voices={voices} rooms={rooms} onEdit={onEdit} />
      </Section>
      <Section title="Shots" subtitle={`${project.shots.length} clips. Reuse a library clip to pay nothing.`} defaultOpen>
        <ShotsPanel
          project={project} busy={busy !== null || project.running.shots} onEdit={editChecked}
          onReroll={async (shotId) => { await order(false, [shotId]); }}
          onUseLibrary={async (shotId, clipId) => { await run('library', () => sceneScriptApi.useLibraryClip(id, shotId, clipId)); }}
        />
      </Section>
      <Section title="Music" subtitle="One bed per cue, ducked under the voices.">
        <MusicPanel project={project} onEdit={onEdit} />
      </Section>

      <div className="flex justify-end border-t border-editor-line pt-5">
        <Button
          variant="danger"
          disabled={busy !== null || inProgress(project)}
          onClick={() => {
            if (!window.confirm('Delete this scene script? Its clips stay in your visual library.')) return;
            void run('delete', async () => { await sceneScriptApi.remove(id); navigate('/app/scene-script'); });
          }}
        >
          <Trash2 size={16} aria-hidden="true" /> Delete scene script
        </Button>
      </div>
    </div>
  );
}

/** Scene scripts: paste an authored cinematic script and make the video it describes. Super admins only. */
export function SceneScriptPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isSuperAdmin = useAuth((s) => s.isSuperAdmin);
  const [mode, setMode] = useState<SceneScriptMode | null>(null);

  if (!isSuperAdmin) {
    return <p className="text-help">Scene scripts are available to super admins only for now.</p>;
  }
  if (id) return <ProjectEditor id={id} />;
  const choose = (next: SceneScriptMode) => {
    if (next === 'cartoon') navigate('/app/scene-script/cartoon/new');
    else setMode(next);
  };
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Studio"
        title={<>Your script, <em>word for word</em>.</>}
        subtitle="Every line is spoken exactly as you wrote it. Choose how it is filmed."
      />
      <ModeChoice selected={mode} onChoose={choose} />
      {mode === 'human' && <ScriptPaste onCreated={(newId) => navigate(`/app/scene-script/${newId}`)} />}
      <ProjectList />
    </div>
  );
}
