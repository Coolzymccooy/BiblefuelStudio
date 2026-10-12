import type { MomentMeta } from '../../lib/momentsTypes';

export function MomentsOccasionPicker({ meta, onPick, busy }: { meta: MomentMeta; onPick: (id: string) => void; busy: boolean }) {
  return (
    <div className="space-y-3">
      <div className="field-label">What's the occasion?</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {meta.occasions.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={busy}
            onClick={() => onPick(o.id)}
            className="glass rounded-bf px-3 py-4 text-sm font-semibold text-bf-cream transition-colors hover:border-bf-goldDeep disabled:opacity-50"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
