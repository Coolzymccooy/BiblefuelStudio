/**
 * A cartoon (admin-only talking cartoon film, up to 40 s) as a row of steps:
 * Script, Cast, Style, Shots, Film, Finish. A step opens once the ones before
 * it are satisfied (see `reachableSteps`), and a saved cartoon opens at the
 * furthest step it has reached. Moving to another step scrolls to its top.
 * A saved cartoon can be deleted at the foot of the page, as in Human mode;
 * its clips stay in the visual library.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Button } from '../components/ui/Button';
import { useAuth } from '../hooks/useAuth';
import { cartoonApi } from '../lib/cartoonApi';
import { toastError } from '../lib/errors';
import type { CartoonMonth, CartoonProject } from '../lib/cartoonTypes';
import { CARTOON_STEPS, furthestStep, reachableSteps, type CartoonStepId } from '../components/cartoon/steps';
import { ScriptStep } from '../components/cartoon/ScriptStep';
import { CastStep } from '../components/cartoon/CastStep';
import { StyleStep } from '../components/cartoon/StyleStep';
import { ShotListStep } from '../components/cartoon/ShotListStep';
import { FilmStep } from '../components/cartoon/FilmStep';
import { FinishStep } from '../components/cartoon/FinishStep';
import { useCartoonProject } from '../components/cartoon/useCartoonProject';

function StepNav({ open, active, onSelect }: { open: CartoonStepId[]; active: CartoonStepId; onSelect: (id: CartoonStepId) => void }) {
  return (
    <nav aria-label="Cartoon steps">
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {CARTOON_STEPS.map((step, i) => {
          const reachable = open.includes(step.id);
          const current = step.id === active;
          const tone = current
            ? 'border-editor-accent text-bf-cream'
            : reachable
              ? 'border-editor-line text-bf-sub hover:border-editor-accent/50 hover:text-bf-cream'
              : 'cursor-not-allowed border-editor-line text-bf-muted opacity-60';
          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!reachable}
                aria-current={current ? 'step' : undefined}
                onClick={() => onSelect(step.id)}
                className={`flex w-full items-center gap-2 rounded-lg border bg-bf-card px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bf-gold ${tone}`}
              >
                <span className={`text-xs tabular-nums ${current ? 'text-bf-gold' : ''}`} aria-hidden="true">{i + 1}</span>
                <span className="font-medium">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface PanelProps {
  step: CartoonStepId;
  project: CartoonProject | null;
  /** This month's AI video spend against the cap, for the Film step's price line. */
  month: CartoonMonth | null;
  /** False when AI video is not set up on this server. */
  seedance: boolean;
  /** Applies a project an action returned. */
  onSaved: (p: CartoonProject) => void;
  /** The Script step's Next: apply, then open Cast once it can be reached. */
  onScriptSaved: (p: CartoonProject) => void;
  onGo: (step: CartoonStepId) => void;
}

function StepPanel({ step, project, month, seedance, onSaved, onScriptSaved, onGo }: PanelProps) {
  const info = CARTOON_STEPS.find((s) => s.id === step) ?? CARTOON_STEPS[0];
  return (
    <section aria-labelledby="cartoon-step-heading" className="space-y-4">
      <div>
        <h2 id="cartoon-step-heading" className="text-lg font-semibold text-bf-cream">{info.label}</h2>
        <p className="text-help">{info.summary}</p>
      </div>
      {step === 'script' && <ScriptStep project={project} onSaved={onScriptSaved} />}
      {step === 'cast' && project && <CastStep project={project} onSaved={onSaved} onNext={() => onGo('style')} />}
      {step === 'style' && project && <StyleStep project={project} onSaved={onSaved} onNext={() => onGo('shots')} />}
      {step === 'shots' && project && (
        <ShotListStep project={project} onSaved={onSaved} onNext={() => onGo('film')} onGoCast={() => onGo('cast')} />
      )}
      {step === 'film' && project && (
        <FilmStep project={project} month={month} seedance={seedance} onSaved={onSaved} onNext={() => onGo('finish')} />
      )}
      {step === 'finish' && project && <FinishStep project={project} onSaved={onSaved} />}
    </section>
  );
}

