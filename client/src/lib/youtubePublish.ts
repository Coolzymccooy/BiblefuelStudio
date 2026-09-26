import { api } from './api';

/**
 * Publish to YouTube as a server job and follow it to the end.
 *
 * One request used to last the whole upload; a long video outlived the
 * browser's 15 s wait, so the page said it failed while the upload carried on,
 * and a retry uploaded a second copy. Now the server answers at once with a
 * job and this checks on it every few seconds.
 */

export interface PublishOutcomeResult {
  videoId: string;
  videoUrl: string;
  forcedPrivate: boolean;
  thumbnailError?: string;
  thumbnailWarning?: string;
  /** Set when the server was asked to note the video on an ambient session. */
  recorded?: boolean;
}

export type PublishOutcome =
  | { ok: true; result: PublishOutcomeResult }
  | { ok: false; error: string }
  | { ok: false; stopped: true };

interface PublishJob {
  jobId: string;
  status: 'running' | 'done' | 'error';
  result?: PublishOutcomeResult;
  error?: string;
}

export interface PublishOptions {
  /** Between checks. */
  pollMs?: number;
  /** Stop following (e.g. the page closed); the upload itself carries on. */
  shouldStop?: () => boolean;
  /**
   * This video was already uploading, so this request joined that upload and
   * its own details (title, privacy...) were not used.
   */
  onJoined?: () => void;
}

/** Consecutive failed checks before giving up on following the job. */
const MAX_MISSED_CHECKS = 5;
/** Beyond any real upload; the job is then assumed lost with the server. */
const MAX_FOLLOW_MS = 4 * 60 * 60_000;
const LOST_TRACK =
  "Lost track of the upload. It may still finish — check YouTube Studio before publishing again.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function publishToYoutube(
  body: Record<string, unknown>,
  { pollMs = 3000, shouldStop = () => false, onJoined }: PublishOptions = {},
): Promise<PublishOutcome> {
  const started = await api.post<{ jobId: string; joined?: boolean }>('/api/social/youtube/publish', body);
  const jobId = started.ok ? started.data?.jobId : undefined;
  if (!jobId) return { ok: false, error: started.error || 'YouTube upload failed' };
  if (started.data?.joined) onJoined?.();

  const since = Date.now();
  let missed = 0;
  for (;;) {
    await sleep(pollMs);
    if (shouldStop()) return { ok: false, stopped: true };
    const res = await api.get<{ job: PublishJob }>(`/api/social/youtube/publish/${jobId}`);
    const job = res.ok ? res.data?.job : undefined;
    if (!job) {
      // A dropped connection or a deploy restarting the server: the upload
      // may be fine, so a few misses are ridden out rather than reported.
      missed += 1;
      if (missed >= MAX_MISSED_CHECKS) return { ok: false, error: LOST_TRACK };
      continue;
    }
    missed = 0;
    if (job.status === 'done' && job.result) return { ok: true, result: job.result };
    if (job.status === 'error') return { ok: false, error: job.error || 'YouTube upload failed' };
    if (Date.now() - since > MAX_FOLLOW_MS) return { ok: false, error: LOST_TRACK };
  }
}
