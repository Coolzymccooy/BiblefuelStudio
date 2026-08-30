import { useSyncExternalStore } from 'react';
import { api } from './api';

export type NotificationKind = 'job_done' | 'job_failed' | 'info' | 'campaign_done' | 'campaign_failed' | 'campaign_render_only';

export interface Notification {
    id: string;
    kind: NotificationKind;
    title: string;
    body?: string;
    href?: string;
    createdAt: string;
    read: boolean;
    meta?: Record<string, unknown>;
}

interface JobLike {
    id: string;
    type: string;
    status: 'queued' | 'running' | 'done' | 'failed';
    result?: {
        outFile?: string;
        file?: string;
        /**
         * For campaign_auto_post: tells us whether the share step actually
         * posted ({ ok: true }), failed ({ ok: false, error }), or was
         * deliberately skipped because the user has no destination
         * configured ({ ok: false, skipped: true, reason, message }).
         */
        share?: {
            ok?: boolean;
            skipped?: boolean;
            reason?: string;
            message?: string;
            error?: string;
        };
        [key: string]: unknown;
    };
    error?: string;
    /**
     * Set by the render pipeline when kinetic (word-by-word) captions had to
     * degrade to static line captions (no word timings / alignment). The
     * render still SUCCEEDS — this just explains why captions aren't animated.
     */
    captionFallback?: string;
}

const STORAGE_KEY = 'bf_notifications_v1';
const SEEN_JOBS_KEY = 'bf_notif_seen_jobs_v1';
const MAX_NOTIFICATIONS = 20;

let cache: Notification[] = loadFromStorage();
const seenJobs = new Set<string>(loadSeenJobs());
const listeners = new Set<() => void>();

function loadFromStorage(): Notification[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as Notification[]) : [];
    } catch { return []; }
}

function loadSeenJobs(): string[] {
    try {
        const raw = localStorage.getItem(SEEN_JOBS_KEY);
        return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
}

function persist() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
        localStorage.setItem(SEEN_JOBS_KEY, JSON.stringify([...seenJobs]));
    } catch { /* localStorage may be unavailable */ }
}

function emit() {
    listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}

function getNotifications(): Notification[] {
    return cache;
}

export function pushNotification(n: Omit<Notification, 'id' | 'createdAt' | 'read'>): Notification {
    const next: Notification = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        read: false,
        ...n,
    };
    cache = [next, ...cache].slice(0, MAX_NOTIFICATIONS);
    persist();
    emit();
    // Job end-states also raise a sticky banner. Writing only to the bell's
    // list meant a finished — or FAILED — render produced no visible signal
    // until the user thought to check.
    void import('./completionAlert').then((m) => m.considerForAlert(next)).catch(() => {});
    return next;
}

export function markAllRead(): void {
    cache = cache.map((n) => ({ ...n, read: true }));
    persist();
    emit();
}

export function markRead(id: string): void {
    cache = cache.map((n) => (n.id === id ? { ...n, read: true } : n));
    persist();
    emit();
}

export function clearAll(): void {
    cache = [];
    persist();
    emit();
}

export function useNotifications(): Notification[] {
    return useSyncExternalStore(subscribe, getNotifications, getNotifications);
}

export function useUnreadCount(): number {
    const notifications = useNotifications();
    return notifications.filter((n) => !n.read).length;
}

function prettyType(type: string): string {
    if (type === 'render_video') return 'Video render';
    if (type === 'render_waveform') return 'Waveform render';
    if (type === 'campaign_auto_post') return 'Auto-Publish campaign';
    return type;
}

let pollerStarted = false;
let pollerInterval: ReturnType<typeof setInterval> | null = null;
let firstPollDone = false;

async function pollJobs(): Promise<void> {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    try {
        const res = await api.get('/api/jobs');
        if (!res.ok || !res.data?.jobs) return;
        const jobs = res.data.jobs as JobLike[];
        for (const job of jobs) {
            if ((job.status === 'done' || job.status === 'failed') && !seenJobs.has(job.id)) {
                seenJobs.add(job.id);
                if (firstPollDone) {
                    const file = (job.result?.outFile as string | undefined) || (job.result?.file as string | undefined);
                    const isCampaign = job.type === 'campaign_auto_post';
                    // Render-only: campaign finished, video is ready, but the
                    // share step was deliberately skipped because the user has
                    // no destination configured. Different toast than a true
                    // "posted ✓" — green still (the work succeeded) but the
                    // message nudges toward Settings instead of celebrating
                    // a publish that never happened.
                    const isRenderOnly = isCampaign
                        && job.status === 'done'
                        && Boolean(job.result?.share?.skipped);
                    const kind: NotificationKind = isRenderOnly
                        ? 'campaign_render_only'
                        : isCampaign
                            ? (job.status === 'done' ? 'campaign_done' : 'campaign_failed')
                            : (job.status === 'done' ? 'job_done' : 'job_failed');
                    const title = isRenderOnly
                        ? 'Video ready (not posted)'
                        : job.status === 'done'
                            ? (isCampaign ? 'Auto-Publish posted ✓' : `${prettyType(job.type)} ready`)
                            : `${prettyType(job.type)} failed`;
                    // A successful render that fell back from kinetic to static
                    // captions surfaces the reason (instead of just the file
                    // path) so the user understands why captions aren't animated.
                    const captionFallback = typeof job.captionFallback === 'string' ? job.captionFallback : '';
                    // Campaign jobs are NOT excluded any more. A scheduled post
                    // publishes unreviewed, so a silent downgrade from
                    // word-by-word to static captions is exactly the case the
                    // operator most needs told about — they see the result on a
                    // public feed, not in the editor.
                    const finalTitle = (job.status === 'done' && captionFallback)
                        ? `${prettyType(job.type)} ready — captions are static`
                        : title;
                    const body = isRenderOnly
                        ? (job.result?.share?.message || 'Connect a destination in Settings to auto-publish next time.')
                        : job.status === 'done'
                            ? (captionFallback || file || '')
                            : (job.error || 'Job failed');
                    pushNotification({
                        kind,
                        title: finalTitle,
                        body,
                        // Studio routes live under /app/* (see App.tsx). Without
                        // the prefix, navigate('/render?share=…') / '/jobs' match
                        // no route and render a blank page when the user taps
                        // "Open" on a notification.
                        href: job.type.startsWith('render_') || isCampaign
                            ? `/app/render?share=${encodeURIComponent(job.id)}`
                            : '/app/jobs',
                        meta: { jobId: job.id, file: file || null, jobType: job.type, renderOnly: isRenderOnly },
                    });
                }
            }
        }
        if (!firstPollDone) {
            firstPollDone = true;
            persist();
        }
    } catch { /* swallow — next tick will retry */ }
}

export function startJobPoller(): void {
    if (pollerStarted) return;
    pollerStarted = true;
    void pollJobs();
    pollerInterval = setInterval(() => { void pollJobs(); }, 8000);
}

export function stopJobPoller(): void {
    if (pollerInterval) clearInterval(pollerInterval);
    pollerInterval = null;
    pollerStarted = false;
}

// Vite HMR cleanup. Without this, every save of this file (or any module
// that imports it) leaves the OLD setInterval running while a NEW one is
// started by the freshly-evaluated module. Over an hour of dev the browser
// accumulates dozens of orphan timers, each firing /api/jobs every 8s,
// which floods the Vite proxy and causes the "blank page + hundreds of
// pending requests" symptom.
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        stopJobPoller();
    });
}
