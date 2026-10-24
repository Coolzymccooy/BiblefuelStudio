/**
 * A cartoon (admin-only talking cartoon film, up to 40 s) as a row of steps:
 * Script, Cast, Style, Shots, Film, Finish. A step opens once the ones before
 * it are satisfied (see `reachableSteps`), and a saved cartoon opens at the
 * furthest step it has reached.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useAuth } from '../hooks/useAuth';
import type { CartoonProject } from '../lib/cartoonTypes';
import { CARTOON_STEPS, furthestStep, reachableSteps, type CartoonStepId } from '../components/cartoon/steps';
import { ScriptStep } from '../components/cartoon/ScriptStep';
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

function StepPanel({ step, project, onSaved }: { step: CartoonStepId; project: CartoonProject | null; onSaved: (p: CartoonProject) => void }) {
  const info = CARTOON_STEPS.find((s) => s.id === step) ?? CARTOON_STEPS[0];
  return (
    <section aria-labelledby="cartoon-step-heading" className="space-y-4">
      <div>
        <h2 id="cartoon-step-heading" className="text-lg font-semibold text-bf-cream">{info.label}</h2>
        <p className="text-help">{info.summary}</p>
      </div>
      {step === 'script' && <ScriptStep project={project} onSaved={onSaved} />}
      {/* TODO(Task 16): the Cast and Style steps render here. */}
      {/* TODO(Task 17): the Shots, Film and Finish steps render here. */}
    </section>
  );
}

function Shell({ project, onSaved }: { project: CartoonProject | null; onSaved?: (p: CartoonProject) => void }) {
  const [chosen, setChosen] = useState<CartoonStepId>(() => furthestStep(project));
  const open = reachableSteps(project);
  // A poll can close a step (a portrait made again needs approving again): fall back to the furthest open one.
  const active = open.includes(chosen) ? chosen : open[open.length - 1];
  const saved = (p: CartoonProject) => {
    onSaved?.(p);
    if (reachableSteps(p).includes('cast')) setChosen('cast');
  };
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
      <StepPanel step={active} project={project} onSaved={saved} />
    </div>
  );
}

function SavedCartoon({ id }: { id: string }) {
  const { project, error, apply } = useCartoonProject(id);
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
  return <Shell project={project} onSaved={apply} />;
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
