import { useState } from 'react';
import toast from 'react-hot-toast';
import { MicOff, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { storyApi } from '../../lib/storyApi';
import { useMusicLibrary } from '../../hooks/useMusicLibrary';
import {
  saveTrackToLibrary, deleteTrack, updateTrack, fetchCapabilities, type MusicTrack,
} from '../../lib/musicLibraryApi';

// A stored value is a ref (`library:<id>` for a bundled track, `mylib:<id>`
// for a saved upload) or, for back-compat, a bare absolute path from before
// uploads were kept in the library. Only the two ref prefixes are recognised
// here — existing bare paths must keep displaying and working untouched.
export const REF_PREFIX = /^(library|mylib):/;
export const refId = (p: string | null | undefined): string => (p && REF_PREFIX.test(p) ? p.replace(REF_PREFIX, '') : '');
export const fileBaseName = (p: string) => p.split(/[\\/]/).pop() || p;

/**
 * What every music picker does with the library, whatever its layout: look
 * tracks up, upload, keep licences and credits, forget, and remove vocals.
 */
export function useLibraryActions() {
  const { data: tracks } = useMusicLibrary();
  const { data: caps } = useQuery({ queryKey: ['music-capabilities'], queryFn: fetchCapabilities, staleTime: 5 * 60_000 });
  const qc = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);
  // The library track currently open in the make-instrumental dialog, if any.
  const [instrumentalFor, setInstrumentalFor] = useState<MusicTrack | null>(null);
  const all = tracks || [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['music-library'] });

  const trackForRef = (p: string): MusicTrack | undefined => {
    const id = refId(p);
    return id ? all.find((t) => t.id === id) : undefined;
  };

  const trackLabel = (p: string) => {
    const t = trackForRef(p);
    if (t) return t.label;
    if (REF_PREFIX.test(p)) return p.replace(REF_PREFIX, '');
    return fileBaseName(p);
  };

  // The newest instrumental made from `ref`, if any.
  const instrumentalOf = (ref: string): MusicTrack | undefined =>
    [...all].reverse().find((t) => t.derivedFrom === ref);

  const forgetTrack = async (id: string, label: string) => {
    try {
      await deleteTrack(id);
      refresh();
    } catch (e) {
      toast.error((e as Error).message || `Couldn't forget ${label}`);
    }
  };

  // Clicking the "licence?" badge is the entire control for clearing it — no
  // panel, no modal. Only shown for uploads (bundled tracks are always
  // pixabay-cleared and never badged), so this only ever targets a track the
  // operator owns.
  const clearLicence = async (id: string, label: string) => {
    try {
      await updateTrack(id, { licence: 'cleared' });
      refresh();
    } catch (e) {
      toast.error((e as Error).message || `Couldn't update the licence for ${label}`);
    }
  };

  const editCredit = async (id: string, current: string) => {
    const next = window.prompt('Credit line for the video description (e.g. "Music by Ada · Pixabay")', current);
    if (next === null) return;
    try {
      await updateTrack(id, { credit: next });
      refresh();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't save the credit");
    }
  };

  /**
   * Upload a file and keep it in the library. Resolves to the ref to store,
   * the raw path if only the library save failed, or null if the upload
   * itself failed.
   */
  const uploadFile = async (file: File): Promise<string | null> => {
    if (isUploading) return null;
    setIsUploading(true);
    try {
      const path = await storyApi.uploadAudio(file, file.name);
      // Keep it: an upload used to be a loose file attached to one project.
      // Saving it costs nothing here and makes it available to every build.
      // A failed save must not cost the operator their upload — fall back to
      // the raw path exactly as before this track ever reached the library.
      try {
        const track = await saveTrackToLibrary(path, { label: file.name.replace(/\.[^.]+$/, '') });
        refresh();
        toast.success('Music added');
        return track.ref;
      } catch {
        // A silent failure here is the dangerous case: the operator would not
        // know the track won't show up anywhere else. The upload is still
        // usable in THIS project, so this is a warning, not an error.
        toast('Music added to this project, but saving it to your library failed — it won’t show up in other projects.', { icon: '⚠️', duration: 8000 });
        return path;
      }
    } catch (e) {
      toast.error((e as Error).message || 'Music upload failed');
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  /** Remove vocals is offered on your own uploads only: bundled tracks are already instrumental. */
  const canRemoveVocals = (t: MusicTrack | undefined) => Boolean(caps?.vocalRemoval && t?.source === 'upload' && !t.derivedFrom);

  // A loose file (uploaded straight onto a Timeline lane, never saved to the
  // library) has no track id to separate. Save it first — the server dedupes
  // by file, so this never duplicates — then hand back the saved track.
  const saveLoose = async (p: string): Promise<MusicTrack | null> => {
    try {
      const saved = await saveTrackToLibrary(p, { label: fileBaseName(p).replace(/\.[^.]+$/, '') });
      refresh();
      return saved;
    } catch (e) {
      toast.error((e as Error).message || "Couldn't save that file to your library");
      return null;
    }
  };

  /** Licence badge, credit, remove vocals and forget, for a library row. */
  const manageControls = (t: MusicTrack) => (
    <>
      {t.source === 'upload' && t.licence === 'unknown' && (
        <button
          type="button"
          onClick={() => clearLicence(t.id, t.label)}
          title="This track's licence is not recorded. Click to mark it cleared. On a long music-led video a Content ID claim takes the revenue for the whole video."
          className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 hover:bg-amber-500/20"
        >
          licence?
        </button>
      )}
      {t.source === 'upload' && (
        <button
          type="button"
          onClick={() => editCredit(t.id, t.credit || '')}
          title={t.credit ? `Credit: ${t.credit}` : 'Add a credit line for the video description'}
          className="shrink-0 rounded border border-[rgba(216,184,120,0.3)] px-1 text-[10px] text-bf-sub hover:border-bf-gold"
        >
          {t.credit ? 'credit ✓' : 'credit'}
        </button>
      )}
      {canRemoveVocals(t) && (
        <button
          type="button"
          onClick={() => setInstrumentalFor(t)}
          aria-label={`Remove vocals from ${t.label}`}
          title="Make an instrumental version of this track (removes the singing)"
          className="inline-flex shrink-0 items-center gap-1 rounded border border-bf-gold/40 px-1.5 py-0.5 text-[10px] text-bf-gold hover:bg-bf-card2"
        >
          <MicOff size={10} /> Remove vocals
        </button>
      )}
      {t.source === 'upload' && (
        <button
          type="button"
          aria-label={`Forget ${t.label}`}
          title="Remove from your library. The uploaded file itself is kept."
          onClick={() => forgetTrack(t.id, t.label)}
          className="shrink-0 text-bf-faint hover:text-bf-danger"
        >
          <X size={12} />
        </button>
      )}
    </>
  );

  return {
    tracks: all, caps, refresh, isUploading, instrumentalFor, setInstrumentalFor,
    trackForRef, trackLabel, instrumentalOf, clearLicence, editCredit, forgetTrack,
    uploadFile, canRemoveVocals, saveLoose, manageControls,
  };
}
