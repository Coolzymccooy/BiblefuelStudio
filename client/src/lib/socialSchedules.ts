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
};

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
