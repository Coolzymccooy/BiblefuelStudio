/**
 * Step 4 of a cartoon: the shot list. Every shot in order with its line,
 * length, price, director's note and first frame, and the film's total
 * against the 40 s limit. Approving the list is the last check before money
 * is spent on clips; any later change to the style, a look, a note or a first
 * frame asks for approval again (the server clears it). If a portrait is not
 * approved the server answers CAST_NOT_READY with the names still waiting,
 * shown here with a way back to the cast.
 */
import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { cartoonApi } from '../../lib/cartoonApi';
import { isApiError } from '../../lib/apiError';
import type { CartoonErrorPayload, CartoonProject } from '../../lib/cartoonTypes';
import { Button } from '../ui/Button';
import { money } from '../sceneScript/format';
import { MAX_FILM_SEC } from './LengthMeter';
import { ShotRow } from './ShotRow';
import { listNames } from './cast';

interface Props {
  project: CartoonProject;
  onSaved: (project: CartoonProject) => void;
  onNext: () => void;
  onGoCast: () => void;
}

type Problem = { waiting: string[] } | { message: string };

const secs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function ProblemNote({ problem, onGoCast }: { problem: Problem; onGoCast: () => void }) {
  if ('message' in problem) return <p role="alert" className="text-sm text-bf-danger">{problem.message}</p>;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-bf-danger">Still waiting for approved portraits of {listNames(problem.waiting)}.</p>
      <Button variant="ghost" className="!px-3 !py-1.5 text-sm" onClick={onGoCast}>Go to cast</Button>
    </div>
  );
}

export function ShotListStep({ project, onSaved, onNext, onGoCast }: Props) {
  const [approving, setApproving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const filming = project.running.film;
  const { check, estimate } = project;

  const approve = async () => {
    setApproving(true);
    setProblem(null);
    try {
      onSaved(await cartoonApi.approveShots(project.id));
    } catch (e) {
      const waiting = isApiError(e) && e.code === 'CAST_NOT_READY' ? (e.payload as CartoonErrorPayload).waiting : undefined;
      if (waiting?.length) setProblem({ waiting });
      else setProblem({ message: e instanceof Error ? e.message : 'Could not approve the shot list.' });
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="space-y-6">
      <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-2 rounded-card border border-editor-line bg-bf-card px-4 py-3">
        <div>
          <dt className="text-xs text-bf-muted">Film length, with both cards</dt>
          <dd className="text-sm font-medium tabular-nums text-bf-cream">{secs(check.filmSec)} s of {MAX_FILM_SEC}</dd>
        </div>
        <div>
          <dt className="text-xs text-bf-muted">Clips still to make</dt>
          <dd className="text-sm font-medium tabular-nums text-bf-cream">about {money(estimate.usd)}</dd>
        </div>
      </dl>
      {filming && <p className="text-help" aria-live="polite">Wait for the film to finish before changing the shots.</p>}
      <ol aria-label="Shot list" className="space-y-3">
        {project.shots.map((shot, index) => (
          <ShotRow key={shot.id} project={project} shot={shot} index={index} disabled={filming} onSaved={onSaved} />
        ))}
      </ol>
      <div className="space-y-3 border-t border-editor-line pt-4">
        {problem && <ProblemNote problem={problem} onGoCast={onGoCast} />}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {project.shotListApproved ? (
            <>
              <span className="inline-flex items-center gap-1 text-sm text-bf-success"><Check size={16} aria-hidden="true" /> Shot list approved</span>
              <Button onClick={onNext}>Next <ArrowRight size={16} aria-hidden="true" /></Button>
            </>
          ) : (
            <>
              <p className="text-help">Changing the style, a look, a note or a first frame asks for approval again.</p>
              <Button onClick={approve} isLoading={approving} disabled={filming}>Approve shot list</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
