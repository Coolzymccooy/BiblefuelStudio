import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Loader2, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { AgentKeyRow } from './agents/AgentKeyRow';
import { AgentActivity } from './agents/AgentActivity';
import { ConnectSnippets } from './agents/ConnectSnippets';
import { CreateKeyModal } from './agents/CreateKeyModal';
import { listAgentKeys, revokeAgentKey, updateAgentKey, type AgentKey } from '../lib/agentKeysApi';

/**
 * Settings card for MCP agent access: create and revoke the keys an agent
 * signs in with, allow or forbid publishing per key, watch each key's daily
 * cap use, copy connection snippets and review what agents did.
 */
export function ConnectedAgentsCard() {
  const [keys, setKeys] = useState<readonly AgentKey[]>([]);
  const [endpoint, setEndpoint] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const mounted = useRef(true);

  // `quiet` refreshes the list behind the page without a loading state or an inline error.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const list = await listAgentKeys();
      if (!mounted.current) return;
      setKeys(list.keys);
      setEndpoint(list.endpoint);
    } catch (err) {
      if (!mounted.current) return;
      const message = (err as Error).message || 'Could not load your agent keys';
      if (!quiet) setLoadError(message);
      toast.error(message);
    } finally {
      if (mounted.current && !quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  const patchKey = (id: string, patch: Partial<AgentKey>) =>
    setKeys((current) => current.map((k) => (k.id === id ? { ...k, ...patch } : k)));

  // Flip the switch at once, put it back (and say why) if the server refuses.
  const changePublish = async (key: AgentKey, next: boolean) => {
    patchKey(key.id, { publishAllowed: next });
    try {
      const saved = await updateAgentKey(key.id, { publishAllowed: next });
      patchKey(key.id, saved);
    } catch (err) {
      patchKey(key.id, { publishAllowed: key.publishAllowed });
      toast.error((err as Error).message || 'Could not save the change');
    }
  };

  const revoke = async (key: AgentKey) => {
    if (!confirm(`Revoke "${key.name}"? Agents using it stop working immediately.`)) return;
    try {
      await revokeAgentKey(key.id);
      setKeys((current) => current.filter((k) => k.id !== key.id));
      toast.success('Key revoked');
    } catch (err) {
      toast.error((err as Error).message || 'Could not revoke the key');
    }
  };

  const keyNames = useMemo(() => Object.fromEntries(keys.map((k) => [k.id, k.name])), [keys]);

  return (
    <>
      <Card
        title="Connected agents"
        icon={Bot}
        headerExtra={
          <Button type="button" className="h-8 px-3 text-xs" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" />
            Create key
          </Button>
        }
      >
        <p className="mb-4 text-help">
          Let an AI agent such as Hermes, Codex or Claude Code use BibleFuel as you. Each agent gets its own key, with daily limits
          and a switch for publishing.
        </p>

        {loading ? (
          <p className="flex items-center gap-2 py-4 text-help">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading…
          </p>
        ) : loadError ? (
          <div role="alert" className="space-y-2 py-2">
            <p className="text-sm text-bf-danger">{loadError}</p>
            <Button type="button" variant="secondary" className="h-8 px-3 text-xs" onClick={() => void load()}>Try again</Button>
          </div>
        ) : keys.length === 0 ? (
          <div className="rounded-lg border border-dashed border-editor-line p-4">
            <p className="text-sm font-semibold text-bf-cream">No keys yet</p>
            <p className="mt-1 text-help">
              A key is a password for one agent. Create one, give it to your agent, and revoke it any time. See Help → Connect an agent
              for the steps.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-editor-line">
            {keys.map((key) => (
              <AgentKeyRow key={key.id} agentKey={key} onPublishChange={changePublish} onRevoke={revoke} />
            ))}
          </ul>
        )}

        {endpoint && (
          <div className="mt-6 border-t border-editor-line pt-4">
            <ConnectSnippets endpoint={endpoint} />
          </div>
        )}

        <div className="mt-6 border-t border-editor-line pt-4">
          <AgentActivity keyNames={keyNames} />
        </div>
      </Card>

      {creating && (
        <CreateKeyModal
          onClose={() => setCreating(false)}
          onCreated={() => void load(true)}
        />
      )}
    </>
  );
}
