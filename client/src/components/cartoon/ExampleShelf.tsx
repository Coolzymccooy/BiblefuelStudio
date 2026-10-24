/**
 * The shelf of example scripts. Using one saves it straight away as a new
 * cartoon with its cast and style ready, so the admin can see the whole
 * journey before writing anything of their own.
 */
import type { CartoonExample } from '../../lib/cartoonTypes';
import { Button } from '../ui/Button';

interface Props {
  /** Null while loading. */
  examples: CartoonExample[] | null;
  /** The example being saved, if any. */
  busyId: string | null;
  disabled: boolean;
  onUse: (exampleId: string) => void;
}

export function ExampleShelf({ examples, busyId, disabled, onUse }: Props) {
  if (examples !== null && examples.length === 0) return null;
  return (
    <section aria-labelledby="cartoon-examples-heading" className="space-y-3 border-t border-editor-line pt-6">
      <div>
        <h2 id="cartoon-examples-heading" className="text-sm font-semibold text-bf-cream">Start from an example</h2>
        <p className="text-help">Each opens as a new cartoon with its cast and style ready.</p>
      </div>
      {examples === null ? (
        <p className="text-help">Loading examples…</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {examples.map((ex) => (
            <li key={ex.id} className="flex flex-col gap-2 rounded-card border border-editor-line bg-bf-card p-4">
              <h3 id={`example-${ex.id}`} className="text-sm font-semibold text-bf-cream">{ex.title}</h3>
              <p className="text-xs tabular-nums text-bf-sub">{ex.verse}</p>
              <p className="text-help flex-1">{ex.blurb}</p>
              <Button
                variant="secondary"
                className="mt-1 text-sm"
                aria-describedby={`example-${ex.id}`}
                isLoading={busyId === ex.id}
                disabled={disabled}
                onClick={() => onUse(ex.id)}
              >
                Use this example
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
