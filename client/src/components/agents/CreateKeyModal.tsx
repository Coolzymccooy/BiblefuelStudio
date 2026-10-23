import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CopyButton } from './CopyButton';
import { createAgentKey, type AgentKey } from '../../lib/agentKeysApi';

const NAME_MAX = 60;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

interface CreateKeyModalProps {
  onClose: () => void;
  /** The key was created (without its secret). The plain key stays inside this modal. */
  onCreated: (key: AgentKey) => void;
}

/**
 * Names a new key, then shows the plain key once. The plain key lives only in
 * this component's state, so closing the modal removes it from the page.
 */
export function CreateKeyModal({ onClose, onCreated }: CreateKeyModalProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [plain, setPlain] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Take focus on open and hand it back to whatever opened the modal on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector('input')?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const input = dialogRef.current?.querySelector('input');
    if (plain && input) {
      input.focus();
      input.select();
    }
  }, [plain]);

  const trimmed = name.trim();
  const nameOk = trimmed.length >= 1 && trimmed.length <= NAME_MAX;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!nameOk || busy) return;
    setBusy(true);
    try {
      const created = await createAgentKey(trimmed);
      setPlain(created.plain);
      onCreated(created.key);
    } catch (err) {
      toast.error((err as Error).message || 'Could not create the key');
    } finally {
      setBusy(false);
    }
  };

  // Escape closes; Tab stays inside the dialog.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      // Closing mid-request would lose the plain key of a key the server is about to create.
      if (!busy) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-key-title"
        onKeyDown={onKeyDown}
        className="w-full max-w-md space-y-4 rounded-card border border-editor-line bg-bf-card p-5"
      >
        <h3 id="create-key-title" className="text-lg font-semibold text-bf-cream">
          {plain ? 'Your new key' : 'Create an agent key'}
        </h3>

        {plain ? (
          <div className="space-y-3">
            <Input
              readOnly
              aria-label="Your new key"
              value={plain}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <p className="text-help">Copy it now. It will not be shown again.</p>
            <div className="flex items-center justify-between gap-2">
              <CopyButton text={plain} label="Copy new key" />
              <Button type="button" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="create-key-name" className="block text-sm text-bf-cream">Key name</label>
              <Input
                id="create-key-name"
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                placeholder="For example, Hermes on my laptop"
              />
              <p className="text-help">Pick a name that tells you which agent uses this key.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="submit" isLoading={busy} disabled={!nameOk}>Create</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
