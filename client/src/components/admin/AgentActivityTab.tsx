import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Bot, Download, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { saveBlob } from '../../lib/saveBlob';
import {
  defaultFilters,
  downloadAdminActivityCsv,
  fetchAdminActivity,
  type AdminActivity,
  type AdminActivityFilters,
  type CallCount,
  type Outcome,
} from '../../lib/adminActivityApi';
import type { ActivityEntry } from '../../lib/agentKeysApi';

interface AgentActivityTabProps {
  /** Known accounts for the user filter; users seen in the log are added to it. */
  users: readonly { id: string; email: string }[];
  /** Bumped by the page's Refresh button to reload with the applied filters. */
  reloadToken: number;
}

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: '', label: 'All calls' },
  { value: 'true', label: 'Worked' },
  { value: 'false', label: 'Failed' },
];

/** Super-admin view of every agent call: filters, counts per tool and per user, the newest rows, CSV export. */
export function AgentActivityTab({ users, reloadToken }: AgentActivityTabProps) {
  const [draft, setDraft] = useState<AdminActivityFilters>(() => defaultFilters());
  const [applied, setApplied] = useState<AdminActivityFilters>(draft);
  const [data, setData] = useState<AdminActivity | null>(null);
  const [knownTools, setKnownTools] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (filters: AdminActivityFilters) => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchAdminActivity(filters);
      setData(next);
      setKnownTools((prev) => [...new Set([...prev, ...Object.keys(next.counts.byTool)])].sort());
    } catch (err) {
      setError((err as Error).message || 'Could not load agent activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(applied);
  }, [applied, reloadToken, load]);

  const userOptions = useMemo(() => mergeUsers(users, data?.rows ?? []), [users, data]);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    setApplied({ ...draft });
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      saveBlob(await downloadAdminActivityCsv(applied), `agent-activity-${applied.from}-to-${applied.to}.csv`);
    } catch (err) {
      toast.error((err as Error).message || 'Could not export the activity log');
    } finally {
      setExporting(false);
    }
  };

  const set = (patch: Partial<AdminActivityFilters>) => setDraft((prev) => ({ ...prev, ...patch }));

  return (
    <Card>
      <FilterForm
        draft={draft}
        set={set}
        userOptions={userOptions}
        knownTools={knownTools}
        loading={loading}
        exporting={exporting}
        onSubmit={apply}
        onExport={exportCsv}
      />
      <p className="text-help mt-2">Days are UTC. At most 31 days at a time.</p>

      <div className="mt-6">
        <ActivityBody data={data} loading={loading} error={error} onRetry={() => void load(applied)} />
      </div>
    </Card>
  );
}

interface FilterFormProps {
  draft: AdminActivityFilters;
  set: (patch: Partial<AdminActivityFilters>) => void;
  userOptions: readonly { id: string; email: string }[];
  knownTools: readonly string[];
  loading: boolean;
  exporting: boolean;
  onSubmit: (event: FormEvent) => void;
  onExport: () => void;
}

function FilterForm({ draft, set, userOptions, knownTools, loading, exporting, onSubmit, onExport }: FilterFormProps) {
  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
      <Field label="From" htmlFor="activity-from">
        <Input id="activity-from" type="date" value={draft.from} max={draft.to} onChange={(e) => set({ from: e.target.value })} />
      </Field>
      <Field label="To" htmlFor="activity-to">
        <Input id="activity-to" type="date" value={draft.to} min={draft.from} onChange={(e) => set({ to: e.target.value })} />
      </Field>
      <Field label="User" htmlFor="activity-user">
        <Select id="activity-user" value={draft.userId} onChange={(e) => set({ userId: e.target.value })}>
          <option value="">All users</option>
          {userOptions.map((u) => (
            <option key={u.id} value={u.id}>{u.email}</option>
          ))}
        </Select>
      </Field>
      <Field label="Tool" htmlFor="activity-tool">
        <Select id="activity-tool" value={draft.tool} onChange={(e) => set({ tool: e.target.value })}>
          <option value="">All tools</option>
          {knownTools.map((tool) => (
            <option key={tool} value={tool}>{tool}</option>
          ))}
        </Select>
      </Field>
      <Field label="Outcome" htmlFor="activity-outcome">
        <Select id="activity-outcome" value={draft.ok} onChange={(e) => set({ ok: e.target.value as Outcome })}>
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </Field>
      <div className="flex gap-2">
        <Button type="submit" isLoading={loading} className="h-10 px-3 text-sm">Apply filters</Button>
        <Button type="button" variant="secondary" isLoading={exporting} onClick={onExport} className="h-10 px-3 text-sm">
          <Download size={14} aria-hidden="true" />
          Export CSV
        </Button>
      </div>
    </form>
  );
}

