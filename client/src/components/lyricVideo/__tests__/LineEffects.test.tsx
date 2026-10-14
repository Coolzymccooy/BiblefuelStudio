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
import type { ProjectWrite } from '../useProjectSaves';

const line = (id: string, text: string, kind = 'lead', effect = 'auto') => ({ id, sectionId: 's1', kind, text, effect,
  words: [{ text, start: 1, end: 2 }], start: 1, end: 2, confidence: 1, flag: null });
const project = { projectId: 'lv_1', look: { id: 'studio-lagos-night', energy: 'wild', seed: 1 },
  lines: [line('l1', 'Who talk say'), line('l2', '(WHO TALK SAY?!)', 'response'), { id: 'l3', sectionId: 's1', kind: 'lead', text: 'Not timed', effect: 'auto' }] } as unknown as LyricProject;

/** A save that runs the write at once and files its reply, as the step's writer does with nothing queued. */
const saveTo = (onChange: (p: LyricProject) => void) => async (write: ProjectWrite) => {
  const saved = await write();
  onChange(saved);
  return saved;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lyricVideoApi.effects).mockResolvedValue({ l1: 'slam', l2: 'echo' });
});

describe('LineEffects', () => {
  it('lists timed lines with Auto showing the effect the video will use', async () => {
    render(<LineEffects project={project} save={saveTo(vi.fn())} onPreviewChange={vi.fn()} />);
    expect(await screen.findByRole('option', { name: 'Auto · Slam' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Auto · Echo' })).toBeTruthy();
    expect(screen.queryByText('Not timed')).toBeNull();
  });
  it('offers every effect by its plain name', async () => {
    render(<LineEffects project={project} save={saveTo(vi.fn())} onPreviewChange={vi.fn()} />);
    await screen.findByRole('option', { name: 'Auto · Slam' });
    for (const name of ['Pop', 'Stack', 'Slam', 'Quote', 'Curve', 'Frame', 'Echo (crowd reply)']) {
      expect(screen.getAllByRole('option', { name })).toHaveLength(2);
    }
  });
  it('fetches the resolved effects once for the whole list', async () => {
    render(<LineEffects project={project} save={saveTo(vi.fn())} onPreviewChange={vi.fn()} />);
    await screen.findByRole('option', { name: 'Auto · Slam' });
    expect(lyricVideoApi.effects).toHaveBeenCalledTimes(1);
    expect(lyricVideoApi.effects).toHaveBeenCalledWith('lv_1');
  });
  it('shows nothing and fetches nothing when no line is timed', () => {
    const none = { ...project, lines: [{ id: 'l3', sectionId: 's1', kind: 'lead', text: 'Not timed', effect: 'auto' }] } as unknown as LyricProject;
    const { container } = render(<LineEffects project={none} save={saveTo(vi.fn())} onPreviewChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(lyricVideoApi.effects).not.toHaveBeenCalled();
  });
  it('choosing an effect saves it and redraws the preview', async () => {
    const changed = { ...project };
    vi.mocked(lyricVideoApi.patchLine).mockResolvedValue(changed);
    const onChange = vi.fn(); const onPreviewChange = vi.fn();
    render(<LineEffects project={project} save={saveTo(onChange)} onPreviewChange={onPreviewChange} />);
    fireEvent.change(await screen.findByLabelText('Effect for “Who talk say” at 0:01.0'), { target: { value: 'curve' } });
    await waitFor(() => expect(lyricVideoApi.patchLine).toHaveBeenCalledWith('lv_1', 'l1', { effect: 'curve' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(changed));
    expect(onPreviewChange).toHaveBeenCalled();
  });
  it('refetches the resolved effects after a change', async () => {
    const changed = { ...project, lines: [line('l1', 'Who talk say', 'lead', 'curve'), project.lines[1], project.lines[2]] } as unknown as LyricProject;
    vi.mocked(lyricVideoApi.patchLine).mockResolvedValue(changed);
    const Harness = () => {
      const [p, setP] = useState(project);
      return <LineEffects project={p} save={saveTo(setP)} onPreviewChange={vi.fn()} />;
    };
    render(<Harness />);
    fireEvent.change(await screen.findByLabelText('Effect for “Who talk say” at 0:01.0'), { target: { value: 'curve' } });
    await waitFor(() => expect(lyricVideoApi.effects).toHaveBeenCalledTimes(2));
  });
  it('tells repeated lines apart by when they start', async () => {
    const chorus = { ...project, lines: [
      { ...line('l1', 'My time no late'), start: 84.2, words: [{ text: 'My', start: 84.2, end: 85 }], end: 85 },
      { ...line('l2', 'My time no late'), start: 100, words: [{ text: 'My', start: 100, end: 101 }], end: 101 },
    ] } as unknown as LyricProject;
    render(<LineEffects project={chorus} save={saveTo(vi.fn())} onPreviewChange={vi.fn()} />);
    expect(await screen.findByLabelText('Effect for “My time no late” at 1:24.2')).toBeTruthy();
    expect(screen.getByLabelText('Effect for “My time no late” at 1:40.0')).toBeTruthy();
  });
  it('says why a change failed, leaves the preview alone and shows the saved choice again', async () => {
    vi.mocked(lyricVideoApi.patchLine).mockRejectedValue(new Error('Could not save that.'));
    const onPreviewChange = vi.fn();
    render(<LineEffects project={project} save={saveTo(vi.fn())} onPreviewChange={onPreviewChange} />);
    const select = await screen.findByLabelText('Effect for “Who talk say” at 0:01.0') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'pop' } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not save that.'));
    expect(onPreviewChange).not.toHaveBeenCalled();
    await waitFor(() => expect(select.value).toBe('auto'));
    expect(select.closest('li')?.getAttribute('aria-busy')).toBeNull();
  });
});

describe('ShuffleButton', () => {
  it('saves a new mix and confirms it', async () => {
    const shuffled = { ...project, look: { ...project.look, seed: nextSeed(1) } } as LyricProject;
    vi.mocked(lyricVideoApi.setLook).mockResolvedValue(shuffled);
    const onChange = vi.fn(); const onPreviewChange = vi.fn();
    render(<ShuffleButton project={project} save={saveTo(onChange)} onPreviewChange={onPreviewChange} />);
    fireEvent.click(screen.getByRole('button', { name: /shuffle effects/i }));
    await waitFor(() => expect(lyricVideoApi.setLook).toHaveBeenCalledWith('lv_1', { seed: nextSeed(1) }));
    expect(await screen.findByText('✓ Shuffled')).toBeTruthy();
    expect(onChange).toHaveBeenCalledWith(shuffled);
    expect(onPreviewChange).toHaveBeenCalled();
  });
  it('announces its progress to screen readers and explains itself', async () => {
    vi.mocked(lyricVideoApi.setLook).mockResolvedValue(project);
    render(<ShuffleButton project={project} save={saveTo(vi.fn())} onPreviewChange={vi.fn()} />);
    expect(screen.getByText('Changes the effects on lines set to Auto. Your own choices stay.')).toBeTruthy();
    const status = screen.getByRole('status');
    fireEvent.click(screen.getByRole('button', { name: /shuffle effects/i }));
    expect(await screen.findByText('✓ Shuffled')).toBeTruthy();
    expect(status.textContent).toBe('✓ Shuffled');
  });
  it('clears the confirmation after a moment', async () => {
    vi.mocked(lyricVideoApi.setLook).mockResolvedValue(project);
    render(<ShuffleButton project={project} save={saveTo(vi.fn())} onPreviewChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /shuffle effects/i }));
    await screen.findByText('✓ Shuffled');
    await waitFor(() => expect(screen.queryByText('✓ Shuffled')).toBeNull(), { timeout: 2500 });
  });
  it('says why it failed and does not redraw', async () => {
    vi.mocked(lyricVideoApi.setLook).mockRejectedValue(new Error('Could not shuffle.'));
    const onPreviewChange = vi.fn();
    render(<ShuffleButton project={project} save={saveTo(vi.fn())} onPreviewChange={onPreviewChange} />);
    fireEvent.click(screen.getByRole('button', { name: /shuffle effects/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not shuffle.'));
    expect(onPreviewChange).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: /shuffle effects/i }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('keeps keyboard focus on the button while it shuffles, and ignores a second press', async () => {
    let release: () => void = () => undefined;
    vi.mocked(lyricVideoApi.setLook).mockImplementation(() => new Promise((r) => { release = () => r(project); }));
    render(<ShuffleButton project={project} save={saveTo(vi.fn())} onPreviewChange={vi.fn()} />);
    const button = screen.getByRole('button', { name: /shuffle effects/i }) as HTMLButtonElement;
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByText('Shuffling…')).toBeTruthy();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    release();
    expect(await screen.findByText('✓ Shuffled')).toBeTruthy();
    expect(lyricVideoApi.setLook).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(button);
  });
  it('nextSeed never repeats and never returns 1', () => {
    for (const s of [1, 2, 50, 99_999]) { expect(nextSeed(s)).not.toBe(s); expect(nextSeed(s)).toBeGreaterThanOrEqual(2); }
  });
});
