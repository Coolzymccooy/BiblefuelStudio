import { useState } from 'react';
import { ChevronRight, Download, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../ui/Button';
import { downloadActivityCsv, listAgentActivity, type ActivityEntry } from '../../lib/agentKeysApi';
import { timeAgo } from '../../lib/timeAgo';

const RECENT_LIMIT = 50;

const KEY_EVENT_TEXT: Record<string, string> = {
  'key:created': 'Key created',
  'key:revoked': 'Key revoked',
  'key:publish_on': 'Publishing allowed',
  'key:publish_off': 'Publishing forbidden',
  'key:caps_changed': 'Limits changed',
};

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface AgentActivityProps {
  /** Names for key ids, so a key event (which carries no name) still shows one. */
  keyNames: Readonly<Record<string, string>>;
}

/** Disclosure that loads the last 50 agent calls and key changes when opened, plus a CSV export. */
export function AgentActivity({ keyNames }: AgentActivityProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<readonly ActivityEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await listAgentActivity({ limit: RECENT_LIMIT }));
    } catch (err) {
      const message = (err as Error).message || 'Could not load agent activity';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && entries === null) void load();
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      saveBlob(await downloadActivityCsv(), 'agent-activity.csv');
    } catch (err) {
      toast.error((err as Error).message || 'Could not export the activity log');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="agent-activity-panel"
          className="flex items-center gap-1.5 rounded-lg text-sm font-semibold text-bf-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-accent"
        >
          <ChevronRight
            size={16}
            aria-hidden="true"
            className={`transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
          />
          Recent activity
        </button>
        <Button type="button" variant="secondary" className="h-8 px-3 text-xs" isLoading={exporting} onClick={exportCsv}>
          <Download size={14} aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      {open && (
        <div id="agent-activity-panel" className="mt-3">
          {loading && (
            <p className="flex items-center gap-2 text-help">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading…
            </p>
          )}
          {error && !loading && (
            <div role="alert" className="space-y-2">
              <p className="text-sm text-bf-danger">
                {error}
              </p>
              <Button type="button" variant="secondary" className="h-8 px-3 text-xs" onClick={() => void load()}>Try again</Button>
            </div>
          )}
          {entries && !loading && !error && entries.length === 0 && (
            <p className="text-help">No agent activity yet. Calls and key changes appear here.</p>
          )}
          {entries && !loading && entries.length > 0 && (
            <ul className="divide-y divide-editor-line">
              {entries.map((entry, index) => (
                <ActivityRow key={`${entry.ts}-${index}`} entry={entry} keyNames={keyNames} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ entry, keyNames }: { entry: ActivityEntry; keyNames: Readonly<Record<string, string>> }) {
  const keyName = entry.keyName || (entry.keyId ? keyNames[entry.keyId] : '') || 'Revoked key';
  return (
    <li className="flex items-baseline justify-between gap-3 py-2 text-xs">
      <div className="min-w-0">
        <span className="text-bf-cream">{KEY_EVENT_TEXT[entry.tool] ?? entry.tool}</span>
        <span className="text-content-secondary"> · {keyName}</span>
      </div>
      <div className="flex shrink-0 items-baseline gap-2">
        {entry.ok ? (
          <span className="text-bf-success">ok</span>
        ) : (
          <span className="text-bf-danger">{entry.error || 'error'}</span>
        )}
        <span className="tabular-nums text-content-tertiary">{timeAgo(entry.ts)}</span>
      </div>
    </li>
  );
}