function mergeUsers(users: readonly { id: string; email: string }[], rows: readonly ActivityEntry[]) {
  const byId = new Map(users.map((u) => [u.id, u.email]));
  for (const row of rows) {
    if (row.userId && !byId.has(row.userId)) byId.set(row.userId, row.email || row.userId);
  }
  return [...byId].map(([id, email]) => ({ id, email })).sort((a, b) => a.email.localeCompare(b.email));
}

interface ActivityBodyProps {
  data: AdminActivity | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function ActivityBody({ data, loading, error, onRetry }: ActivityBodyProps) {
  if (error && !loading) {
    return (
      <div role="alert" className="space-y-2">
        <p className="text-sm text-bf-danger">{error}</p>
        <Button type="button" variant="secondary" className="h-8 px-3 text-xs" onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-help">
        <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading agent activity…
      </p>
    );
  }
  if (data.total === 0) {
    return (
      <div className="py-12 text-center text-content-secondary">
        <Bot size={32} className="mx-auto mb-3 opacity-40" aria-hidden="true" />
        <p>No agent calls match these filters.</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <CountTable caption="Calls per tool" nameHeader="Tool" counts={data.counts.byTool} mono />
        <CountTable caption="Calls per user" nameHeader="User" counts={data.counts.byUser} />
      </div>
      <RowsTable rows={data.rows} total={data.total} />
    </div>
  );
}

const TH = 'py-2 px-2 text-left text-xs font-medium text-content-secondary';
const TD = 'py-2 px-2 align-top';

function CountTable({ caption, nameHeader, counts, mono = false }: { caption: string; nameHeader: string; counts: Record<string, CallCount>; mono?: boolean }) {
  const entries = Object.entries(counts).sort((a, b) => b[1].calls - a[1].calls || a[0].localeCompare(b[0]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label={caption}>
        <caption className="mb-2 text-left text-sm font-semibold text-bf-cream">{caption}</caption>
        <thead>
          <tr className="border-b border-editor-line">
            <th scope="col" className={TH}>{nameHeader}</th>
            <th scope="col" className={`${TH} text-right`}>Calls</th>
            <th scope="col" className={`${TH} text-right`}>Errors</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, count]) => (
            <tr key={name} className="border-b border-editor-line last:border-b-0">
              <td className={`${TD} break-all text-bf-cream ${mono ? 'font-mono text-xs' : ''}`}>{name}</td>
              <td className={`${TD} text-right tabular-nums text-bf-cream`}>{count.calls}</td>
              <td className={`${TD} text-right tabular-nums ${count.errors > 0 ? 'text-bf-danger' : 'text-content-secondary'}`}>{count.errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowsTable({ rows, total }: { rows: readonly ActivityEntry[]; total: number }) {
  return (
    <div>
      <p className="mb-2 text-help tabular-nums">Showing the newest {rows.length} of {total} calls</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Newest agent calls">
          <thead>
            <tr className="border-b border-editor-line">
              <th scope="col" className={TH}>Time (UTC)</th>
              <th scope="col" className={TH}>User</th>
              <th scope="col" className={TH}>Key</th>
              <th scope="col" className={TH}>Tool</th>
              <th scope="col" className={TH}>Outcome</th>
              <th scope="col" className={`${TH} text-right`}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.ts}-${index}`} className="border-b border-editor-line last:border-b-0">
                <td className={`${TD} whitespace-nowrap font-mono text-xs tabular-nums text-content-secondary`}>{row.ts.replace('T', ' ').slice(0, 19)}</td>
                <td className={`${TD} break-all text-bf-cream`}>{row.email || row.userId || 'Unknown'}</td>
                <td className={`${TD} text-content-secondary`}>{row.keyName || row.keyId || 'Unknown key'}</td>
                <td className={`${TD} font-mono text-xs text-bf-cream`}>{row.tool}</td>
                <td className={`${TD} break-words text-xs`}>
                  {row.ok ? <span className="text-bf-success">Worked</span> : <span className="text-bf-danger">{row.error || 'Failed'}</span>}
                </td>
                <td className={`${TD} whitespace-nowrap text-right tabular-nums text-content-secondary`}>{row.ms ?? 0} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
