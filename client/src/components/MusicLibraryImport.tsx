import { useRef, useState, useSyncExternalStore } from 'react';
import { Loader2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { AUDIO_ACCEPT, AUDIO_ACCEPT_LIST } from '../lib/audioAccept';
import { storyApi } from '../lib/storyApi';
import { saveTrackToLibrary } from '../lib/musicLibraryApi';
import { useMusicLibrary } from '../hooks/useMusicLibrary';
import { IMPORT_LICENCES, planImport } from '../lib/musicImport';
import { DropZone } from './ui/DropZone';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Progress = { done: number; total: number } | null;

// The batch lives here, not in the component: 33 tracks take minutes, and
// leaving the step mid-way must neither lose sight of it nor let a second
// batch start alongside it and add every track twice.
let progress: Progress = null;
const listeners = new Set<() => void>();
const setProgress = (next: Progress) => { progress = next; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getProgress = () => progress;

// Files that went up but whose library save failed, by label. Choosing the
// track again retries only the save, instead of uploading another copy.
const uploaded = new Map<string, string>();

/** Test seam: forget any batch state between tests. */
export function _resetImportState() {
  uploaded.clear();
  setProgress(null);
}

/**
 * Add a whole folder of tracks to your library in one go, with one licence
 * for the batch. Tracks go up one at a time: a 50 MB file already takes the
 * resumable path, and 33 of them at once would only fight for the connection.
 */
export interface MusicLibraryImportProps {
  busy: boolean;
  /**
   * Given where there's a video bed to fill: offers to add the chosen tracks
   * to it as well, and receives their library refs when the batch ends. It may
   * run after the step was left, so it must not rely on the step's state.
   */
  onAdded?: (refs: string[]) => void | Promise<void>;
}

export function MusicLibraryImport({ busy, onAdded }: MusicLibraryImportProps) {
  const { data: tracks } = useMusicLibrary();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [licence, setLicence] = useState('unknown');
  const [addToBed, setAddToBed] = useState(true);
  const current = useSyncExternalStore(subscribe, getProgress);
  const running = current !== null;

  const importFiles = async (files: File[]) => {
    if (getProgress() !== null || files.length === 0) return;
    const { toAdd, skipped, matchedRefs } = planImport(files, tracks || []);
    const handOver = addToBed ? onAdded : undefined;
    const refs = [...matchedRefs];
    const failed: string[] = [];
    let added = 0;
    setProgress({ done: 0, total: toAdd.length });
    try {
      for (const [i, { file, label }] of toAdd.entries()) {
        try {
          const path = uploaded.get(label) ?? await storyApi.uploadAudio(file, file.name);
          uploaded.set(label, path);
          const track = await saveTrackToLibrary(path, { label, licence });
          uploaded.delete(label);
          if (track?.ref) refs.push(track.ref);
          added += 1;
        } catch {
          failed.push(label);
        }
        setProgress({ done: i + 1, total: toAdd.length });
      }
    } finally {
      setProgress(null);
      qc.invalidateQueries({ queryKey: ['music-library'] });
    }
    if (added > 0 || skipped.length > 0) {
      const already = skipped.length ? `, ${skipped.length} already in your library` : '';
      toast.success(`${plural(added, 'track')} added${already}`);
    }
    if (handOver && refs.length) {
      try {
        await handOver(refs);
      } catch (e) {
        toast.error((e as Error).message || "The tracks are in your library, but adding them to this video failed. Add them from the library.");
      }
    }
    if (failed.length) toast.error(`Couldn't add ${plural(failed.length, 'track')}: ${failed.join(', ')}. Choose them again to retry.`, { duration: 10000 });
  };

  return (
    <DropZone
      className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-gray-300"
      onFiles={(files) => importFiles(Array.from(files))}
      accept={AUDIO_ACCEPT_LIST}
      multiple
      disabled={busy || running}
      overlayLabel="Drop tracks to add them to your library"
    >
      <div className="font-medium">Add tracks to your library</div>
      <p className="text-content-tertiary">
        Choose or drop several at once. They are saved to your library for every video; tracks already there are skipped.
      </p>
      <label className="flex flex-wrap items-center gap-2">
        <span>Licence</span>
        <select
          aria-label="Licence for these tracks"
          value={licence}
          disabled={busy || running}
          onChange={(e) => setLicence(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-transparent px-2 py-1 text-white"
        >
          {IMPORT_LICENCES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </label>
      {onAdded && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={addToBed}
            disabled={busy || running}
            onChange={(e) => setAddToBed(e.target.checked)}
          />
          Add them to this video's music bed as well
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || running}
          onClick={() => inputRef.current?.click()}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1 hover:border-primary-400 disabled:opacity-50"
        >
          <Upload size={12} /> Choose tracks
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={AUDIO_ACCEPT}
          aria-label="Choose tracks to add"
          className="hidden"
          onChange={(e) => { const picked = Array.from(e.target.files || []); e.target.value = ''; importFiles(picked); }}
        />
        {current && (
          <span role="status" className="inline-flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            Adding {Math.min(current.done + 1, current.total)} of {current.total}…
          </span>
        )}
      </div>
    </DropZone>
  );
}
