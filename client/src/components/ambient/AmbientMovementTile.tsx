import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Images, Loader2, RefreshCw, Upload } from 'lucide-react';
import { AuthedImage } from '../AuthedImage';
import { ambientApi } from '../../lib/ambientApi';
import { uploadMedia } from '../../lib/mediaUpload';
import type { AmbientMovement } from '../../lib/ambientTypes';

export interface AmbientMovementTileProps {
  projectId: string;
  movement: AmbientMovement;
  index: number;
  /** A stage is rewriting movements (or a render is running): hands off. */
  locked: boolean;
  onChooseFromLibrary: () => void;
  refresh: () => void;
}

const SOURCE_LABEL: Record<NonNullable<AmbientMovement['imageSource']>, string> = {
  upload: 'Your photo',
  library: 'From library',
  generated: 'Generated',
};

const actionCls =
  'flex items-center justify-center rounded-md p-1.5 text-content-tertiary transition-colors hover:bg-white/10 hover:text-bf-cream disabled:pointer-events-none disabled:opacity-40';

/**
 * One movement's picture, and three ways to change it: your own photo, one
 * already in your library (no image quota), or a fresh generation of just
 * this one.
 */
export function AmbientMovementTile({
  projectId, movement, index, locked, onChooseFromLibrary, refresh,
}: AmbientMovementTileProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const n = index + 1;
  const disabled = locked || working;

  const uploadPhoto = async (file: File) => {
    setWorking(true);
    try {
      const uploaded = await uploadMedia(file, file.name, 'background');
      if (uploaded.kind === 'video') {
        toast.error('That’s a video — choose a photo for this movement.');
        return;
      }
      await ambientApi.setMovementImage(projectId, movement.id, { uploadPath: uploaded.file });
      refresh();
      toast.success(`Movement ${n} now uses your photo`);
    } catch (e) {
      toast.error((e as Error).message || 'Could not use that photo');
    } finally {
      setWorking(false);
    }
  };

  const regenerate = async () => {
    setWorking(true);
    try {
      await ambientApi.regenerateMovement(projectId, movement.id);
      refresh();
    } catch (e) {
      toast.error((e as Error).message || 'Could not regenerate that picture');
    } finally {
      setWorking(false);
    }
  };

  const done = movement.imageStatus === 'done';
  const statusText = done && movement.imageSource ? SOURCE_LABEL[movement.imageSource] : movement.imageStatus;

  return (
    <div className="space-y-1 overflow-hidden rounded-lg border border-white/10 bg-black/20">
      <div className="relative flex aspect-video items-center justify-center bg-black/30">
        {movement.imageUrl ? (
          <AuthedImage src={movement.imageUrl} alt={`Movement ${n}`} className="h-full w-full object-cover" openOnClick={false} />
        ) : movement.imageStatus === 'generating' || working ? (
          <Loader2 size={18} className="animate-spin text-content-tertiary" />
        ) : (
          <span className="text-[11px] text-content-tertiary">No image</span>
        )}
      </div>

      <div className="flex items-center justify-between gap-1 px-1.5 pb-1 text-[10px]">
        <span className="text-content-tertiary">Movement {n}</span>
        <span
          className={done ? 'text-emerald-300' : movement.imageStatus === 'error' ? 'text-red-300' : 'text-content-tertiary'}
          title={movement.imageError || undefined}
        >
          {statusText}
        </span>
      </div>

      <div className="flex items-center justify-end gap-0.5 px-1 pb-1">
        <button type="button" aria-label={`Upload photo for movement ${n}`} title="Use your own photo"
          disabled={disabled} onClick={() => inputRef.current?.click()} className={actionCls}>
          <Upload size={14} />
        </button>
        <button type="button" aria-label={`Choose from library for movement ${n}`} title="Pick from your pictures — uses no image quota"
          disabled={disabled} onClick={onChooseFromLibrary} className={actionCls}>
          <Images size={14} />
        </button>
        <button type="button" aria-label={`Regenerate movement ${n}`} title="Generate a new picture for just this movement"
          disabled={disabled} onClick={regenerate} className={actionCls}>
          <RefreshCw size={14} />
        </button>
        {/* JPEG/PNG/WebP only: iOS then hands over a JPEG instead of a HEIC,
            which prod's ffmpeg cannot decode. */}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label={`Photo file for movement ${n}`}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ''; }}
        />
      </div>
    </div>
  );
}
