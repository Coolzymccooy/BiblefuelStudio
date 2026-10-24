import { api } from './api';
import type { ActivityEntry } from './agentKeysApi';

/**
 * Client for GET /api/admin/agent-activity: every agent call across all
 * users, for the Admin "Agent activity" tab (super-admins only).
 */

const BASE = '/api/admin/agent-activity';
const DAY_MS = 24 * 60 * 60 * 1000;
/** The server's default window: today and the six days before it. */
export const DEFAULT_RANGE_DAYS = 7;
export const ROW_LIMIT = 200;

export type Outcome = '' | 'true' | 'false';

export interface AdminActivityFilters {
  /** Inclusive UTC days, "YYYY-MM-DD". */
  from: string;
  to: string;
  userId: string;
  tool: string;
  /** '' for every call, 'true' for calls that worked, 'false' for failures. */
  ok: Outcome;
}

export interface CallCount {
  calls: number;
  errors: number;
}

export interface AdminActivity {
  rows: ActivityEntry[];
  counts: { byTool: Record<string, CallCount>; byUser: Record<string, CallCount> };
  total: number;
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Filters for the last seven UTC days, nothing else narrowed. */
export function defaultFilters(now: number = Date.now()): AdminActivityFilters {
  return { from: utcDay(now - (DEFAULT_RANGE_DAYS - 1) * DAY_MS), to: utcDay(now), userId: '', tool: '', ok: '' };
}

function query(filters: AdminActivityFilters, extra: Record<string, string>): string {
  const search = new URLSearchParams();
  if (filters.from) search.set('from', filters.from);
  if (filters.to) search.set('to', filters.to);
  if (filters.userId) search.set('userId', filters.userId);
  if (filters.tool) search.set('tool', filters.tool);
  if (filters.ok) search.set('ok', filters.ok);
  for (const [name, value] of Object.entries(extra)) search.set(name, value);
  return `?${search.toString()}`;
}

/** Path of the CSV export for these filters. A plain link cannot carry the sign-in token: use downloadAdminActivityCsv. */
export function adminActivityCsvUrl(filters: AdminActivityFilters): string {
  return `${BASE}${query(filters, { format: 'csv' })}`;
}

export async function fetchAdminActivity(filters: AdminActivityFilters): Promise<AdminActivity> {
  const res = await api.get<AdminActivity & { hint?: string }>(`${BASE}${query(filters, { limit: String(ROW_LIMIT) })}`);
  if (!res.ok || !res.data) {
    const hint = (res.data as { hint?: unknown } | undefined)?.hint;
    throw new Error((typeof hint === 'string' && hint) || res.error || 'Could not load agent activity');
  }
  const { rows, counts, total } = res.data;
  return {
    rows: Array.isArray(rows) ? rows : [],
    counts: { byTool: counts?.byTool || {}, byUser: counts?.byUser || {} },
    total: typeof total === 'number' ? total : 0,
  };
}

/** Fetches the CSV with the bearer token and hands back the file for the browser to save. */
export async function downloadAdminActivityCsv(filters: AdminActivityFilters): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = api.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${api.baseUrl}${adminActivityCsvUrl(filters)}`, { headers });
  if (!res.ok) throw new Error(`Could not export the activity log (HTTP ${res.status})`);
  return res.blob();
}
