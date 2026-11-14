import type { CampaignRow, Destination, ScheduledPostInput } from './scheduledPosts';

export interface JournalRow extends CampaignRow {
  included: boolean; key: string; ids: Record<Destination, string>; wall: string;
  videoUrl?: string; localHash?: string; localBytes?: number;
}
export interface SubmissionJournal {
  version: 1; owner: string; reviewed: true; rows: JournalRow[]; payload: ScheduledPostInput[];
}
export const journalKey = (owner: string) => `BF_FINITE_SUBMISSION_V1:${encodeURIComponent(owner)}`;
const bad = () => new Error('Saved submission cannot be read safely. New requests are blocked. Ask an operator to reconcile the queue before clearing this saved record.');
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown): v is string => typeof v === 'string';
export function loadJournal(owner: string): SubmissionJournal | null {
  const raw = localStorage.getItem(journalKey(owner));
  if (raw === null) return null;
  if (raw.length > 256000) throw bad();
  let j: SubmissionJournal;
  try { j = JSON.parse(raw); } catch { throw bad(); }
  if (!j || j.version !== 1 || j.owner !== owner || j.reviewed !== true || !Array.isArray(j.rows) || !j.rows.length || j.rows.length > 20 || !Array.isArray(j.payload) || !j.payload.length || j.payload.length > 20) throw bad();
  const ids = new Set<string>();
  for (const p of j.payload) {
    if (!p || !text(p.clientId) || !p.clientId || ids.has(p.clientId) || !text(p.videoUrl) || !p.videoUrl.startsWith('/') || !text(p.title) || !text(p.caption) || !text(p.scheduledAt) || !Number.isFinite(Date.parse(p.scheduledAt)) || p.timezone !== 'Europe/London' || !['youtube', 'tiktok'].includes(p.destination) || p.privacyStatus !== (p.destination === 'youtube' ? 'public' : 'PUBLIC_TO_EVERYONE') || !hash(p.expectedSha256) || !Number.isSafeInteger(p.expectedBytes) || p.expectedBytes <= 0) throw bad();
    ids.add(p.clientId);
  }
  for (const r of j.rows) {
    if (!r || !text(r.key) || !text(r.filename) || !text(r.title) || !text(r.caption) || !text(r.wall) || typeof r.included !== 'boolean' || !r.ids || !text(r.ids.youtube) || !text(r.ids.tiktok) || !Array.isArray(r.destinations) || r.destinations.some(d => d !== 'youtube' && d !== 'tiktok')) throw bad();
  }
  if (!j.payload.every(p => j.rows.some(r => r.included && r.ids[p.destination] === p.clientId && r.videoUrl === p.videoUrl && r.localHash === p.expectedSha256 && r.localBytes === p.expectedBytes))) throw bad();
  // Only allowlisted metadata is rendered; no File, tokens, credentials or file bytes.
  return { version: 1, owner, reviewed: true, payload: j.payload.map(p => ({ clientId: p.clientId, title: p.title, caption: p.caption, videoUrl: p.videoUrl, scheduledAt: p.scheduledAt, timezone: p.timezone, destination: p.destination, expectedSha256: p.expectedSha256, expectedBytes: p.expectedBytes, privacyStatus: p.privacyStatus })), rows: j.rows.map(metadata) };
}
export function metadata(r: JournalRow): JournalRow {
  return { filename: r.filename, title: r.title, caption: r.caption, scheduledAt: r.scheduledAt, timezone: r.timezone, destinations: r.destinations, sha256: r.sha256, bytes: r.bytes, included: r.included, key: r.key, ids: r.ids, wall: r.wall, videoUrl: r.videoUrl, localHash: r.localHash, localBytes: r.localBytes };
}
export function saveJournal(j: SubmissionJournal) {
  const value = JSON.stringify({ ...j, rows: j.rows.map(metadata) });
  if (value.length > 256000) throw new Error('Saved submission is too large. Nothing was submitted.');
  localStorage.setItem(journalKey(j.owner), value);
  if (localStorage.getItem(journalKey(j.owner)) !== value) throw new Error('Could not verify the saved submission. Nothing was submitted.');
}
