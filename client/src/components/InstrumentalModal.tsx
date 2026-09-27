import { useState } from 'react';
import { createPortal } from 'react-dom';
import { InstrumentalDialog, type InstrumentalDialogProps } from './InstrumentalDialog';

/**
 * The Remove vocals dialog over the page, which can be minimised to a small
 * progress pill while the job runs (it takes about the song's length, often
 * on the laptop). The tree is the same either way, so the dialog keeps its
 * job and polling; only the backdrop goes.
 *
 * While minimised the page is usable, so Remove vocals can be chosen for
 * another song: that song gets a fresh dialog (keyed by its id), never the
 * earlier job relabelled. The earlier job still finishes and saves itself.
 */
export function InstrumentalModal(props: Omit<InstrumentalDialogProps, 'minimized' | 'onMinimize' | 'onRestore'>) {
  const [minimized, setMinimized] = useState(false);
  const [shownFor, setShownFor] = useState(props.track.id);
  if (shownFor !== props.track.id) {
    // Adjusting state while rendering, as React recommends over an effect.
    setShownFor(props.track.id);
    setMinimized(false);
  }
  return createPortal(
    <div className={minimized ? '' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm'}>
      <div className={minimized ? '' : 'w-full max-w-lg'}>
        <InstrumentalDialog
          key={props.track.id}
          {...props}
          minimized={minimized}
          onMinimize={() => setMinimized(true)}
          onRestore={() => setMinimized(false)}
        />
      </div>
    </div>,
    document.body,
  );
}
