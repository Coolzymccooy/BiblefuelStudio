import { useMemo, useState, type FormEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CAP_BUCKETS, type AgentKey, type CapBucket, type Caps } from '../../lib/agentKeysApi';
import { BUCKET_LABELS, effectiveLimits, formatAmount } from './capLimits';

type Draft = Record<CapBucket, string>;

const isMoney = (bucket: CapBucket) => bucket === 'aiVideoUsd';

const toDraft = (limits: Caps): Draft =>
  Object.fromEntries(CAP_BUCKETS.map((bucket) => [bucket, String(limits[bucket])])) as Draft;

/** The typed value as a limit the server will keep: 0 to the ceiling, cents or whole counts. Null when not a number. */
function toLimit(bucket: CapBucket, raw: string, ceiling: number): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  const rounded = isMoney(bucket) ? Math.round(value * 100) / 100 : Math.floor(value);
  return Math.min(rounded, ceiling);
}

interface KeyLimitsEditorProps {
  agentKey: AgentKey;
  ceilings: Caps;
  /** Saves only the buckets that changed; throws a message safe to show. */
  onSave: (key: AgentKey, caps: Partial<Caps>) => Promise<void>;
}

/** Lower one key's daily limits. The server ceilings are the most a key can have. */
export function KeyLimitsEditor({ agentKey, ceilings, onSave }: KeyLimitsEditorProps) {
  const [open, setOpen] = useState(false);
  const current = useMemo(() => effectiveLimits(agentKey.caps, ceilings), [agentKey.caps, ceilings]);
  const signature = CAP_BUCKETS.map((bucket) => current[bucket]).join('|');
  const [draft, setDraft] = useState<Draft>(() => toDraft(current));
  const [shownFor, setShownFor] = useState(signature);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  // After a save (or a reload) show the limits the server actually kept.
  if (shownFor !== signature) {
    setShownFor(signature);
    setDraft(toDraft(current));
  }

  const panelId = `limits-${agentKey.id}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNote('');
    const limits = {} as Caps;
    for (const bucket of CAP_BUCKETS) {
      const limit = toLimit(bucket, draft[bucket], ceilings[bucket]);
      if (limit === null) {
        setError(`${BUCKET_LABELS[bucket]}: enter a number of 0 or more.`);
        return;
      }
      limits[bucket] = limit;
    }
    setDraft(toDraft(limits));
    const changed: Partial<Caps> = {};
    for (const bucket of CAP_BUCKETS) {
      if (limits[bucket] !== current[bucket]) changed[bucket] = limits[bucket];
    }
    if (Object.keys(changed).length === 0) {
      setNote('Nothing to save.');
      return;
    }
    setSaving(true);
    try {
      await onSave(agentKey, changed);
      setNote('Limits saved.');
    } catch (err) {
      setError((err as Error).message || 'Could not save the limits');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex items-center gap-1.5 rounded-lg text-xs font-semibold text-bf-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-accent"
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={`transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
        />
        Daily limits
      </button>

      {open && (
        // noValidate: out-of-range values are clamped to the ceiling on save,
        // rather than the browser blocking the form with its own message.
        <form id={panelId} noValidate onSubmit={submit} aria-label={`Daily limits for ${agentKey.name}`} className="mt-3 space-y-3">
          <p className="text-help">Lower a limit for this key. The most each can be is the server's ceiling.</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {CAP_BUCKETS.map((bucket) => {
              const inputId = `${panelId}-${bucket}`;
              const hintId = `${inputId}-max`;
              return (
                <div key={bucket} className="min-w-0 space-y-1">
                  <label htmlFor={inputId} className="block text-xs text-bf-muted">{BUCKET_LABELS[bucket]}</label>
                  <Input
                    id={inputId}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={ceilings[bucket]}
                    step={isMoney(bucket) ? 0.01 : 1}
                    value={draft[bucket]}
                    aria-describedby={hintId}
                    disabled={saving}
                    onChange={(e) => {
                      const { value } = e.target;
                      setDraft((d) => ({ ...d, [bucket]: value }));
                    }}
                    className="h-8 text-xs tabular-nums"
                  />
                  <p id={hintId} className="text-xs tabular-nums text-content-tertiary">
                    Up to {formatAmount(bucket, ceilings[bucket])}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="secondary" className="h-8 px-3 text-xs" isLoading={saving}>
              Save limits
            </Button>
            {error ? (
              <p role="alert" className="text-xs text-bf-danger">{error}</p>
            ) : (
              <p role="status" className="text-xs text-content-secondary">{note}</p>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
