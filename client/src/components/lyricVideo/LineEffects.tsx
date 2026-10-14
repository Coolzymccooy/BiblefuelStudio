import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import type { LyricEffect, LyricProject } from '../../lib/lyricVideoTypes';
import { isPlacedLine } from '../../lib/lyricTiming';
import { fieldLabelCls, inputCls } from '../story/formStyles';
import { messageOf } from './messageOf';

const CHOICES: Array<{ value: Exclude<LyricEffect, 'auto' | 'title'>; label: string }> = [
  { value: 'pop', label: 'Pop' },
  { value: 'stack', label: 'Stack' },
  { value: 'slam', label: 'Slam' },
  { value: 'quote', label: 'Quote' },
  { value: 'curve', label: 'Curve' },
  { value: 'frame', label: 'Frame' },
  { value: 'echo', label: 'Echo (crowd reply)' },
];

/** The short name shown after "Auto ·": the label without its explanation. */
const SHORT_NAMES: Record<string, string> = {
  title: 'Title',
  ...Object.fromEntries(CHOICES.map((c) => [c.value, c.label.split(' ')[0]])),
};

interface Props {
  project: LyricProject;
  onChange: (p: LyricProject) => void;
  /** Called after a change is saved, so the preview can redraw. */
  onPreviewChange: () => void;
}

/** Step 4: pick how each timed line appears, or leave it on Auto and let the video choose. */
export function LineEffects({ project, onChange, onPreviewChange }: Props) {
  const [resolved, setResolved] = useState<Record<string, LyricEffect>>({});
  const [busy, setBusy] = useState(false);
  const lines = project.lines.filter(isPlacedLine);
  // One fetch per change to anything that decides an Auto line's effect, not one per line.
  const key = `${project.look.seed}|${project.look.energy}|${lines.map((l) => `${l.id}:${l.effect}`).join(',')}`;

  useEffect(() => {
    if (lines.length === 0) return undefined;
    let live = true;
    lyricVideoApi.effects(project.projectId)
      .then((fx) => { if (live) setResolved(fx); })
      .catch(() => undefined); // Auto then reads just "Auto"; the choices themselves still work.
    return () => { live = false; };
    // `key` stands for the lines and look it was built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.projectId, key]);

  const choose = async (lineId: string, effect: LyricEffect) => {
    setBusy(true);
    try {
      onChange(await lyricVideoApi.patchLine(project.projectId, lineId, { effect }));
      onPreviewChange();
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (lines.length === 0) return null;
  return (
    <section aria-labelledby="line-effects-heading" className="space-y-2">
      <h3 id="line-effects-heading" className={fieldLabelCls}>Effect for each line</h3>
      <ul
        tabIndex={0}
        aria-labelledby="line-effects-heading"
        className="max-h-96 space-y-2 overflow-y-auto pr-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bf-gold"
      >
        {lines.map((l) => (
          <li key={l.id} className="flex items-center gap-3">
            <span title={l.text} className="min-w-0 flex-1 truncate text-sm text-bf-cream">{l.text}</span>
            <select
              aria-label={`Effect for “${l.text}”`}
              className={`${inputCls} !mt-0 w-44 shrink-0`}
              value={l.effect}
              disabled={busy}
              onChange={(e) => void choose(l.id, e.target.value as LyricEffect)}
            >
              <option value="auto">{resolved[l.id] ? `Auto · ${SHORT_NAMES[resolved[l.id]] ?? 'Auto'}` : 'Auto'}</option>
              {CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </li>
        ))}
      </ul>
    </section>
  );
}
