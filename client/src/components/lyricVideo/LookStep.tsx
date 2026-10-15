import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { FALLBACK_ENERGIES, type StudioOption } from '../../lib/studioCaptions';
import type { BackgroundFit, LyricProject } from '../../lib/lyricVideoTypes';
import { StudioLookOptions } from '../captions/StudioEffects';
import { DropZone } from '../ui/DropZone';
import { dropZoneCls, fieldLabelCls, inputCls, panelCls, secondaryBtnCls } from '../story/formStyles';
import { LazyLivePreview } from './LazyLivePreview';
import { LineEffects } from './LineEffects';
import { messageOf } from './messageOf';
import { ShuffleButton } from './ShuffleButton';
import { useProjectSaves } from './useProjectSaves';

interface Props { project: LyricProject; onChange: (p: LyricProject) => void }

const FITS: Array<{ id: BackgroundFit; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'cover', label: 'Fill the frame' },
  { id: 'contain', label: 'Show it whole' },
];

/** The looks and energies the server offers; without them the saved look and the three standard energies still work. */
function useCaptionCatalogue() {
  const [studioLooks, setStudioLooks] = useState<StudioOption[]>([]);
  const [energies, setEnergies] = useState<StudioOption[]>([]);
  const [libass, setLibass] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.get<{ studioLooks?: StudioOption[]; energies?: StudioOption[]; libass?: boolean }>('/api/tts/animations');
      if (cancelled || !res.ok) return;
      setStudioLooks(res.data?.studioLooks ?? []);
      setEnergies(res.data?.energies ?? []);
      setLibass(res.data?.libass !== false);
    })();
    return () => { cancelled = true; };
  }, []);
  return { studioLooks, energies: energies.length > 0 ? energies : FALLBACK_ENERGIES, libass };
}

/** Step 4: pick how the words look and what sits behind them. */
export function LookStep({ project, onChange }: Props) {
  const catalogue = useCaptionCatalogue();
  const [assVersion, setAssVersion] = useState(1);
  const save = useProjectSaves(onChange);
  // How many of this step's own changes (look, energy, background) are still saving.
  const [pending, setPending] = useState(0);
  const busy = pending > 0;
  const [progress, setProgress] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { background, look } = project;

  /** Queues one change behind any still saving, files the answer on the project and says why when it did not work. */
  const apply = async (change: () => Promise<LyricProject>, redrawCaptions = false) => {
    setPending((n) => n + 1);
    try {
      await save(change);
      if (redrawCaptions) setAssVersion((v) => v + 1);
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setPending((n) => n - 1);
    }
  };

  const redrawPreview = () => setAssVersion((v) => v + 1);

  const upload = (file: File) => {
    setProgress(0);
    void apply(() => lyricVideoApi.uploadBackground(project.projectId, file, setProgress)).finally(() => setProgress(null));
  };

  return (
    <div className="space-y-4">
      <LazyLivePreview project={project} assVersion={assVersion} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="lyric-look" className={fieldLabelCls}>Look</label>
          <select
            id="lyric-look"
            className={inputCls}
            value={look.id}
            disabled={busy}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              const id = e.target.value; // read now: the write may wait behind another
              void apply(() => lyricVideoApi.setLook(project.projectId, { id }), true);
            }}
          >
            <StudioLookOptions looks={catalogue.studioLooks} libass={catalogue.libass} value={look.id} />
          </select>
        </div>
        <div>
          <label htmlFor="lyric-energy" className={fieldLabelCls}>Energy</label>
          <select
            id="lyric-energy"
            className={inputCls}
            value={look.energy}
            disabled={busy}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              const energy = e.target.value as LyricProject['look']['energy'];
              void apply(() => lyricVideoApi.setLook(project.projectId, { energy }), true);
            }}
          >
            {catalogue.energies.map((en) => <option key={en.id} value={en.id}>{en.label}</option>)}
          </select>
        </div>
      </div>

      <ShuffleButton project={project} save={save} onPreviewChange={redrawPreview} />

      <div className={`${panelCls} space-y-3`}>
        <p className={fieldLabelCls}>Background</p>
        <DropZone
          onFiles={(files) => { if (files[0]) upload(files[0]); }}
          accept={['image/*', 'video/*']}
          multiple={false}
          disabled={busy}
          overlayLabel="Drop a picture or video"
        >
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className={`${dropZoneCls} disabled:opacity-60`}>
            {progress !== null ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {progress !== null ? `Uploading… ${progress}%` : background ? 'Choose a different picture or video' : 'Upload a picture or video'}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = '';
            }}
          />
        </DropZone>

        <div className="flex flex-wrap items-end gap-3">
          <button
            type="button"
            className={secondaryBtnCls}
            disabled={busy || !background}
            onClick={() => void apply(() => lyricVideoApi.setBackground(project.projectId, null))}
          >
            Use the song's picture (or a plain dark background if it has none)
          </button>
          <div className="min-w-[10rem]">
            <label htmlFor="lyric-fit" className={fieldLabelCls}>Fit</label>
            <select
              id="lyric-fit"
              className={inputCls}
              value={background?.fit ?? 'auto'}
              disabled={busy || !background}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                const fit = e.target.value as BackgroundFit;
                if (background) void apply(() => lyricVideoApi.setBackground(project.projectId, background.file, fit));
              }}
            >
              {FITS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
        </div>
        {!background && (
          <p className="text-xs text-content-secondary">
            {project.song?.coverStill ? "Right now the song's picture sits behind the words." : 'Right now a plain dark background sits behind the words.'}
          </p>
        )}
      </div>

      <LineEffects project={project} save={save} onPreviewChange={redrawPreview} />
    </div>
  );
}
