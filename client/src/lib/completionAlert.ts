/**
 * The one notification the user must not miss: "your video is ready".
 *
 * Job completions were pushed silently into the bell's list. A user who clicked
 * Generate Video and looked away had no idea the render had finished — the only
 * signal was a small badge they had to notice and then click. Failures were
 * even quieter, so a failed render looked exactly like one still running.
 *
 * This is a STICKY alert rather than a toast: it stays until the user opens or
 * dismisses it, because a video finishing is the end of the task they started
 * and dismissing it should be their decision, not a timer's.
 *
 * Only genuine end-states raise it. Informational notifications keep using the
 * bell, so the banner never becomes noise the user learns to ignore.
 */
import { useSyncExternalStore } from 'react';
import type { Notification, NotificationKind } from './notifications';

/** Kinds important enough to interrupt: a finished job, or a failed one. */
const ALERTING_KINDS: NotificationKind[] = [
  'job_done',
  'job_failed',
  'campaign_done',
  'campaign_failed',
  'campaign_render_only',
];

export type AlertTone = 'success' | 'warning' | 'error';

export interface CompletionAlert {
  id: string;
  title: string;
  body?: string;
  href?: string;
  tone: AlertTone;
}

/**
 * Should this notification interrupt the user?
 * @param n a notification
 */
export function shouldAlert(n: Pick<Notification, 'kind'>): boolean {
  return ALERTING_KINDS.includes(n.kind);
}

/**
 * Map a notification kind to a visual tone.
 *
 * `campaign_render_only` is a WARNING, not a success: the video exists but was
 * never posted, and treating it as a win is how a church ends up believing it
 * published a week of content that never left the building.
 */
export function toneFor(kind: NotificationKind): AlertTone {
  if (kind === 'job_failed' || kind === 'campaign_failed') return 'error';
  if (kind === 'campaign_render_only') return 'warning';
  return 'success';
}

/**
 * Build the alert shown for a notification.
 * @param n the source notification
 */
export function alertFrom(n: Notification): CompletionAlert {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    href: n.href,
    tone: toneFor(n.kind),
  };
}

// ── store ──────────────────────────────────────────────────────────────────
// Deliberately in-memory: an alert is about something that happened while the
// user was watching THIS session. Persisting it would resurrect a stale "video
// ready" days later, pointing at a file the user long since dealt with.

let current: CompletionAlert | null = null;
const listeners = new Set<() => void>();

function emit() { listeners.forEach((l) => l()); }

/** Raise an alert, replacing any current one (newest wins). */
export function raiseAlert(alert: CompletionAlert): void {
  current = alert;
  emit();
}

/** Clear the visible alert. */
export function dismissAlert(): void {
  if (!current) return;
  current = null;
  emit();
}

/** Consider a notification for alerting; ignored when it isn't an end-state. */
export function considerForAlert(n: Notification): boolean {
  if (!shouldAlert(n)) return false;
  raiseAlert(alertFrom(n));
  return true;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function snapshot(): CompletionAlert | null { return current; }

/** React binding for the current alert. */
export function useCompletionAlert(): CompletionAlert | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** Test seam. */
export function _resetAlertsForTest(): void {
  current = null;
  listeners.clear();
}
