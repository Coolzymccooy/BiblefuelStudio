interface PublishSwitchProps {
  /** Unique per key: ties the label and helper text to this switch. */
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

/** Consent to let one key post to the user's connected accounts. */
export function PublishSwitch({ id, checked, disabled = false, onChange }: PublishSwitchProps) {
  const labelId = `${id}-label`;
  const helpId = `${id}-help`;
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={helpId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-accent disabled:cursor-wait disabled:opacity-60 ${
          checked ? 'border-transparent bg-accent-fill' : 'border-editor-line bg-editor-panel'
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-4 w-4 rounded-full transition-transform duration-150 motion-reduce:transition-none ${
            checked ? 'translate-x-5 bg-accent-ink' : 'translate-x-1 bg-editor-dim'
          }`}
        />
      </button>
      <div className="min-w-0">
        <span id={labelId} className="text-sm text-bf-cream">This key may publish</span>
        <p id={helpId} className="text-help">The agent will post to your connected accounts as you.</p>
      </div>
    </div>
  );
}
