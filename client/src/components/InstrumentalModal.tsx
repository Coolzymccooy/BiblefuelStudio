import { useState } from 'react';
import { createPortal } from 'react-dom';
import { InstrumentalDialog, type InstrumentalDialogProps } from './InstrumentalDialog';

/**
 * The Remove vocals dialog over the page, which can be minimised to a small
 * progress pill while the job runs (it takes about the song's length, often
 * on the laptop). The tree is the same either way, so the dialog keeps its
 * job and polling; only the backdrop goes.
 */
export function InstrumentalModal(props: Omit<InstrumentalDialogProps, 'minimized' | 'onMinimize' | 'onRestore'>) {
  const [minimized, setMinimized] = useState(false);
  return createPortal(
    <div className={minimized ? '' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm'}>
      <div className={minimized ? '' : 'w-full max-w-lg'}>
        <InstrumentalDialog
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
