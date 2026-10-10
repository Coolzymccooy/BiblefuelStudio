import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../lib/api';
import { RenderLab, type RenderLabEmbed } from '../RenderPage';

/**
 * The Render lab EMBEDDED in the Timeline's Output tool. Pins that every
 * classic render panel is reachable as a sub-tab and that the host's seeds
 * only fill EMPTY state.
 */

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { ok: true, animations: [], motions: [], items: [], jobs: [], files: [] } } as any);
});

function setup(over: Partial<RenderLabEmbed> = {}) {
  const embedded: RenderLabEmbed = { ...over };
  render(
    <MemoryRouter>
      <RenderLab embedded={embedded} />
    </MemoryRouter>,
  );
  return embedded;
}

describe('RenderLab (embedded in the Timeline editor)', () => {
  it('docks every classic render panel as a sub-tab', () => {
    setup();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent?.trim());
    expect(tabs).toEqual(expect.arrayContaining(['Captions', 'Visuals', 'Audio', 'Output', 'Share']));
  });

  it('seeds caption lines from the host only when the lab has none', () => {
    setup({ seedLines: 'You are more than just your struggles.' });
    expect(screen.getByDisplayValue('You are more than just your struggles.')).toBeInTheDocument();
  });

  it('keeps its own persisted lines over the host seed', () => {
    localStorage.setItem('BF_RENDER_LINES', JSON.stringify('Mine, already written.'));
    setup({ seedLines: 'Host seed.' });
    expect(screen.getByDisplayValue('Mine, already written.')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Host seed.')).not.toBeInTheDocument();
  });

  it('Output tab carries frame, duration, caption width and delivery - nothing left on the classic page', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: 'Output' }));
    expect(screen.getByText(/Output frame/i)).toBeInTheDocument();
    expect(screen.getByText(/^Duration/i)).toBeInTheDocument();
    expect(screen.getByText(/Caption width/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /render a waveform video/i })).toBeInTheDocument();
  });

  it('reports the Studio energy and seed to the host with the caption style', async () => {
    const user = userEvent.setup();
    localStorage.setItem('BF_RENDER_TYPOGRAPHY_PRESET', JSON.stringify('studio-lagos-night'));
    localStorage.setItem('BF_RENDER_CAPTION_ENERGY', JSON.stringify('lively'));
    localStorage.setItem('BF_RENDER_CAPTION_SEED', JSON.stringify(7));
    const onCaptionStyleChange = vi.fn();
    setup({ onCaptionStyleChange });
    expect(onCaptionStyleChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ preset: 'studio-lagos-night', captionEnergy: 'lively', captionSeed: 7 }),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Energy' }), 'wild');
    expect(onCaptionStyleChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ captionEnergy: 'wild', captionSeed: 7 }),
    );
    await user.click(screen.getByRole('button', { name: /shuffle effects/i }));
    const last = onCaptionStyleChange.mock.calls.at(-1)![0];
    expect(last.captionSeed).not.toBe(7);
    expect(last.captionEnergy).toBe('wild');
  });

  it('a corrupt stored energy or seed falls back to Lively and a fresh seed', () => {
    localStorage.setItem('BF_RENDER_TYPOGRAPHY_PRESET', JSON.stringify('studio-lagos-night'));
    localStorage.setItem('BF_RENDER_CAPTION_ENERGY', JSON.stringify('loud'));
    localStorage.setItem('BF_RENDER_CAPTION_SEED', JSON.stringify('abc'));
    const onCaptionStyleChange = vi.fn();
    setup({ onCaptionStyleChange });
    const last = onCaptionStyleChange.mock.calls.at(-1)![0];
    expect(last.captionEnergy).toBe('lively');
    expect(Number.isInteger(last.captionSeed)).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Energy' })).toHaveValue('lively');
  });
});
