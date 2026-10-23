import { BusyBar } from '../ui/BusyBar';
import { Button } from '../ui/Button';
import { isRerollInFlight } from './useRerolls';
import type { RerollJob } from '../../lib/sceneScriptTypes';

// Seedance usually takes one to three minutes for a clip.
const TYPICAL_MS = 120_000;
const SHOW_FAILED_MS = 60 * 60 * 1000;
const short = (text: string) => (text.length > 70 ? `${text.slice(0, 67)}…` : text);

/** What is being made, what failed in the hour before checkedAt, and any paid clip still to be fetched. */
export function RerollJobs({ jobs, checkedAt, onRefetch }: { jobs: RerollJob[]; checkedAt: number; onRefetch: (job: RerollJob) => void }) {
  const recent = jobs.filter((j) => isRerollInFlight(j) || j.refetchable
    || (j.status === 'error' && checkedAt - j.createdAt < SHOW_FAILED_MS));
  if (!recent.length) return null;
  return (
    <ul className="space-y-2" aria-label="Re-rolls">
      {recent.map((j) => (
        <li key={j.id}>
          {isRerollInFlight(j)
            ? <BusyBar label={`Making a new clip: ${short(j.prompt)}`} estimatedMs={TYPICAL_MS} />
            : (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-bf-danger" role="alert">Re-roll of “{short(j.prompt)}” failed. {j.error}</p>
                {j.refetchable && <Button variant="secondary" onClick={() => onRefetch(j)}>Fetch it again (free)</Button>}
              </div>
            )}
        </li>
      ))}
    </ul>
  );
}
