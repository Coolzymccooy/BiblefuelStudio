import { describe, expect, it } from 'vitest';
import { scheduleSnapshot, isScheduleUnsaved, scheduleSavedMessage, scheduleFromServer, type SocialSchedule } from '../socialSchedules';

const base: SocialSchedule = {
    id: 'sch_1', name: 'Auto Post', enabled: true, type: 'auto_generate', cron: '0 9 * * 0',
    timezone: 'Europe/London', destination: 'webhook', caption: '', videoUrl: '', webhookId: 'w1',
};

describe('isScheduleUnsaved', () => {
    it('is false for a schedule exactly as saved', () => {
        const saved = { [base.id]: scheduleSnapshot(base) };
        expect(isScheduleUnsaved(base, saved)).toBe(false);
    });

    it('is true once a field changes, such as switching it to Disabled', () => {
        const saved = { [base.id]: scheduleSnapshot(base) };
        expect(isScheduleUnsaved({ ...base, enabled: false }, saved)).toBe(true);
    });

    it('is true for a new schedule that was never saved', () => {
        expect(isScheduleUnsaved(base, {})).toBe(true);
    });

    it('ignores key order, so a reload does not look like an edit', () => {
        const reordered = JSON.parse(JSON.stringify({ webhookId: 'w1', ...base }));
        expect(isScheduleUnsaved(reordered, { [base.id]: scheduleSnapshot(base) })).toBe(false);
    });
});

describe('scheduleFromServer', () => {
    it('keeps a kinetic-captions opt-out, so saving does not switch captions back on', () => {
        expect(scheduleFromServer({ id: 'a', type: 'auto_generate', cron: '0 9 * * 0', kineticCaptions: false }).kineticCaptions).toBe(false);
        expect(scheduleFromServer({ id: 'a', type: 'auto_generate', cron: '0 9 * * 0' }).kineticCaptions).toBeUndefined();
    });

    it('fills safe defaults for missing fields', () => {
        const s = scheduleFromServer({ id: 'b' });
        expect(s).toMatchObject({ id: 'b', name: 'Scheduled Post', enabled: true, type: 'replay', timezone: 'UTC', destination: 'webhook', privacyStatus: 'private' });
    });
});

describe('scheduleSavedMessage', () => {
    it('says paused for a disabled schedule and saved otherwise', () => {
        expect(scheduleSavedMessage({ ...base, enabled: false })).toBe('Auto Post paused. It will not run until you enable it.');
        expect(scheduleSavedMessage(base)).toBe('Auto Post saved.');
    });
});
