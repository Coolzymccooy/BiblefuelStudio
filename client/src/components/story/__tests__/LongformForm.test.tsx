import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../../lib/api';
import { storyApi } from '../../../lib/storyApi';
import toast from 'react-hot-toast';
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

  it('sends audioPath when a voice note is chosen and surfaces the suggested template', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { templates: [{ id: 'sleep-30', label: 'S30', kind: 'sleep', targetSec: 1800 }] } } as any);
    const upload = vi.spyOn(storyApi, 'uploadAudio').mockResolvedValue('/outputs/note.m4a');
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { project: { projectId: 'p2', status: 'draft_script', longform: { templateId: 'sleep-60', sections: [] } }, suggestion: { templateId: 'sleep-60', reason: 'the idea mentions an hour-long session' } } } as any);
    const info = vi.spyOn(toast, 'success');
    render(<LongformForm onDrafted={() => {}} busy={false} />);
    await screen.findByRole('option', { name: 'S30' });
    await user.selectOptions(screen.getByLabelText(/format/i), '');
    const file = new File(['aud'], 'note.m4a', { type: 'audio/m4a' });
    await user.upload(screen.getByLabelText(/voice note/i), file);
    expect(upload).toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith('/api/longform/draft', { audioPath: '/outputs/note.m4a' }, undefined, expect.anything());
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/hour-long session/));
  });

  it('allows re-selecting the same voice note file after a failed upload', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { templates: [{ id: 'sleep-30', label: 'S30', kind: 'sleep', targetSec: 1800 }] } } as any);
    const upload = vi.spyOn(storyApi, 'uploadAudio')
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce('/outputs/note.m4a');
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { project: { projectId: 'p3', status: 'draft_script', longform: { sections: [] } } } } as any);
    const err = vi.spyOn(toast, 'error');
    render(<LongformForm onDrafted={() => {}} busy={false} />);
    await screen.findByRole('option', { name: 'S30' });
    const file = new File(['aud'], 'note.m4a', { type: 'audio/m4a' });
    const input = screen.getByLabelText(/voice note/i);
    await user.upload(input, file);
    await user.upload(input, file);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalledTimes(1);
  });
});
