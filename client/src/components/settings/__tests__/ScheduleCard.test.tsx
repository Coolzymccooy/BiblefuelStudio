import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScheduleCard } from '../ScheduleCard';
import type { SocialSchedule } from '../../../lib/socialSchedules';

const schedule: SocialSchedule = {
    id: 'sch_1', name: 'Sunday post', enabled: true, type: 'auto_generate', cron: '0 9 * * 0',
    timezone: 'Europe/London', destination: 'webhook', caption: '', videoUrl: '', webhookId: 'w1',
};

function setup(over: Partial<Parameters<typeof ScheduleCard>[0]> = {}) {
    const props = {
        schedule,
        webhooks: [{ id: 'w1', name: 'Make' }],
        profileIds: [],
        unsaved: false,
        saving: false,
        onChange: vi.fn(),
        onSave: vi.fn(),
        onRemove: vi.fn(),
        ...over,
    };
    render(<ScheduleCard {...props} />);
    return props;
}

describe('ScheduleCard', () => {
    it('a saved schedule shows no unsaved note, and its Save button is disabled', () => {
        setup();
        expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save Sunday post' })).toBeDisabled();
    });

    it('an edited schedule says so next to its own Save button', async () => {
        const props = setup({ unsaved: true });
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Save Sunday post' }));
        expect(props.onSave).toHaveBeenCalledTimes(1);
    });

    it('switching the status to Disabled reports the change', async () => {
        const props = setup();
        await userEvent.selectOptions(screen.getByLabelText('Status of Sunday post'), 'false');
        expect(props.onChange).toHaveBeenCalledWith({ enabled: false });
    });

    it('Save is busy while saving', () => {
        setup({ unsaved: true, saving: true });
        expect(screen.getByRole('button', { name: 'Save Sunday post' })).toBeDisabled();
    });

    it('Remove names the schedule it removes', async () => {
        const props = setup();
        await userEvent.click(screen.getByRole('button', { name: 'Remove Sunday post' }));
        expect(props.onRemove).toHaveBeenCalledTimes(1);
    });
});
