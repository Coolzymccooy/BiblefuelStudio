import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Loader2, X } from 'lucide-react';
import { AuthedImage } from '../AuthedImage';
import { storyApi } from '../../lib/storyApi';
import type { LibraryImage } from '../../lib/ambientApi';
import { panelCls } from './formStyles';

export interface SceneLibraryPickerProps {
  projectId: string;
  sceneId: string;
  /** 1-based, for the heading. */
  sceneNumber: number;
  onClose: () => void;
  onChosen: () => void;
}

/**
 * Every picture on this account, generated or uploaded, to put on one scene.
 * Choosing one costs no image quota. Shown over the page, so on a phone it
 * opens where you are rather than wherever the scene list starts.
 */
export function SceneLibraryPicker({ projectId, sceneId, sceneNumber, onClose, onChosen }: SceneLibraryPickerProps) {
  const [images, setImages] = useState<LibraryImage[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    storyApi.listLibraryImages(projectId)
      .then((list) => { if (!cancelled) setImages(list); })
      .catch((e: Error) => { if (!cancelled) { setImages([]); toast.error(e.message); } });
    return () => { cancelled = true; };
  }, [projectId]);

  const choose = async (image: LibraryImage) => {
    setSaving(true);
    try {
      await storyApi.setSceneImage(projectId, sceneId, { libraryId: image.id });
      toast.success(`Scene ${sceneNumber} now uses that picture`);
      onChosen();
    } catch (e) {
      toast.error((e as Error).message || 'Could not use that picture');
    } finally {
      setSaving(false);
    }
  };

  const heading = `Choose a picture for scene ${sceneNumber}`;

  // Portalled to <body>: the page wrapper is transformed (its entry
  // animation), which would pin a fixed overlay to the wrapper instead of
  // the screen and draw the picker far down the page.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={heading}
        onClick={(e) => e.stopPropagation()}
        className={`${panelCls} w-full max-w-lg space-y-3 bg-bf-card`}
      >
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
            No pictures yet. Upload one on the scene, or generate images. Both land here for next time.
          </p>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                disabled={saving}
                onClick={() => choose(img)}
                aria-label={`${img.source === 'upload' ? 'Uploaded' : 'Generated'} picture ${i + 1}`}
                className="aspect-[9/16] overflow-hidden rounded-md border border-white/10 hover:border-bf-gold disabled:opacity-50"
              >
                <AuthedImage src={img.url} alt="" className="h-full w-full object-cover" openOnClick={false} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
