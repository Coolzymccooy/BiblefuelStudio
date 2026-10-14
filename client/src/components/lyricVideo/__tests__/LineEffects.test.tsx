import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../../lib/lyricVideoApi', () => ({ lyricVideoApi: { patchLine: vi.fn(), effects: vi.fn(), setLook: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
import toast from 'react-hot-toast';
import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { LineEffects } from '../LineEffects';
import { ShuffleButton, nextSeed } from '../ShuffleButton';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const line = (id: string, text: string, kind = 'lead', effect = 'auto') => ({ id, sectionId: 's1', kind, text, effect,
  words: [{ text, start: 1, end: 2 }], start: 1, end: 2, confidence: 1, flag: null });
const project = { projectId: 'lv_1', look: { id: 'studio-lagos-night', energy: 'wild', seed: 1 },
  lines: [line('l1', 'Who talk say'), line('l2', '(WHO TALK SAY?!)', 'response'), { id: 'l3', sectionId: 's1', kind: 'lead', text: 'Not timed', effect: 'auto' }] } as unknown as LyricProject;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lyricVideoApi.effects).mockResolvedValue({ l1: 'slam', l2: 'echo' });
});

describe('LineEffects', () => {
  it('lists timed lines with Auto showing the effect the video will use', async () => {
    render(<LineEffects project={project} onChange={vi.fn()} onPreviewChange={vi.fn()} />);
    expect(await screen.findByRole('option', { name: 'Auto · Slam' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Auto · Echo' })).toBeTruthy();
    expect(screen.queryByText('Not timed')).toBeNull();
  });
  it('offers every effect by its plain name', async () => {
    render(<LineEffects project={project} onChange={vi.fn()} onPreviewChange={vi.fn()} />);
    await screen.findByRole('option', { name: 'Auto · Slam' });
    for (const name of ['Pop', 'Stack', 'Slam', 'Quote', 'Curve', 'Frame', 'Echo (crowd reply)']) {
      expect(screen.getAllByRole('option', { name })).toHaveLength(2);
    }
  });
  it('fetches the resolved effects once for the whole list', async () => {
    render(<LineEffects project={project} onChange={vi.fn()} onPreviewChange={vi.fn()} />);
    await screen.findByRole('option', { name: 'Auto · Slam' });
    expect(lyricVideoApi.effects).toHaveBeenCalledTimes(1);
    expect(lyricVideoApi.effects).toHaveBeenCalledWith('lv_1');
  });
  it('shows nothing and fetches nothing when no line is timed', () => {
    const none = { ...project, lines: [{ id: 'l3', sectionId: 's1', kind: 'lead', text: 'Not timed', effect: 'auto' }] } as unknown as LyricProject;
    const { container } = render(<LineEffects project={none} onChange={vi.fn()} onPreviewChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(lyricVideoApi.effects).not.toHaveBeenCalled();
  });
  it('choosing an effect saves it and redraws the preview', async () => {
    const changed = { ...project };
    vi.mocked(lyricVideoApi.patchLine).mockResolvedValue(changed);
    const onChange = vi.fn(); const onPreviewChange = vi.fn();
    render(<LineEffects project={project} onChange={onChange} onPreviewChange={onPreviewChange} />);
    fireEvent.change(await screen.findByLabelText('Effect for “Who talk say”'), { target: { value: 'curve' } });
    await waitFor(() => expect(lyricVideoApi.patchLine).toHaveBeenCalledWith('lv_1', 'l1', { effect: 'curve' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(changed));
    expect(onPreviewChange).toHaveBeenCalled();
  });
  it('refetches the resolved effects after a change', async () => {
    const changed = { ...project, lines: [line('l1', 'Who talk say', 'lead', 'curve'), project.lines[1], project.lines[2]] } as unknown as LyricProject;
    vi.mocked(lyricVideoApi.patchLine).mockResolvedValue(changed);
    const Harness = () => {
      const [p, setP] = useState(project);
      return <LineEffects project={p} onChange={setP} onPreviewChange={vi.fn()} />;
    };
    render(<Harness />);
    fireEvent.change(await screen.findByLabelText('Effect for “Who talk say”'), { target: { value: 'curve' } });
    await waitFor(() => expect(lyricVideoApi.effects).toHaveBeenCalledTimes(2));
  });
  it('says why a change failed and leaves the preview alone', async () => {
    vi.mocked(lyricVideoApi.patchLine).mockRejectedValue(new Error('Could not save that.'));
    const onPreviewChange = vi.fn();
    render(<LineEffects project={project} onChange={vi.fn()} onPreviewChange={onPreviewChange} />);
    fireEvent.change(await screen.findByLabelText('Effect for “Who talk say”'), { target: { value: 'pop' } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not save that.'));
    expect(onPreviewChange).not.toHaveBeenCalled();
  });
});

describe('ShuffleButton', () => {
  it('saves a new mix and confirms it', async () => {
    const shuffled = { ...project, look: { ...project.look, seed: nextSeed(1) } } as LyricProject;
    vi.mocked(lyricVideoApi.setLook).mockResolvedValue(shuffled);
    const onChange = vi.fn(); const onPreviewChange = vi.fn();
    render(<ShuffleButton project={project} onChange={onChange} onPreviewChange={onPreviewChange} />);
    fireEvent.click(screen.getByRole('button', { name: /shuffle effects/i }));
    await waitFor(() => expect(lyricVideoApi.setLook).toHaveBeenCalledWith('lv_1', { seed: nextSeed(1) }));
    expect(await screen.findByText('✓ Shuffled')).toBeTruthy();
    expect(onChange).toHaveBeenCalledWith(shuffled);
    expect(onPreviewChange).toHaveBeenCalled();
  });
  it('announces its progress to screen readers and explains itself', async () => {
    vi.mocked(lyricVideoApi.setLook).mockResolvedValue(project);
    render(<ShuffleButton project={project} onChange={vi.fn()} onPreviewChange={vi.fn()} />);
    expect(screen.getByText('Changes the effects on lines set to Auto. Your own choices stay.')).toBeTruthy();
    const status = screen.getByRole('status');
    fireEvent.click(screen.getByRole('button', { name: /shuffle effects/i }));
    expect(await screen.findByText('✓ Shuffled')).toBeTruthy();
    expect(status.textContent).toBe('✓ Shuffled');
  });
  it('clears the confirmation after a moment', async () => {
    vi.mocked(lyricVideoApi.setLook).mockResolvedValue(project);
    render(<ShuffleButton project={project} onChange={vi.fn()} onPreviewChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /shuffle effects/i }));
    await screen.findByText('✓ Shuffled');
    await waitFor(() => expect(screen.queryByText('✓ Shuffled')).toBeNull(), { timeout: 2500 });
  });
  it('says why it failed and does not redraw', async () => {
    vi.mocked(lyricVideoApi.setLook).mockRejectedValue(new Error('Could not shuffle.'));
    const onPreviewChange = vi.fn();
    render(<ShuffleButton project={project} onChange={vi.fn()} onPreviewChange={onPreviewChange} />);
    fireEvent.click(screen.getByRole('button', { name: /shuffle effects/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not shuffle.'));
    expect(onPreviewChange).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: /shuffle effects/i }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('nextSeed never repeats and never returns 1', () => {
    for (const s of [1, 2, 50, 99_999]) { expect(nextSeed(s)).not.toBe(s); expect(nextSeed(s)).toBeGreaterThanOrEqual(2); }
  });
});
