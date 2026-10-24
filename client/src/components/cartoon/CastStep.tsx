/**
 * Step 2 of a cartoon: the cast. One card per character with a look, a voice
 * and a portrait drawn from the look in the film's style. The approved
 * portrait is sent with every new-angle shot, which is what keeps a face the
 * same from shot to shot, so Next waits until every character in the script
 * (every speaker included) has one approved. Portraits are drawn in the
 * background; the page polls while the server says they are running.
 */
import { ArrowRight } from 'lucide-react';
import type { CartoonProject } from '../../lib/cartoonTypes';
import { Button } from '../ui/Button';
import { money } from '../sceneScript/format';
import { CastCard } from './CastCard';
import { ShelfPicker } from './ShelfPicker';
import { listNames, waitingCast } from './cast';

export const CAST_NOTE = 'The approved portrait is what keeps each face the same in every shot.';

interface Props {
  project: CartoonProject;
  onSaved: (project: CartoonProject) => void;
  onNext: () => void;
}

function waitingSentence(names: string[]): string {
  return names.length === 1
    ? `Approve ${names[0]}'s portrait to go on.`
    : `Approve the portraits of ${listNames(names)} to go on.`;
}

export function CastStep({ project, onSaved, onNext }: Props) {
  const waiting = waitingCast(project);
  const { images, imageUsd } = project.estimate ?? { images: 0, imageUsd: 0 };
  const each = images > 0 ? imageUsd / images : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-bf-cream">{CAST_NOTE}</p>
        {each !== null && <p className="text-help tabular-nums">Each portrait costs about {money(each)}.</p>}
        {project.running.pictures && (
          <p className="text-help" aria-live="polite">Drawing portraits. Looks and voices can be changed when they finish.</p>
        )}
      </div>
      <ul className="grid gap-4 xl:grid-cols-2">
        {Object.entries(project.cast).map(([name, member], index) => (
          <CastCard key={name} project={project} name={name} member={member} index={index} onSaved={onSaved} />
        ))}
      </ul>
      <ShelfPicker project={project} onSaved={onSaved} />
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-editor-line pt-4">
        {waiting.length > 0 && <p className="text-help" id="cast-waiting">{waitingSentence(waiting)}</p>}
        <Button onClick={onNext} disabled={waiting.length > 0} aria-describedby={waiting.length > 0 ? 'cast-waiting' : undefined}>
          Next <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
