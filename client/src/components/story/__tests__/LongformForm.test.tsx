import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../../lib/api';
import { LongformForm } from '../LongformForm';

beforeEach(() => vi.restoreAllMocks());

describe('LongformForm', () => {
  it('loads templates and drafts from an idea', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { templates: [{ id: 'sleep-30', label: 'Sleep 30', kind: 'sleep', targetSec: 1800 }, { id: 'sleep-60', label: 'Sleep 60', kind: 'sleep', targetSec: 3600 }] } } as any);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { project: { projectId: 'p1', status: 'draft_script', longform: { sections: [] } } } } as any);
    const onDrafted = vi.fn();
    render(<LongformForm onDrafted={onDrafted} busy={false} />);
    await screen.findByRole('option', { name: 'Sleep 60' });
    await user.selectOptions(screen.getByLabelText(/format/i), 'sleep-60');
    await user.type(screen.getByLabelText(/what's on your heart/i), 'psalms when I cannot sleep');
    await user.click(screen.getByRole('button', { name: /write the outline/i }));
    expect(post).toHaveBeenCalledWith('/api/longform/draft', { idea: 'psalms when I cannot sleep', templateId: 'sleep-60' }, undefined, expect.anything());
    expect(onDrafted).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }));
  });
  it('disables the button until there is an idea', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { templates: [{ id: 'sleep-30', label: 'S', kind: 'sleep', targetSec: 1800 }] } } as any);
    render(<LongformForm onDrafted={() => {}} busy={false} />);
    await screen.findByRole('option', { name: 'S' });
    expect(screen.getByRole('button', { name: /write the outline/i })).toBeDisabled();
  });
});
