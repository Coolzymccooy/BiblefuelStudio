/**
 * Step 1 of a cartoon: the script. Three ways in on one screen: paste into the
 * editor, have BibleFuel write a draft, or start from an example. The editor's
 * text is never reformatted; the meter under it reads the script as the server
 * will save it, and Next stays off until the film fits 40 seconds. While a
 * draft is being written the editor and Next are off, so typed text is never
 * replaced and Next never saves the old text.
 *
 * Once a clip has been ordered the lines are locked (the same rule as the
 * server's `isLocked`). "Start over" then makes a new cartoon from this
 * script; this one and its paid clips stay.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Lock, RotateCcw } from 'lucide-react';
import { cartoonApi } from '../../lib/cartoonApi';
import type { CartoonExample, CartoonProject } from '../../lib/cartoonTypes';
import { toastError } from '../../lib/errors';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Textarea } from '../ui/Textarea';
import { ExampleShelf } from './ExampleShelf';
import { LengthMeter, readyToSave, useLengthCheck } from './LengthMeter';
import { WriteForMe } from './WriteForMe';
import { cartoonPath, isLocked } from './steps';

interface Props {
  /** The saved cartoon, or null for a new one. */
  project?: CartoonProject | null;
  /** Called with the saved project when Next is pressed on an existing cartoon. */
  onSaved?: (project: CartoonProject) => void;
}

const FORMAT_HELP = 'Start with # Title, Verse: and Style: lines, then Cast: with one "- Name: look. Voice: …" per character. '
  + 'Each Scene: line starts a new place; the text after the comma is the director\'s note. '
  + 'Name: "line" is spoken exactly as written, and (text in brackets) is action without speech.';


export function ScriptStep({ project = null, onSaved }: Props) {
  const navigate = useNavigate();
  const [markdown, setMarkdown] = useState(project?.source.markdown ?? '');
  const [examples, setExamples] = useState<CartoonExample[] | null>(null);
  const [placeholder, setPlaceholder] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const length = useLengthCheck(markdown);
  // Once a clip is ordered the server refuses script edits, so say so up front.
  const locked = isLocked(project);

  useEffect(() => {
    cartoonApi.examples()
      .then((r) => { setExamples(r.examples); setPlaceholder(r.placeholder); })
      .catch((e) => { toastError(e); setExamples([]); });
  }, []);

  const startFromExample = async (exampleId: string) => {
    setBusy(exampleId);
    try {
      const created = await cartoonApi.create({ exampleId });
      navigate(cartoonPath(created.id));
    } catch (e) {
      toastError(e);
      setBusy(null);
    }
  };

  const next = async () => {
    setBusy('next');
    try {
      if (!project) {
        const created = await cartoonApi.create({ markdown });
        navigate(cartoonPath(created.id));
        return;
      }
      const saved = markdown === project.source.markdown ? project : await cartoonApi.update(project.id, { markdown });
      setBusy(null);
      onSaved?.(saved);
    } catch (e) {
      toastError(e);
      setBusy(null);
    }
  };

  const startOver = async () => {
    if (!project) return;
    setBusy('start-over');
    try {
      const created = await cartoonApi.create({ markdown: project.source.markdown });
      navigate(cartoonPath(created.id));
    } catch (e) {
      toastError(e);
      setBusy(null);
    }
  };

  const canNext = locked ? true : readyToSave(length);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Field label="Your script" htmlFor="cartoon-script" tooltip={FORMAT_HELP}>
            <Textarea
              id="cartoon-script"
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder={placeholder}
              spellCheck={false}
              readOnly={locked || writing}
              aria-busy={writing || undefined}
              rows={18}
              className="font-mono text-sm"
            />
          </Field>
          {locked ? (
            <div className="space-y-3">
              <p className="flex items-start gap-2 text-help">
                <Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                The lines are locked because clips have been ordered. They are spoken exactly as saved.
              </p>
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-editor-line bg-bf-card px-3 py-2">
                <Button variant="secondary" onClick={startOver} isLoading={busy === 'start-over'} disabled={busy !== null} aria-describedby="cartoon-start-over-note">
                  <RotateCcw size={16} aria-hidden="true" /> Start over
                </Button>
                <p id="cartoon-start-over-note" className="text-help">Starts a new cartoon from this script. Clips you paid for stay in your library.</p>
              </div>
            </div>
          ) : (
            <LengthMeter state={length} />
          )}
          <div className="flex justify-end">
            <Button onClick={next} isLoading={busy === 'next'} disabled={!canNext || busy !== null || writing}>
              Next <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>
        </div>
        {!locked && <WriteForMe current={markdown} onDraft={setMarkdown} onWritingChange={setWriting} />}
      </div>
      {!project && (
        <ExampleShelf examples={examples} busyId={busy} disabled={busy !== null} onUse={(exampleId) => { void startFromExample(exampleId); }} />
      )}
    </div>
  );
}
