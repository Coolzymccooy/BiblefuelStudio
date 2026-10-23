import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RefineDialog } from '../RefineDialog';
import type { SceneScriptShot } from '../../../lib/sceneScriptTypes';

function shot(over: Partial<SceneScriptShot> = {}): SceneScriptShot {
  return {
    id: 'sh2', sceneId: 's1', startLineId: 'l1', offsetSec: 0, text: '', montage: false, framing: '', suggested: false,
    effectivePrompt: 'A lake', similar: [],
    clip: { status: 'done', url: '/clip.mp4', posterUrl: null, durationSec: 8 },
    refine: null,
    playback: { rate: 1, from: 0, to: 8, hold: 0, placeSec: 6 },
    ...over,
  };
}

describe('RefineDialog', () => {
  it('saves only what was changed, within the clip', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RefineDialog shot={shot()} busy={false} onSave={onSave} onClose={vi.fn()} />);
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Starts at'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByLabelText('Mirror left to right'));
    fireEvent.click(screen.getByRole('button', { name: 'Warm' }));
    fireEvent.change(screen.getByLabelText('Speed'), { target: { value: '0.75' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ in: 1.5, out: null, rate: 0.75, flip: true, zoom: 1, x: 0, y: 0, grade: 'warm' });
  });

  it('stays open with the edits when saving fails', async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();
    render(<RefineDialog shot={shot()} busy={false} onSave={onSave} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Mirror left to right'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Mirror left to right') as HTMLInputElement).checked).toBe(true);
  });

  it('an end at the far end of the slider is the end of the clip', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RefineDialog shot={shot({ clip: { status: 'done', url: '/c.mp4', posterUrl: null, durationSec: 5.04 } })} busy={false} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Ends at'), { target: { value: '5' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says when the clip is too short for its place and holds the last frame', () => {
    render(<RefineDialog shot={shot()} busy={false} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Starts at'), { target: { value: '6' } });
    expect(screen.getByText(/holds its last frame for/)).toBeTruthy();
  });

  it('keeps the end after the start', () => {
    render(<RefineDialog shot={shot()} busy={false} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Ends at'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Starts at'), { target: { value: '5' } });
    expect((screen.getByLabelText('Starts at') as HTMLInputElement).value).toBe('2.5');
  });

  it('moving the frame needs a zoom first', () => {
    render(<RefineDialog shot={shot()} busy={false} onSave={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByLabelText('Left or right') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '1.4' } });
    expect((screen.getByLabelText('Left or right') as HTMLInputElement).disabled).toBe(false);
  });

  it('resets a refined shot to the clip as made', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const refined = shot({ refine: { in: 1, out: null, rate: null, flip: true, zoom: 1, x: 0, y: 0, grade: 'mono' } });
    render(<RefineDialog shot={refined} busy={false} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null));
  });
});
