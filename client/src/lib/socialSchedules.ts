export type SocialSchedule = {
    id: string;
    name: string;
    enabled: boolean;
    type: 'replay' | 'auto_generate';
    cron: string;
    timezone: string;
    destination: 'webhook' | 'buffer' | 'youtube';
    caption: string;
    videoUrl: string;
    webhookId?: string;
    profileId?: string;
    privacyStatus?: 'private' | 'unlisted' | 'public';
    // auto_generate knobs
    niche?: string;
    tone?: string;
    ctaStyle?: string;
    aspect?: string;
    durationSec?: number;
    voiceId?: string;
    backgroundQuery?: string;
    /** Word-by-word captions. Carried through untouched: the server treats a missing value as on. */
    kineticCaptions?: boolean;
};

/** A schedule as the server sent it, with safe defaults for anything missing. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scheduleFromServer(s: any): SocialSchedule {
    return {
        id: String(s.id || `sch_${Date.now()}`),
        name: String(s.name || 'Scheduled Post'),
        enabled: Boolean(s.enabled ?? true),
        type: s.type === 'auto_generate' ? 'auto_generate' : 'replay',
        cron: String(s.cron || ''),
        timezone: String(s.timezone || 'UTC'),
        destination: (['webhook', 'buffer', 'youtube'].includes(String(s.destination))
            ? String(s.destination)
            : 'webhook') as SocialSchedule['destination'],
        caption: String(s.caption || ''),
        videoUrl: String(s.videoUrl || ''),
        webhookId: String(s.webhookId || ''),
        profileId: String(s.profileId || ''),
        privacyStatus: (['private', 'unlisted', 'public'].includes(String(s.privacyStatus))
            ? String(s.privacyStatus)
            : 'private') as SocialSchedule['privacyStatus'],
        niche: s.niche ? String(s.niche) : undefined,
        tone: s.tone ? String(s.tone) : undefined,
        ctaStyle: s.ctaStyle ? String(s.ctaStyle) : undefined,
        aspect: s.aspect ? String(s.aspect) : undefined,
        durationSec: Number.isFinite(Number(s.durationSec)) ? Number(s.durationSec) : undefined,
        voiceId: s.voiceId ? String(s.voiceId) : undefined,
        backgroundQuery: s.backgroundQuery ? String(s.backgroundQuery) : undefined,
        kineticCaptions: typeof s.kineticCaptions === 'boolean' ? s.kineticCaptions : undefined,
    };
}

// Posting cadence presets. Cron is `m h dom mon dow`; the timezone below is
// what makes 06:00 mean 06:00 locally all year (UTC drifts an hour under BST).
export const SCHEDULE_TIMEZONE = 'Europe/London';

export const SCHEDULE_PRESETS: Array<{ key: string; label: string; hint: string; cron: string }> = [
    { key: 'morning', label: 'Morning', hint: '6:00am daily', cron: '0 6 * * *' },
    { key: 'night', label: 'Night', hint: '10:00pm daily', cron: '0 22 * * *' },
    { key: 'sunday', label: 'Sunday', hint: '9:00am Sundays', cron: '0 9 * * 0' },
];

/** A stable string for a schedule as saved, independent of key order. */
export function scheduleSnapshot(schedule: SocialSchedule): string {
    const entries = Object.entries(schedule)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(entries);
}

/**
 * True when a schedule on screen differs from what the server has. Changing a
 * field (switching it to Disabled, say) used to look done while nothing was
 * saved, so a refresh put the schedule back to Enabled.
 */
export function isScheduleUnsaved(schedule: SocialSchedule, saved: Record<string, string>): boolean {
    return saved[schedule.id] !== scheduleSnapshot(schedule);
}

export function scheduleSavedMessage(schedule: SocialSchedule): string {
    const name = schedule.name.trim() || 'Schedule';
    return schedule.enabled ? `${name} saved.` : `${name} paused. It will not run until you enable it.`;
}
