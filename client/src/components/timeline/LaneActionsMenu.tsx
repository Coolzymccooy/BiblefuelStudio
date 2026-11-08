import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactNode, type MouseEventHandler } from 'react';

interface LaneActionsMenuProps {
  phone: boolean;
  label: string;
  icon: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/** Touch disclosure; desktop retains the always-visible inline lane actions. */
export function LaneActionsMenu({ phone, label, icon, open, onOpenChange, children }: LaneActionsMenuProps) {
  const change = useRef(onOpenChange);
  useEffect(() => { change.current = onOpenChange; }, [onOpenChange]);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [keyboard, setKeyboard] = useState(false);
  const [activity, setActivity] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    setFading(false);
    if (!phone || !open || keyboard) return;
    const fade = window.setTimeout(() => setFading(true), 3000);
    const close = window.setTimeout(() => change.current(false), 3200);
    return () => { window.clearTimeout(fade); window.clearTimeout(close); };
  }, [phone, open, keyboard, activity]);

  useEffect(() => {
    if (!phone || !open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) change.current(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      change.current(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [phone, open]);

  if (!phone) return <div className="contents">{children}</div>;
  return (
    <div ref={root} className="timeline-lane-menu relative"
      onKeyDownCapture={() => { setKeyboard(true); setFading(false); }}
      onPointerDownCapture={() => { setKeyboard(false); setFading(false); setActivity(value => value + 1); }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onOpenChange(false);
      }}>
      <button ref={trigger} type="button" aria-label={`${label} lane actions`}
        aria-expanded={open} aria-controls={id}
        className="flex h-11 w-11 items-center justify-center rounded text-editor-dim"
        onClick={event => {
          setKeyboard(event.detail === 0);
          onOpenChange(!open);
        }}>{icon}<span className="sr-only">{label}</span></button>
      {open && <div id={id} role="group" aria-label={`${label} lane actions`}
        className="absolute left-0 top-full z-50 w-52 rounded-lg border border-editor-line bg-editor-panel p-1 shadow-lg"
        style={{ opacity: fading ? 0 : 1, transition: 'opacity 200ms ease', pointerEvents: fading ? 'none' : undefined }}
        >
        {Children.map(children, child => {
          if (!isValidElement<{ onClick?: MouseEventHandler<HTMLButtonElement> }>(child) || child.type !== 'button') return child;
          return cloneElement(child, { onClick: event => {
            child.props.onClick?.(event);
            onOpenChange(false);
          } });
        })}
      </div>}
    </div>
  );
}
