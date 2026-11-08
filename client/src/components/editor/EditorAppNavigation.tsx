import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Home, X, type LucideIcon } from 'lucide-react';

/** Native modal supplies focus containment, Escape and focus restoration.
 * Reuses Layout's permission-filtered destinations, not a second route list. */
export function EditorAppNavigation({ items }: { items: { path: string; label: string; icon: LucideIcon }[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { dialog.current?.close(); trigger.current?.focus(); };
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const changed = () => { if (mq.matches) dialog.current?.close(); };
    mq.addEventListener('change', changed);
    return () => mq.removeEventListener('change', changed);
  }, []);
  return <>
    <button ref={trigger} type="button" aria-label="Home and app navigation" aria-haspopup="dialog" aria-controls="editor-app-navigation"
      onClick={() => dialog.current?.showModal()}
      className="lg:hidden fixed right-1 top-[max(2px,env(safe-area-inset-top))] z-40 grid h-[44px] w-[44px] place-items-center rounded-xl border border-editor-line bg-editor-panel text-editor-accent shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-editor-accent">
      <Home size={20} aria-hidden="true" />
    </button>
    <dialog ref={dialog} id="editor-app-navigation" aria-labelledby="editor-app-navigation-title"
      onKeyDown={e => {
        if (e.key !== 'Tab') return;
        const targets = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
        const first = targets[0], last = targets[targets.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }}
      onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } }}
      className="lg:hidden fixed left-auto right-2 top-[max(52px,env(safe-area-inset-top))] m-0 max-h-[calc(100dvh_-_64px_-_env(safe-area-inset-bottom))] w-[min(320px,calc(100vw-16px))] overflow-y-auto rounded-2xl border border-editor-line bg-editor-panel p-3 text-editor-text shadow-2xl backdrop:bg-black/50">
      <div className="flex items-center justify-between gap-2">
        <h2 id="editor-app-navigation-title" className="text-sm font-semibold">App navigation</h2>
        <button type="button" onClick={close} aria-label="Close app navigation" className="grid h-[44px] w-[44px] place-items-center rounded-lg hover:bg-editor-hover"><X size={20} /></button>
      </div>
      <nav aria-label="Editor app destinations" className="grid grid-cols-2 gap-1">
        {items.map(({ path, label, icon: Icon }) => <Link key={path} to={path} onClick={close} className="flex min-h-[44px] items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-editor-hover focus-visible:bg-editor-hover"><Icon size={17} aria-hidden="true" />{label}</Link>)}
      </nav>
    </dialog>
  </>;
}
