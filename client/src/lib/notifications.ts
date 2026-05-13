import { useSyncExternalStore } from 'react';
import { api } from './api';

export type NotificationKind = 'job_done' | 'job_failed' | 'info';

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
    result?: { outFile?: string; file?: string;[key: string]: unknown };
    error?: string;
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
                    pushNotification({
                        kind: job.status === 'done' ? 'job_done' : 'job_failed',
                        title: job.status === 'done'
                            ? `${prettyType(job.type)} ready`
                            : `${prettyType(job.type)} failed`,
                        body: job.status === 'done' ? (file || '') : (job.error || 'Job failed'),
                        href: job.type.startsWith('render_')
                            ? `/render?share=${encodeURIComponent(job.id)}`
                            : '/jobs',
                        meta: { jobId: job.id, file: file || null, jobType: job.type },
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
