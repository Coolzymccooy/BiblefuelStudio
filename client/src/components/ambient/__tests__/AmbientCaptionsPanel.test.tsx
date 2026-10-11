import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AmbientCaptionsPanel } from '../AmbientCaptionsPanel';
import { api } from '../../../lib/api';

type PanelValue = {
  captions?: string; captionSpan?: 'spoken' | 'section'; captionPosition?: 'lower' | 'centre';
  captionPreset?: string; captionEnergy?: string; captionSeed?: number;
};

const studioCatalogue = {
  ok: true,
  studioLooks: [{ id: 'studio-lagos-night', label: 'Lagos Night', description: 'Yellow brush hits' }],
  energies: [{ id: 'calm', label: 'Calm' }, { id: 'lively', label: 'Lively' }, { id: 'wild', label: 'Wild' }],
  libass: true,
};

const mockCatalogue = (data: Record<string, unknown>) => {
  vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data } as never);
};

beforeEach(() => {
  vi.restoreAllMocks();
  mockCatalogue(studioCatalogue);
});

const setup = (value: PanelValue, busy = false) => {
  const onChange = vi.fn();
  render(<AmbientCaptionsPanel value={value} onChange={onChange} busy={busy} />);
  return onChange;
};

describe('AmbientCaptionsPanel', () => {
  it('offers exactly what the ambient render does — no controls that change nothing', () => {
    setup({ captions: 'static', captionSpan: 'section', captionPosition: 'lower' });
    expect(screen.getByText('Scripture on screen')).toBeInTheDocument();
    for (const name of ['Off', 'While spoken', 'Whole section', 'Lower third', 'Centre']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    // Story's controls: the ambient renderer reads none of them.
    expect(screen.queryByText(/caption motion/i)).toBeNull();
    expect(screen.queryByText(/stagger/i)).toBeNull();
    expect(screen.queryByText(/highlight each word/i)).toBeNull();
  });

  it('marks the current choice', () => {
    setup({ captions: 'static', captionSpan: 'section', captionPosition: 'centre' });
    expect(screen.getByRole('button', { name: 'Whole section' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Centre' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a project saved before the choice existed reads as While spoken — what it renders', () => {
    setup({ captions: 'static' });
    expect(screen.getByRole('button', { name: 'While spoken' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Off turns captions off; the others turn them on with that span', async () => {
    const onChange = setup({ captions: 'static', captionSpan: 'section' });
    await userEvent.click(screen.getByRole('button', { name: 'Off' }));
    expect(onChange).toHaveBeenLastCalledWith({ captions: 'none' });
    await userEvent.click(screen.getByRole('button', { name: 'While spoken' }));
    expect(onChange).toHaveBeenLastCalledWith({ captions: 'static', captionSpan: 'spoken' });
  });

  it('position is hidden while captions are off', () => {
    setup({ captions: 'none' });
    expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Centre' })).toBeNull();
  });

  it('changing position sends only the position', async () => {
    const onChange = setup({ captions: 'static', captionSpan: 'section', captionPosition: 'lower' });
    await userEvent.click(screen.getByRole('button', { name: 'Centre' }));
    expect(onChange).toHaveBeenLastCalledWith({ captionPosition: 'centre' });
  });
});

describe('AmbientCaptionsPanel — caption look', () => {
  it('shows Classic serif for the default preset', async () => {
    setup({ captions: 'static', captionPreset: 'default' });
    const look = await screen.findByRole('combobox', { name: 'Caption look' });
    expect(look).toHaveValue('default');
    expect(within(look).getByRole('option', { name: 'Classic serif' })).toBeInTheDocument();
    await screen.findByRole('option', { name: 'Lagos Night' });
  });

  it('an unknown or Story-only preset reads as Classic serif — the ambient render ignores it', async () => {
    setup({ captions: 'static', captionPreset: 'cinematic-default' });
    expect(await screen.findByRole('combobox', { name: 'Caption look' })).toHaveValue('default');
  });

  it('choosing a Studio look sends it with a fresh seed when none was set', async () => {
    const onChange = setup({ captions: 'static', captionPreset: 'default' });
    const look = await screen.findByRole('combobox', { name: 'Caption look' });
    await screen.findByRole('option', { name: 'Lagos Night' });
    await userEvent.selectOptions(look, 'studio-lagos-night');
    expect(onChange).toHaveBeenLastCalledWith({
      captionPreset: 'studio-lagos-night', captionSeed: expect.any(Number),
    });
  });

  it('keeps an existing seed when switching look', async () => {
    const onChange = setup({ captions: 'static', captionPreset: 'default', captionSeed: 7 });
    const look = await screen.findByRole('combobox', { name: 'Caption look' });
    await screen.findByRole('option', { name: 'Lagos Night' });
    await userEvent.selectOptions(look, 'studio-lagos-night');
    expect(onChange).toHaveBeenLastCalledWith({ captionPreset: 'studio-lagos-night' });
  });

  it('going back to Classic serif sends only the preset', async () => {
    const onChange = setup({ captions: 'static', captionPreset: 'studio-lagos-night', captionSeed: 7 });
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Caption look' }), 'default');
    expect(onChange).toHaveBeenLastCalledWith({ captionPreset: 'default' });
  });

  it('a Studio look shows its sample, Energy (calm unless set) and Shuffle, and hides Position', async () => {
    const { container } = render(
      <AmbientCaptionsPanel value={{ captions: 'static', captionPreset: 'studio-lagos-night', captionSeed: 3 }} onChange={vi.fn()} busy={false} />,
    );
    const energy = await screen.findByRole('combobox', { name: 'Energy' });
    expect(energy).toHaveValue('calm');
    expect(screen.getByRole('button', { name: /shuffle/i })).toBeInTheDocument();
    expect(container.querySelector('video')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Centre' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lower third' })).toBeNull();
    // Span still applies to a Studio look.
    expect(screen.getByRole('button', { name: 'Whole section' })).toBeInTheDocument();
  });

  it('Energy sends only the energy; Shuffle sends a different seed', async () => {
    const onChange = setup({ captions: 'static', captionPreset: 'studio-lagos-night', captionSeed: 3, captionEnergy: 'lively' });
    const energy = await screen.findByRole('combobox', { name: 'Energy' });
    expect(energy).toHaveValue('lively');
    await userEvent.selectOptions(energy, 'wild');
    expect(onChange).toHaveBeenLastCalledWith({ captionEnergy: 'wild' });
    await userEvent.click(screen.getByRole('button', { name: /shuffle/i }));
    const patch = onChange.mock.calls.at(-1)![0];
    expect(Object.keys(patch)).toEqual(['captionSeed']);
    expect(Number.isInteger(patch.captionSeed)).toBe(true);
    expect(patch.captionSeed).not.toBe(3);
  });

  it('Classic serif keeps Position and shows no Studio controls', async () => {
    setup({ captions: 'static', captionPreset: 'default' });
    await screen.findByRole('combobox', { name: 'Caption look' });
    expect(screen.getByRole('button', { name: 'Centre' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Energy' })).toBeNull();
    expect(screen.queryByRole('button', { name: /shuffle/i })).toBeNull();
  });

  it('without libass the Studio looks are disabled and the unavailable note shows', async () => {
    mockCatalogue({ ...studioCatalogue, libass: false });
    setup({ captions: 'static', captionPreset: 'studio-lagos-night' });
    expect(await screen.findByText(/Studio effects unavailable on this server/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Energy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /shuffle effects/i })).toBeDisabled();
    expect(screen.getByRole('option', { name: /Lagos Night/ })).toBeDisabled();
  });

  it('a saved Studio look and an Energy picker are usable before the catalogue loads', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: false, error: 'offline' } as never);
    setup({ captions: 'static', captionPreset: 'studio-lagos-night' });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getByRole('combobox', { name: 'Caption look' })).toHaveValue('studio-lagos-night');
    expect(within(screen.getByRole('combobox', { name: 'Energy' })).getAllByRole('option')).toHaveLength(3);
  });

  it('no Caption look while captions are off', async () => {
    setup({ captions: 'none', captionPreset: 'studio-lagos-night' });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByRole('combobox', { name: 'Caption look' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Energy' })).toBeNull();
  });

  it('every new control is disabled while busy', async () => {
    setup({ captions: 'static', captionPreset: 'studio-lagos-night' }, true);
    expect(await screen.findByRole('combobox', { name: 'Caption look' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Energy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /shuffle effects/i })).toBeDisabled();
  });
});
