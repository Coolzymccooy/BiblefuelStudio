import { useEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

interface SoundtrackTwiceDialogProps {
  onKeepOut: () => void;
  onAddAnyway: () => void;
}

const btn = 'rounded-lg border px-3 py-1.5 text-sm font-semibold transition';

/**
 * The song being added as music looks like the story's own soundtrack, which
 * already plays under the whole story. Asks before it plays twice, out of
 * step. Keeping it out is the default: it takes focus, and Escape means it.
 * Mounted only while asking; focus goes back to what opened it.
 */
export function SoundtrackTwiceDialog({ onKeepOut, onAddAnyway }: SoundtrackTwiceDialogProps) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    keepRef.current?.focus();
    return () => { opener?.focus?.(); };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); onKeepOut(); return; }
    if (e.key !== 'Tab') return;
    // Two buttons: Tab cycles between them, never out of the dialog.
    e.preventDefault();
    (document.activeElement === keepRef.current ? addRef : keepRef).current?.focus();
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onKeyDown={onKeyDown}>
      <div aria-hidden="true" onClick={onKeepOut} className="absolute inset-0 bg-black/50" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Same song as your soundtrack"
        aria-describedby="soundtrack-twice-text"
        className="relative w-full max-w-sm rounded-2xl border border-[rgba(216,184,120,0.3)] bg-bf-bg p-5 shadow-2xl"
      >
        <p id="soundtrack-twice-text" className="text-sm text-bf-cream">
          This looks like your soundtrack — it already plays under the story. Adding it again plays the song twice, out of step. Add it anyway?
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button ref={addRef} type="button" onClick={onAddAnyway} className={`${btn} border-[rgba(216,184,120,0.3)] text-bf-sub hover:border-bf-gold hover:text-bf-cream`}>Add anyway</button>
          <button ref={keepRef} type="button" onClick={onKeepOut} className={`${btn} border-transparent bg-primary-500 text-dark-900 hover:bg-primary-400`}>Keep it out</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