/** Delete the cartoon, after a confirm. Off while a step runs; the server's BUSY answer is shown if one starts meanwhile. */
function DeleteCartoon({ project }: { project: CartoonProject }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const running = Object.values(project.running ?? {}).some(Boolean);
  const remove = async () => {
    if (!window.confirm('Delete this cartoon? Its clips stay in your visual library.')) return;
    setBusy(true);
    try {
      await cartoonApi.remove(project.id);
      navigate('/app/scene-script');
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-editor-line pt-5">
      {running && <p id="cartoon-delete-why" className="text-help">Stop the running step before deleting this cartoon.</p>}
      <Button
        variant="danger"
        onClick={() => { void remove(); }}
        isLoading={busy}
        disabled={busy || running}
        aria-describedby={running ? 'cartoon-delete-why' : undefined}
      >
        <Trash2 size={16} aria-hidden="true" /> Delete cartoon
      </Button>
    </div>
  );
}

/** Scroll a step's panel to its top when the step changes, never on the first show. */
function useScrollToStep(active: CartoonStepId) {
  const panel = useRef<HTMLDivElement>(null);
  const shown = useRef<CartoonStepId | null>(null);
  useEffect(() => {
    if (shown.current !== null && shown.current !== active) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      panel.current?.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    }
    shown.current = active;
  }, [active]);
  return panel;
}

interface ShellProps {
  project: CartoonProject | null;
  month?: CartoonMonth | null;
  seedance?: boolean;
  onSaved?: (p: CartoonProject) => void;
}

function Shell({ project, month = null, seedance = true, onSaved }: ShellProps) {
  const [chosen, setChosen] = useState<CartoonStepId>(() => furthestStep(project));
  const open = reachableSteps(project);
  // An edit or a poll can close a step (a new style needs the portraits approved again):
  // fall back to the furthest open one, and stay there rather than jump back once it reopens.
  const active = open.includes(chosen) ? chosen : open[open.length - 1];
  useEffect(() => { if (active !== chosen) setChosen(active); }, [active, chosen]);
  const saved = (p: CartoonProject) => { onSaved?.(p); };
  const scriptSaved = (p: CartoonProject) => {
    onSaved?.(p);
    if (reachableSteps(p).includes('cast')) setChosen('cast');
  };
  // Next is only offered once the next step's condition holds, so the target is open by then.
  const go = (step: CartoonStepId) => setChosen(step);
  const panel = useScrollToStep(active);
  return (
    <div className="space-y-6">
      <div>
        <Link to="/app/scene-script" className="inline-flex items-center gap-1 text-sm text-bf-sub hover:text-bf-cream">
          <ArrowLeft size={14} aria-hidden="true" /> All scene scripts
        </Link>
        <ScreenHeader
          eyebrow="Cartoon"
          title={project?.meta.title || 'New cartoon'}
          subtitle={project?.meta.verse.reference || 'Characters speak their own lines. Up to 40 seconds.'}
          className="mt-2"
        />
      </div>
      <StepNav open={open} active={active} onSelect={setChosen} />
      <div ref={panel} className="scroll-mt-4">
        <StepPanel step={active} project={project} month={month} seedance={seedance} onSaved={saved} onScriptSaved={scriptSaved} onGo={go} />
      </div>
      {project && <DeleteCartoon project={project} />}
    </div>
  );
}

function SavedCartoon({ id }: { id: string }) {
  const { project, month, seedance, error, apply } = useCartoonProject(id);
  if (error && !project) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-bf-danger">{error}</p>
        <Link to="/app/scene-script" className="inline-flex items-center gap-1 text-sm text-bf-sub hover:text-bf-cream">
          <ArrowLeft size={14} aria-hidden="true" /> All scene scripts
        </Link>
      </div>
    );
  }
  if (!project) return <p className="text-help">Loading…</p>;
  return <Shell project={project} month={month} seedance={seedance} onSaved={apply} />;
}

/** Cartoon mode under Scene script. Super admins only, like Scene script itself. */
export function CartoonPage() {
  const { id } = useParams();
  const isSuperAdmin = useAuth((s) => s.isSuperAdmin);
  if (!isSuperAdmin) {
    return <p className="text-help">Scene scripts are available to super admins only for now.</p>;
  }
  return id ? <SavedCartoon key={id} id={id} /> : <Shell project={null} />;
}
