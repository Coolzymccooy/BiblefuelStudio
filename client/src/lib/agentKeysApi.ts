import { api } from './api';

/**
 * Client for /api/agent-keys: the keys an AI agent (Hermes, Codex, Claude
 * Code) uses to act as the signed-in user over MCP. Every call throws an Error
 * whose message is safe to show; the server's own hint wins over its bare code.
 */

/** Daily cap buckets, named as the server names them (server/src/lib/agentKeys/caps.js). */
export const CAP_BUCKETS = ['renders', 'aiVideoUsd', 'images', 'tts', 'publishes'] as const;
export type CapBucket = (typeof CAP_BUCKETS)[number];
export type Caps = Record<CapBucket, number>;

export interface CapUsage {
  used: number;
  limit: number;
  remaining: number;
}

export interface AgentKey {
  id: string;
  name: string;
  /** First characters of the key: enough to tell keys apart, never enough to use one. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  publishAllowed: boolean;
  caps: Caps;
  /** Today's use against each cap (UTC day). */
  usage: Record<CapBucket, CapUsage>;
}

export interface ActivityEntry {
  /** ISO time the server logged the call. */
  ts: string;
  keyId: string | null;
  /** Null on key events (created, revoked, ...): look the name up by keyId. */
  keyName: string | null;
  tool: string;
  ok: boolean;
  error: string | null;
  userId?: string | null;
  email?: string | null;
  input?: unknown;
  ms?: number;
  job?: { kind?: string; id?: string } | null;
  caps?: Partial<Caps>;
}

export interface ActivityParams {
  keyId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface KeyList {
  endpoint: string;
  ceilings: Caps;
  keys: AgentKey[];
}

const BASE = '/api/agent-keys';

function failure(res: { error?: string; data?: unknown }, fallback: string): Error {
  const hint = (res.data as { hint?: unknown } | undefined)?.hint;
  return new Error((typeof hint === 'string' && hint) || res.error || fallback);
}

export async function listAgentKeys(): Promise<KeyList> {
  const res = await api.get<KeyList>(BASE);
  if (!res.ok || !res.data) throw failure(res, 'Could not load your agent keys');
  const { endpoint, ceilings, keys } = res.data;
  return { endpoint, ceilings, keys: Array.isArray(keys) ? keys : [] };
}

export async function createAgentKey(name: string): Promise<{ key: AgentKey; plain: string }> {
  const res = await api.post<{ key: AgentKey; plain: string }>(BASE, { name });
  if (!res.ok || !res.data?.key || !res.data.plain) throw failure(res, 'Could not create the key');
  return { key: res.data.key, plain: res.data.plain };
}

export async function updateAgentKey(
  id: string,
  patch: { publishAllowed?: boolean; caps?: Partial<Caps> },
): Promise<AgentKey> {
  const res = await api.patch<{ key: AgentKey }>(`${BASE}/${encodeURIComponent(id)}`, patch);
  if (!res.ok || !res.data?.key) throw failure(res, 'Could not save the change');
  return res.data.key;
}

export async function revokeAgentKey(id: string): Promise<void> {
  const res = await api.delete(`${BASE}/${encodeURIComponent(id)}`);
  if (!res.ok) throw failure(res, 'Could not revoke the key');
}

function query(params: ActivityParams): string {
  const search = new URLSearchParams();
  if (params.keyId) search.set('keyId', params.keyId);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  const text = search.toString();
  return text ? `?${text}` : '';
}

export async function listAgentActivity(params: ActivityParams = {}): Promise<ActivityEntry[]> {
  const res = await api.get<{ entries: ActivityEntry[] }>(`${BASE}/activity${query(params)}`);
  if (!res.ok || !res.data) throw failure(res, 'Could not load agent activity');
  return Array.isArray(res.data.entries) ? res.data.entries : [];
}

/** Path of the CSV export. A plain link cannot carry the sign-in token: use downloadActivityCsv. */
export function activityCsvUrl(params: ActivityParams = {}): string {
  return `${BASE}/activity.csv${query(params)}`;
}

/** Fetches the CSV with the bearer token and hands back the file for the browser to save. */
export async function downloadActivityCsv(params: ActivityParams = {}): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = api.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${api.baseUrl}${activityCsvUrl(params)}`, { headers });
  if (!res.ok) throw new Error(`Could not export the activity log (HTTP ${res.status})`);
  return res.blob();
}
