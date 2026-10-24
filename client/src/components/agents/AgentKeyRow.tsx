import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { PublishSwitch } from './PublishSwitch';
import { KeyLimitsEditor } from './KeyLimitsEditor';
import { BUCKET_LABELS, formatAmount } from './capLimits';
import { CAP_BUCKETS, type AgentKey, type Caps } from '../../lib/agentKeysApi';
import { timeAgo } from '../../lib/timeAgo';

interface AgentKeyRowProps {
  agentKey: AgentKey;
  /** Server ceilings per bucket; the limits editor is hidden until they are known. */
  ceilings: Caps | null;
  onPublishChange: (key: AgentKey, next: boolean) => Promise<void>;
  onCapsSave: (key: AgentKey, caps: Partial<Caps>) => Promise<void>;
  onRevoke: (key: AgentKey) => void;
}

/** One key as a list row: who it is, whether it may publish, today's use and its daily limits. */
export function AgentKeyRow({ agentKey, ceilings, onPublishChange, onCapsSave, onRevoke }: AgentKeyRowProps) {
  const [saving, setSaving] = useState(false);

  const changePublish = async (next: boolean) => {
    setSaving(true);
    try {
      await onPublishChange(agentKey, next);
    } finally {
      setSaving(false);
    }
  };

  const created = timeAgo(agentKey.createdAt);
  const lastUsed = timeAgo(agentKey.lastUsedAt ?? '');

  return (
    <li className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-bf-cream">{agentKey.name}</span>
            <span className="font-mono text-xs text-bf-muted">{agentKey.prefix}</span>
          </div>
          <p className="mt-0.5 text-xs tabular-nums text-content-tertiary">
            {created ? `Created ${created}` : 'Created'} · {lastUsed ? `Last used ${lastUsed}` : 'Never used'}
          </p>
        </div>
        <Button
          type="button"
          variant="danger"
          className="h-8 shrink-0 px-3 text-xs"
          aria-label={`Revoke ${agentKey.name}`}
          onClick={() => onRevoke(agentKey)}
        >
          <Trash2 size={14} aria-hidden="true" />
          Revoke
        </Button>
      </div>

      <PublishSwitch
        id={`publish-${agentKey.id}`}
        checked={agentKey.publishAllowed}
        disabled={saving}
        onChange={changePublish}
      />

      <dl aria-label={`Today's use for ${agentKey.name}`} className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {CAP_BUCKETS.map((bucket) => {
          const usage = agentKey.usage?.[bucket];
          return (
            <div key={bucket} className="min-w-0">
              <dt className="text-bf-muted">{BUCKET_LABELS[bucket]}</dt>
              <dd className="tabular-nums text-bf-cream">
                {usage ? `${formatAmount(bucket, usage.used)} / ${formatAmount(bucket, usage.limit)}` : 'Not available'}
              </dd>
            </div>
          );
        })}
      </dl>

      {ceilings && <KeyLimitsEditor agentKey={agentKey} ceilings={ceilings} onSave={onCapsSave} />}
    </li>
  );
}
