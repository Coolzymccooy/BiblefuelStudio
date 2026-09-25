import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, X } from 'lucide-react';
import { AuthedImage } from '../AuthedImage';
import { ambientApi, type LibraryImage } from '../../lib/ambientApi';
import { panelCls } from '../story/formStyles';

export interface AmbientLibraryPickerProps {
  projectId: string;
  movementId: string;
  /** 1-based, for the heading. */
  movementNumber: number;
  onClose: () => void;
  onChosen: () => void;
}

/**
 * Every picture on this account — generated or uploaded — to put on one
 * movement. Choosing one costs no image quota.
 */
export function AmbientLibraryPicker({ projectId, movementId, movementNumber, onClose, onChosen }: AmbientLibraryPickerProps) {
  const [images, setImages] = useState<LibraryImage[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ambientApi.listLibraryImages(projectId)
      .then((list) => { if (!cancelled) setImages(list); })
      .catch((e: Error) => { if (!cancelled) { setImages([]); toast.error(e.message); } });
    return () => { cancelled = true; };
  }, [projectId]);

  const choose = async (image: LibraryImage) => {
    setSaving(true);
    try {
      await ambientApi.setMovementImage(projectId, movementId, { libraryId: image.id });
      onChosen();
    } catch (e) {
      toast.error((e as Error).message || 'Could not use that picture');
    } finally {
      setSaving(false);
    }
  };

  const heading = `Choose a picture for movement ${movementNumber}`;

  return (
    <div role="dialog" aria-label={heading} className={`${panelCls} space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-bf-cream">{heading}</div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-content-tertiary hover:text-bf-cream">
          <X size={16} />
        </button>
      </div>

      {images === null ? (
        <Loader2 size={18} className="animate-spin text-content-tertiary" />
      ) : images.length === 0 ? (
        <p className="text-sm text-content-tertiary">
          No pictures yet. Upload a photo on the movement, or generate images — both land here for next time.
        </p>
      ) : (
        <div className="grid max-h-[360px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              disabled={saving}
              onClick={() => choose(img)}
              aria-label={`${img.source === 'upload' ? 'Uploaded' : 'Generated'} picture ${i + 1}`}
              className="aspect-video overflow-hidden rounded-md border border-white/10 hover:border-bf-gold disabled:opacity-50"
            >
              <AuthedImage src={img.url} alt="" className="h-full w-full object-cover" openOnClick={false} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
