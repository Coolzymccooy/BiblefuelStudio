import { useState } from 'react';
import { BookOpenText } from 'lucide-react';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Textarea } from '../ui/Textarea';
import { toastError } from '../../lib/errors';
import { sceneScriptApi } from '../../lib/sceneScriptApi';
import type { SceneScriptProject, ShotEstimate } from '../../lib/sceneScriptTypes';
import { ScriptView } from './ScriptView';
import { money } from './format';

interface Props {
  onCreated: (id: string) => void;
}

/**
 * Step 1: paste. The textarea is never reformatted; "Read script" shows
 * exactly what will be spoken, by whom, over which shot, before anything is
 * saved or paid for.
 */
export function ScriptPaste({ onCreated }: Props) {
  const [markdown, setMarkdown] = useState('');
  const [preview, setPreview] = useState<{ project: SceneScriptProject; estimate: ShotEstimate } | null>(null);
  const [busy, setBusy] = useState<'read' | 'save' | null>(null);

  const read = async () => {
    setBusy('read');
    try {
      const r = await sceneScriptApi.parse(markdown);
      setPreview({ project: r.preview, estimate: r.estimate });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      const project = await sceneScriptApi.create(markdown);
      onCreated(project.id);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Field
        label="Your script"
        htmlFor="scene-script-markdown"
        tooltip="Paste a script with scenes, Visual lines, speaker tags such as Narrator (deep voice):, quoted lines and an optional music section. Your words are spoken exactly as written."
      >
        <Textarea
          id="scene-script-markdown"
          value={markdown}
          onChange={(e) => { setMarkdown(e.target.value); setPreview(null); }}
          spellCheck={false}
          rows={14}
          placeholder={'### Scene 1 — The Hook (0:00–0:12)\n*Visual: A man standing alone in the darkness.*\n**Narrator (deep, emotional voice):**\n"Look at me today…"'}
          className="font-mono text-sm"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={read} isLoading={busy === 'read'} disabled={!markdown.trim() || busy !== null}>
          <BookOpenText size={16} aria-hidden="true" /> Read script
        </Button>
        {preview && (
          <Button variant="secondary" onClick={save} isLoading={busy === 'save'} disabled={busy !== null || !preview.project.scenes.length}>
            Save as a project
          </Button>
        )}
        {preview && (
          <span className="text-help tabular-nums">
            {preview.project.lines.length} lines · {preview.project.shots.length} shots · clips about {money(preview.estimate.usd)}
          </span>
        )}
      </div>
      {preview && <ScriptView project={preview.project} readOnly />}
    </div>
  );
}
