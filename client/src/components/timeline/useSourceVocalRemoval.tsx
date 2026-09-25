import { useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { InstrumentalDialog } from '../InstrumentalDialog';
import { useLibraryActions } from '../music/useLibraryActions';
import type { MusicTrack } from '../../lib/musicLibraryApi';

/**
 * "Remove vocals" for a song loaded in the Timeline's Source media panel.
 * The Music tool already offered it; a song uploaded as source media never
 * reached the library, so it had no way in. The file is saved to the library
 * first (the server dedupes, so this never duplicates), then separated with
 * the same dialog, and the instrumental takes the original's place on the
 * Music bed.
 */
export function useSourceVocalRemoval({ onUse }: {
  /** The instrumental's ref, and the refs/paths of the original it replaces. */
  onUse: (instrumentalRef: string, replaces: string[]) => void;
}) {
  const lib = useLibraryActions();
  const [open, setOpen] = useState<{ track: MusicTrack; path: string } | null>(null);
  const available = Boolean(lib.caps?.vocalRemoval);

  const start = async (path: string) => {
    if (!available || !path) return;
    const saved = await lib.saveLoose(path);
    if (saved) setOpen({ track: saved, path });
  };

  const dialog = open ? createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg">
        <InstrumentalDialog
          track={open.track}
          onClose={() => setOpen(null)}
          onSaved={lib.refresh}
          onUse={(inst) => {
            onUse(inst.ref, [open.track.ref, open.path]);
            toast.success('The instrumental is on the Music bed');
            setOpen(null);
          }}
        />
      </div>
    </div>,
    document.body,
  ) : null;

  return { available, start, dialog };
}
