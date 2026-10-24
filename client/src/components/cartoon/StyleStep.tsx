/**
 * Step 3 of a cartoon: one art style for the whole film. The style's text
 * opens every portrait and clip prompt. Changing it once portraits exist keeps
 * the pictures but un-approves them all (they were drawn in the old style),
 * so the admin is asked first; the journey then falls back to Cast until each
 * portrait is approved again.
 */
import { useEffect, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { cartoonApi } from '../../lib/cartoonApi';
import type { CartoonProject, CartoonStyle } from '../../lib/cartoonTypes';
import { toastError } from '../../lib/errors';
import { Button } from '../ui/Button';

export const STYLE_CHANGE_WARNING = 'Changing the style keeps the portraits but asks you to approve them again, since they were drawn in the old style.';

/** One line on how each style looks (spec 7.4). The server owns the ids and labels. */
const STYLE_LINES: Record<string, string> = {
  family3d: 'Soft global light, rounded shapes, expressive large eyes and rich colour.',
  storybook: 'Painted, textured, warm paper tones.',
  clay: 'A handmade clay look with a gentle stop-motion feel.',
};

interface Props {
  project: CartoonProject;
  onSaved: (project: CartoonProject) => void;
  onNext: () => void;
}

export function StyleStep({ project, onSaved, onNext }: Props) {
  const [styles, setStyles] = useState<CartoonStyle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const anyPortrait = Object.values(project.cast).some((m) => m.portrait);
  const locked = project.running.pictures;
  const current = project.meta.style;

  useEffect(() => {
    let live = true;
    cartoonApi.styles().then(
      (r) => { if (live) setStyles(r.styles); },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the cartoon styles.'); },
    );
    return () => { live = false; };
  }, []);

  const choose = async (id: string) => {
    if (id === current || saving) return;
    if (anyPortrait && !window.confirm(STYLE_CHANGE_WARNING)) return;
    setSaving(id);
    try {
      onSaved(await cartoonApi.update(project.id, { style: id }));
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="text-sm text-bf-danger">{error}</p>}
      {!error && styles === null && <p className="text-help">Loading styles…</p>}
      {styles && (
        <fieldset className="space-y-3" disabled={locked || saving !== null}>
          <legend className="sr-only">Art style</legend>
          <div className="grid gap-3 md:grid-cols-3">
            {styles.map((style) => {
              const checked = style.id === current;
              return (
                <label key={style.id} className="block cursor-pointer has-[:disabled]:cursor-not-allowed">
                  <input
                    type="radio"
                    name="cartoon-style"
                    value={style.id}
                    checked={checked}
                    onChange={() => { void choose(style.id); }}
                    className="peer sr-only"
                  />
                  <span
                    className={`flex h-full flex-col gap-1 rounded-card border bg-bf-card p-4 transition-colors duration-150 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-bf-gold peer-disabled:opacity-60 ${checked ? 'border-editor-accent' : 'border-editor-line hover:border-editor-accent/50'}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-bf-cream">{style.label}</span>
                      {checked && <Check size={16} className="text-bf-gold" aria-hidden="true" />}
                    </span>
                    {STYLE_LINES[style.id] && <span className="text-help">{STYLE_LINES[style.id]}</span>}
                  </span>
                </label>
              );
            })}
          </div>
          {anyPortrait && <p className="text-help">{STYLE_CHANGE_WARNING}</p>}
          {locked && <p className="text-help" aria-live="polite">Wait for the portraits to finish before changing the style.</p>}
        </fieldset>
      )}
      <div className="flex justify-end border-t border-editor-line pt-4">
        <Button onClick={onNext} disabled={!current || saving !== null}>
          Next <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
