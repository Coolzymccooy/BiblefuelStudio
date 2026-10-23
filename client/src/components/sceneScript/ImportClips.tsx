import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { toastError } from '../../lib/errors';
import { uploadMedia } from '../../lib/mediaUpload';
import { MAX_SCENE_VIDEO_BYTES, SCENE_VIDEO_TOO_BIG } from '../../lib/storyImages';
import { visualLibraryApi } from '../../lib/sceneScriptApi';

interface Props {
  onImported: () => void;
}

/**
 * Add clips made elsewhere to the library, one after another. The optional
 * description becomes each clip's prompt, so the clips are offered when a
 * shot asks for something close.
 */
export function ImportClips({ onImported }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState('');

  const importAll = async (files: File[]) => {
    let added = 0;
    const failed: string[] = [];
    setResult('');
    for (const [i, file] of files.entries()) {
      setProgress({ done: i, total: files.length });
      try {
        if (file.size > MAX_SCENE_VIDEO_BYTES) throw new Error(SCENE_VIDEO_TOO_BIG);
        const uploaded = await uploadMedia(file, file.name, 'background');
        await visualLibraryApi.importClip({ uploadPath: uploaded.file, prompt: prompt.trim() });
        added += 1;
      } catch (e) {
        failed.push(file.name);
        toastError(e);
      }
    }
    setProgress(null);
    setResult(`${added} of ${files.length} imported.${failed.length ? ` Not imported: ${failed.join(', ')}.` : ''}`);
    if (added) onImported();
  };

  return (
    <div className="space-y-2 rounded-lg border border-editor-line p-3">
      <Field label="What the clips show (optional)" htmlFor="import-prompt" tooltip="Becomes each clip's prompt, so it is offered for shots that ask for something close.">
        <Input id="import-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={1500} placeholder="A still lake at dawn" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v" multiple className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            if (files.length) void importAll(files);
          }}
        />
        <Button variant="secondary" onClick={() => input.current?.click()} isLoading={progress !== null} disabled={progress !== null}>
          <Upload size={16} aria-hidden="true" /> Import clips
        </Button>
        <p className="text-help tabular-nums" aria-live="polite">
          {progress ? `Importing ${progress.done + 1} of ${progress.total}…` : result}
        </p>
      </div>
    </div>
  );
}
