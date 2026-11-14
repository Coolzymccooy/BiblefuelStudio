export type Destination = 'youtube' | 'tiktok';
export interface ScheduledPostInput {
  clientId: string; title: string; caption: string; videoUrl: string;
  scheduledAt: string; timezone: string; destination: Destination;
  privacyStatus: 'public' | 'PUBLIC_TO_EVERYONE';
  expectedSha256: string; expectedBytes: number;
}
export interface ScheduledPost extends ScheduledPostInput {
  id: string; status: string; mediaSha256?: string; bytes?: number;
  receipt?: unknown; error?: string;
}
export interface CampaignRow {
  filename: string; title: string; caption: string; scheduledAt: string | null;
  timezone: string; destinations: Destination[]; sha256?: string; bytes?: number;
}
export function parseCampaign(value: unknown): CampaignRow[] {
  const root = value as { version?: unknown; rows?: unknown };
  if (root?.version !== 1 || !Array.isArray(root.rows) || !root.rows.length || root.rows.length > 20) throw new Error('Use a version 1 campaign with 1–20 rows.');
  const names = new Set<string>();
  return root.rows.map((raw: unknown) => {
    const r = raw as Record<string, unknown>;
    if (!r || typeof r.filename !== 'string' || !/^[^/\\]+\.mp4$/i.test(r.filename) || names.has(r.filename)) throw new Error('Each row needs a unique, exact MP4 filename.');
    names.add(r.filename);
    if (typeof r.title !== 'string' || !r.title.trim() || typeof r.caption !== 'string' || r.timezone !== 'Europe/London' || !Array.isArray(r.destinations) || !r.destinations.length || r.destinations.some(d => d !== 'youtube' && d !== 'tiktok') || new Set(r.destinations).size !== r.destinations.length) throw new Error('Invalid campaign title, caption, timezone or destinations.');
    if (r.youtubePrivacyStatus !== 'public' || r.tiktokPrivacyStatus !== 'PUBLIC_TO_EVERYONE') throw new Error('Campaign destinations must explicitly request public visibility.');
    if (r.scheduledAt !== null && (typeof r.scheduledAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|\+00:00)$/.test(r.scheduledAt) || !Number.isFinite(Date.parse(r.scheduledAt)) || new Date(r.scheduledAt).toISOString().replace('.000Z', 'Z') !== r.scheduledAt.replace('+00:00', 'Z').replace('.000Z', 'Z'))) throw new Error('Use UTC ISO scheduledAt (Z or +00:00), or null for a pending time.');
    if (r.sha256 !== undefined && (typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(r.sha256))) throw new Error('Invalid SHA-256.');
    if (r.bytes !== undefined && (typeof r.bytes !== 'number' || !Number.isSafeInteger(r.bytes) || r.bytes <= 0)) throw new Error('Invalid file size.');
    return { filename: r.filename, title: r.title, caption: r.caption, timezone: r.timezone, destinations: r.destinations as Destination[], scheduledAt: r.timeApproved === false ? null : r.scheduledAt as string | null, sha256: r.sha256 as string | undefined, bytes: r.bytes as number | undefined };
  });
}
/** Explicit London wall clock, rejecting DST gaps and folds rather than guessing. */
export function londonToUtc(wall: string, now = Date.now()): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) throw new Error('Choose a date and time for every video.');
  const naive = Date.parse(`${wall}:00Z`);
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0,16) !== wall) throw new Error('Invalid date and time.');
  const matches: number[] = [];
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (const offset of [0, 60]) {
    const candidate = naive - offset * 60000;
    if (fmt.format(candidate).replace(' ', 'T') === wall) matches.push(candidate);
  }
  if (matches.length !== 1) throw new Error('This London time is missing or ambiguous because of daylight saving. Choose another time.');
  if (matches[0] <= now) throw new Error('Every scheduled time must be in the future.');
  return new Date(matches[0]).toISOString();
}
export function londonWall(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).replace(' ', 'T');
}
export const statusLabel: Record<string, string> = {
  queued: 'Queued', publishing: 'Publishing — awaiting confirmation', published: 'Published',
  accepted: 'Provider accepted — publication not confirmed', draft: 'TikTok inbox draft — not public',
  failed: 'Failed — no automatic retry', needs_review: 'Needs review — outcome uncertain; do not repost', cancelled: 'Cancelled',
};
