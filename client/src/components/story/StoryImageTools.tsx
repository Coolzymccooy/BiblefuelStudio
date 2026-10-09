import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ClipboardCopy, Download, Loader2, Upload } from 'lucide-react';
import type { StoryProject } from '../../lib/storyTypes';
import { buildImageBrief, briefFileName, scenesNeedingImages, type CastCharacter } from '../../lib/storyBrief';
import { pairFilesWithScenes, putOwnImage } from '../../lib/storyImages';
import { copyText, downloadText } from '../../lib/copyText';
import { secondaryBtnCls } from './formStyles';

export interface StoryImageToolsProps {
  project: StoryProject;
  /** Cast descriptions for the brief, from GET /api/story/characters. */
  characters?: CastCharacter[];
  /** Something page-wide is running: hold off. */
  busy: boolean;
  /** Re-read the project after pictures change. */
  onChanged: () => void;
}

const btn = `${secondaryBtnCls} px-3 py-1.5 text-xs`;

/**
 * Finishing a Story's pictures outside BibleFuel, for when the free image
 * quota has run out: copy everything an image AI needs in one go, then bring
 * the pictures back several at a time.
 */
export function StoryImageTools({ project, characters = [], busy, onChanged }: StoryImageToolsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const missing = scenesNeedingImages(project).length;
  const someDone = missing < project.scenes.length;

  const copyBrief = async (onlyMissing: boolean) => {
    const text = buildImageBrief(project, { onlyMissing, characters });
    if (await copyText(text)) {
      toast.success(onlyMissing
        ? `Copied the ${missing === 1 ? 'scene' : `${missing} scenes`} still needing images. Paste it into ChatGPT or Gemini.`
        : 'Copied everything. Paste it into ChatGPT, Gemini or any AI.');
    } else {
      downloadText(briefFileName(project), text);
      toast('Copying isn’t allowed here, so it was downloaded as a .txt instead.');
    }
  };

  const uploadSeveral = async (list: FileList) => {
    const { pairs, extra } = pairFilesWithScenes(Array.from(list), project.scenes);
    if (!pairs.length) {
      toast.error(missing
        ? `None of those match a scene: this story has scenes 1 to ${project.scenes.length}.`
        : 'Every scene already has a picture. Name a file “Scene 3” to replace scene 3’s.');
      return;
    }
    setUploading(true);
    const toastId = toast.loading(`Uploading 1 of ${pairs.length}…`);
    let done = 0;
    const failed: string[] = [];
    try {
      for (const { file, scene } of pairs) {
        toast.loading(`Uploading ${done + failed.length + 1} of ${pairs.length}…`, { id: toastId });
        const number = project.scenes.indexOf(scene) + 1;
        try {
          await putOwnImage(project.projectId, scene.id, file);
          done += 1;
          onChanged();
        } catch (e) {
          const msg = (e as Error).message || 'failed';
          failed.push(`scene ${number}: ${msg}`);
          // A run or render started meanwhile: every later one would be refused too.
          const code = (e as { code?: string }).code;
          if (code === 'IMAGES_RUNNING' || code === 'RENDERING') break;
        }
      }
    } finally {
      setUploading(false);
      onChanged();
    }
    const notes = [
      extra.length ? `${extra.length} not used (no scene left for ${extra.length === 1 ? 'it' : 'them'})` : '',
      failed.length ? `${failed.length} failed: ${failed[0]}` : '',
    ].filter(Boolean).join('. ');
    if (done) toast.success(`${done} picture${done === 1 ? '' : 's'} added${notes ? `. ${notes}` : ''}`, { id: toastId, duration: 6000 });
    else toast.error(notes || 'No pictures were added', { id: toastId, duration: 6000 });
  };

  return (
    <div className="flex w-full flex-wrap gap-2">
      <button type="button" onClick={() => copyBrief(false)} className={btn}
        title="Instructions, style, cast, every scene's words and image prompt, and the full transcript">
        <ClipboardCopy size={12} /> Copy all for AI
      </button>
      {someDone && missing > 0 && (
        <button type="button" onClick={() => copyBrief(true)} className={btn}>
          <ClipboardCopy size={12} /> Copy missing only
        </button>
      )}
      <button type="button" className={btn} onClick={() => {
        downloadText(briefFileName(project), buildImageBrief(project, { characters }));
        toast.success('Brief downloaded');
      }}>
        <Download size={12} /> Download .txt
      </button>
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || uploading} className={btn}
        title="Pick several pictures. Ones named “Scene 3” go on scene 3; the rest fill the scenes still needing one, in order.">
        {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
        {uploading ? 'Uploading…' : 'Upload several'}
      </button>
      {/* JPEG/PNG/WebP only: iOS then hands over JPEGs instead of HEIC, which
          prod's ffmpeg cannot decode. */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        aria-label="Image files for several scenes"
        className="hidden"
        onChange={(e) => { if (e.target.files?.length) uploadSeveral(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}
