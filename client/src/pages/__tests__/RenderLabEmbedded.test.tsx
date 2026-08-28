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
});
