import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';
import { Star, X, ChevronLeft, ChevronRight, ImagePlus, Loader2 } from 'lucide-react';
import { momentsApi } from '../../lib/momentsApi';
import { uploadMedia } from '../../lib/mediaUpload';
import { api } from '../../lib/api';
import { isApiError } from '../../lib/apiError';
import { toastError } from '../../lib/errors';
import { movePhoto, removePhoto } from '../../lib/momentsWizard';
import type { MomentPatch, MomentPhoto, PhotoRef } from '../../lib/momentsTypes';
import type { MomentStepProps } from '../../pages/MomentsPage';
import { DropZone } from '../ui/DropZone';
import { dropZoneCls, secondaryBtnCls } from '../story/formStyles';

// Photos only: iOS converts HEIC to JPEG for these types, and the server refuses anything else.
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const refs = (photos: MomentPhoto[]): PhotoRef[] => photos.map((p) => p.ref);

/** Name the file in an upload failure; keep coded API errors (e.g. quota) intact so they render as designed. */
const uploadFailure = (e: unknown, name: string) =>
  isApiError(e) ? e : new Error(`${name}: ${e instanceof Error ? e.message : 'Upload failed'}`);

export function MomentsPhotosStep({ project, meta, refresh, busy, setBusy }: MomentStepProps) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const { data: library = [] } = useQuery({ queryKey: ['moments-library'], queryFn: () => momentsApi.libraryImages(), enabled: showLibrary });
  const { photos, heroIndex } = project;
  const room = meta.limits.maxPhotos - photos.length;

  /** Send one change; a refusal is toasted and reported as false so callers can carry on. */
  const persist = async (patch: MomentPatch): Promise<boolean> => {
    try {
      await momentsApi.update(project.projectId, patch);
      return true;
    } catch (e) {
      toastError(e);
      return false;
    }
  };

  const save = async (patch: MomentPatch) => {
    setBusy(true);
    try {
      if (await persist(patch)) refresh();
    } finally {
      setBusy(false);
    }
  };

  const addFiles = async (files: File[]) => {
    const list = files.slice(0, Math.max(0, room));
    if (files.length > list.length && room > 0) toast(`Only room for ${room} more photo${room === 1 ? '' : 's'} (max ${meta.limits.maxPhotos}).`);
    if (!list.length) return;
    setUploading(true);
    setBusy(true);
    let current = refs(photos);
    const toastId = toast.loading(`Uploading 1 of ${list.length}…`);
    try {
      for (let i = 0; i < list.length; i += 1) {
        toast.loading(`Uploading ${i + 1} of ${list.length}…`, { id: toastId });
        try {
          const up = await uploadMedia(list[i], list[i].name, 'background');
          // Saved one at a time so a photo the server refuses costs only itself.
          const next = [...current, { kind: 'upload', path: up.file } as PhotoRef];
          if (await persist({ photos: next, heroIndex })) {
            current = next;
            refresh();
          }
        } catch (e) {
          toastError(uploadFailure(e, list[i].name));
        }
      }
    } finally {
      toast.dismiss(toastId);
      setUploading(false);
      setBusy(false);
    }
  };

  const pickLibrary = (id: string) => save({ photos: [...refs(photos), { kind: 'library', id }], heroIndex });
  const doRemove = (i: number) => { const r = removePhoto(photos, heroIndex, i); save({ photos: refs(r.photos), heroIndex: r.heroIndex }); };
  const doMove = (from: number, to: number) => { const r = movePhoto(photos, heroIndex, from, to); save({ photos: refs(r.photos), heroIndex: r.heroIndex }); };
  const need = meta.limits.minPhotos - photos.length;

  return (
    <div className="space-y-4">
      <DropZone onFiles={addFiles} accept={PHOTO_TYPES} disabled={busy || uploading || room <= 0} overlayLabel="Drop photos">
        <button type="button" disabled={busy || uploading || room <= 0} onClick={() => input.current?.click()} className={dropZoneCls}>
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
          Add photos ({photos.length}/{meta.limits.maxPhotos})
        </button>
      </DropZone>
      <input
        ref={input}
        type="file"
        accept={PHOTO_TYPES.join(',')}
        multiple
        aria-label="Add photos"
        className="hidden"
        onChange={(e) => { if (e.target.files?.length) addFiles(Array.from(e.target.files)); e.target.value = ''; }}
      />
      <button type="button" className={secondaryBtnCls} onClick={() => setShowLibrary((v) => !v)}>
        {showLibrary ? 'Hide my pictures' : 'Pick from my pictures'}
      </button>
      {showLibrary && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {library.map((img, i) => (
            <button key={img.id} type="button" disabled={busy || uploading || room <= 0} onClick={() => pickLibrary(img.id)} aria-label={`Add library picture ${i + 1}`}>
              <img src={api.mediaUrl(img.url)} alt="" className="aspect-[9/16] w-full rounded-lg object-cover" />
            </button>
          ))}
          {!library.length && <p className="text-help col-span-full">No pictures in your library yet.</p>}
        </div>
      )}
      {room <= 0 && <p className="text-help">That is the most a Moment can hold ({meta.limits.maxPhotos} photos). Remove one to add another.</p>}
      {need > 0 && <p className="text-help">Add {need} more photo{need === 1 ? '' : 's'} to make your Moment.</p>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {photos.map((p, i) => (
          <div key={`${i}-${p.url}`} className={`relative overflow-hidden rounded-lg border ${i === heroIndex ? 'border-bf-gold' : 'border-transparent'}`}>
            <img src={api.mediaUrl(p.url)} alt={`Photo ${i + 1}`} className="aspect-[9/16] w-full object-cover" />
            <div className="absolute inset-x-0 top-0 flex justify-between p-1">
              <button type="button" disabled={busy || uploading} onClick={() => save({ heroIndex: i })} aria-label={`Make photo ${i + 1} the hero`} aria-pressed={i === heroIndex} className="rounded-full bg-black/50 p-1">
                <Star size={14} className={i === heroIndex ? 'fill-bf-gold text-bf-gold' : 'text-white'} />
              </button>
              <button type="button" disabled={busy || uploading} onClick={() => doRemove(i)} aria-label={`Remove photo ${i + 1}`} className="rounded-full bg-black/50 p-1">
                <X size={14} />
              </button>
            </div>
            <div className="absolute inset-x-0 bottom-0 flex justify-between p-1">
              <button type="button" disabled={busy || uploading || i === 0} onClick={() => doMove(i, i - 1)} aria-label={`Move photo ${i + 1} earlier`} className="rounded-full bg-black/50 p-1">
                <ChevronLeft size={14} />
              </button>
              <button type="button" disabled={busy || uploading || i === photos.length - 1} onClick={() => doMove(i, i + 1)} aria-label={`Move photo ${i + 1} later`} className="rounded-full bg-black/50 p-1">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {photos.length > 0 && <p className="text-help">The starred photo opens and closes your Moment, with the title.</p>}
    </div>
  );
}
