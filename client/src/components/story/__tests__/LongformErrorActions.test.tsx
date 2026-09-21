import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../../lib/api';
import toast from 'react-hot-toast';
import { LongformErrorActions, isFailedLongformNarration } from '../LongformErrorActions';

beforeEach(() => vi.restoreAllMocks());

const failed: any = {
  projectId: 'p1', status: 'error', error: 'azure quota',
  transcript: { words: [], hash: null },
  longform: { templateId: 'sleep-30', sections: [{ heading: 'Welcome', reference: null, verseText: '', text: 'rest', targetSec: 60 }] },
};

describe('isFailedLongformNarration', () => {
  it('is true only for an errored project with sections and no transcript', () => {
    expect(isFailedLongformNarration(failed)).toBe(true);
    expect(isFailedLongformNarration({ ...failed, status: 'draft_script' })).toBe(false);
    expect(isFailedLongformNarration({ ...failed, transcript: { words: [{ text: 'a', startMs: 0, endMs: 1 }], hash: null } })).toBe(false);
    expect(isFailedLongformNarration({ ...failed, longform: { templateId: 'sleep-30', sections: [] } })).toBe(false);
    expect(isFailedLongformNarration({ ...failed, longform: undefined })).toBe(false);
    expect(isFailedLongformNarration(null)).toBe(false);
  });
});

describe('LongformErrorActions', () => {
  it('"Retry narration" calls the narrate endpoint and refreshes', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { project: { ...failed, status: 'narrating' } } } as any);
    const onChanged = vi.fn();
    render(<LongformErrorActions project={failed} onChanged={onChanged} />);
    await user.click(screen.getByRole('button', { name: /retry narration/i }));
    expect(post).toHaveBeenCalledWith('/api/longform/p1/narrate', {});
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('"Back to outline" calls the reopen endpoint and refreshes', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { project: { ...failed, status: 'draft_script', error: null } } } as any);
    const onChanged = vi.fn();
    render(<LongformErrorActions project={failed} onChanged={onChanged} />);
    await user.click(screen.getByRole('button', { name: /back to outline/i }));
    expect(post).toHaveBeenCalledWith('/api/longform/p1/reopen', {});
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('surfaces a server error as a toast and does not refresh', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, error: 'only a project in error can be reopened as a draft' } as any);
    const error = vi.spyOn(toast, 'error').mockImplementation(() => 'id');
    const onChanged = vi.fn();
    render(<LongformErrorActions project={failed} onChanged={onChanged} />);
    await user.click(screen.getByRole('button', { name: /back to outline/i }));
    expect(error).toHaveBeenCalledWith('only a project in error can be reopened as a draft');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('disables both buttons when the page is busy', () => {
    render(<LongformErrorActions project={failed} onChanged={() => {}} busy />);
    expect(screen.getByRole('button', { name: /retry narration/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /back to outline/i })).toBeDisabled();
  });
});
