import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../../lib/api';
import { StoryCaptionsPanel } from '../StoryCaptionsPanel';
import type { StoryCaptionSettings } from '../../../lib/storyTypes';

const catalogue = {
  ok: true,
  data: {
    ok: true,
    animations: [{ id: 'pop-in', label: 'Pop in', renderable: true }, { id: 'blur-rise', label: 'Blur rise', renderable: false }],
    motions: [
      { id: 'words', label: 'Word by word' },
      { id: 'lines', label: 'Line by line' },
      { id: 'block', label: 'Whole block' },
    ],
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'get').mockResolvedValue(catalogue as any);
});

const show = (value: StoryCaptionSettings = {}) => {
  const onChange = vi.fn();
  render(<StoryCaptionsPanel value={value} onChange={onChange} />);
  return onChange;
};

describe('StoryCaptionsPanel', () => {
  it('offers the server motion catalogue and patches only the field that changed', async () => {
    const user = userEvent.setup();
    const onChange = show({ captions: 'kinetic', captionPreset: 'cinematic-default' });
    await screen.findByRole('combobox', { name: 'Caption motion' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Caption motion' }), 'block');
    expect(onChange).toHaveBeenCalledWith({ captionMotion: 'block' });
  });

  it('marks preview-only animations so they are not picked for a render by mistake', async () => {
    show({ captions: 'kinetic' });
    await waitFor(() => expect(screen.getByRole('option', { name: /Blur rise/ })).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Blur rise (preview-only)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Pop in' })).toBeInTheDocument();
  });

  it('hides the look and timing controls when captions are off', async () => {
    show({ captions: 'none' });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByRole('combobox', { name: 'Caption motion' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Text layout' })).not.toBeInTheDocument();
  });

  it('turning captions back on asks for word-synced captions', async () => {
    const user = userEvent.setup();
    const onChange = show({ captions: 'none' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Captions' }), 'on');
    expect(onChange).toHaveBeenCalledWith({ captions: 'kinetic' });
  });

  it('keeps a legacy static project on static rather than silently changing its look', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // The real page persists the patch and re-renders from the REFETCHED
    // project, so 'off' really does overwrite 'static' in `value`. A test that
    // holds `value` still would pass even with the old, broken derivation.
    function Host() {
      const [settings, setSettings] = useState<StoryCaptionSettings>({ captions: 'static' });
      return (
        <StoryCaptionsPanel
          value={settings}
          onChange={(patch) => { onChange(patch); setSettings((s) => ({ ...s, ...patch })); }}
        />
      );
    }
    render(<Host />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Captions' }), 'none');
    expect(onChange).toHaveBeenLastCalledWith({ captions: 'none' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Captions' }), 'on');
    expect(onChange).toHaveBeenLastCalledWith({ captions: 'static' });
  });

  it('offers highlighting only where a whole line is on screen', async () => {
    const { rerender } = render(<StoryCaptionsPanel value={{ captions: 'kinetic', captionMotion: 'words' }} onChange={vi.fn()} />);
    await screen.findByRole('combobox', { name: 'Caption motion' });
    expect(screen.queryByLabelText(/Highlight each word/)).not.toBeInTheDocument();
    rerender(<StoryCaptionsPanel value={{ captions: 'kinetic', captionMotion: 'lines' }} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/Highlight each word/)).toBeInTheDocument();
  });

  it('shows a legacy static project the motion it actually renders with', async () => {
    show({ captions: 'static' });
    // buildStoryCaptions resolves a motion-less 'static' project to per-line
    // captions; the picker must not claim it renders word by word.
    const select = await screen.findByRole('combobox', { name: 'Caption motion' });
    expect((select as HTMLSelectElement).value).toBe('lines');
  });

  it('offers layered depth only where the renderer draws a ghost', async () => {
    const { rerender } = render(<StoryCaptionsPanel value={{ captions: 'kinetic', captionMotion: 'lines' }} onChange={vi.fn()} />);
    await screen.findByRole('combobox', { name: 'Caption motion' });
    // Only buildWordDrawtext draws the ghost — in line/block modes the
    // setting would have been a toggle that changed nothing.
    expect(screen.queryByLabelText(/Layered depth/)).not.toBeInTheDocument();
    rerender(<StoryCaptionsPanel value={{ captions: 'kinetic', captionMotion: 'words' }} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/Layered depth/)).toBeInTheDocument();
  });

  it('sends layered depth as the catalogue value the renderer understands', async () => {
    const user = userEvent.setup();
    const onChange = show({ captions: 'kinetic', captionDepth: 'none' });
    await user.click(screen.getByLabelText(/Layered depth/));
    expect(onChange).toHaveBeenCalledWith({ captionDepth: 'soft' });
  });

  it('still shows the classic presets when the catalogue cannot be loaded', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: false, error: 'offline' } as any);
    show({ captions: 'kinetic' });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getByRole('combobox', { name: 'Caption animation' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cinematic (default)' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Caption motion' })).not.toBeInTheDocument();
  });
});

const studioCatalogue = {
  ok: true,
  animations: [{ id: 'karaoke-pop', label: 'Karaoke pop', renderable: true }],
  motions: [{ id: 'words', label: 'Per word' }, { id: 'lines', label: 'Per line' }],
  studioLooks: [{ id: 'studio-lagos-night', label: 'Lagos Night', description: 'Yellow brush hits' }],
  energies: [{ id: 'calm', label: 'Calm' }, { id: 'lively', label: 'Lively' }, { id: 'wild', label: 'Wild' }],
  libass: true,
};

const mockCatalogue = (data: Record<string, unknown>) => {
  vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data } as any);
};

describe('StoryCaptionsPanel Studio effects', () => {
  it('lists Studio effects looks in the animation picker', async () => {
    mockCatalogue(studioCatalogue);
    show({ captions: 'kinetic', captionPreset: 'cinematic-default' });
    expect(await screen.findByRole('option', { name: 'Lagos Night' })).toBeInTheDocument();
  });

  it('a Studio look swaps motion/layout/depth for Energy and Shuffle', async () => {
    const user = userEvent.setup();
    mockCatalogue(studioCatalogue);
    const onChange = show({ captions: 'kinetic', captionPreset: 'studio-lagos-night', captionSeed: 3 });
    const energy = await screen.findByRole('combobox', { name: 'Energy' });
    expect(screen.queryByRole('combobox', { name: 'Caption motion' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Text layout' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Layered depth/)).not.toBeInTheDocument();
    expect(energy).toHaveValue('lively');
    await user.selectOptions(energy, 'wild');
    expect(onChange).toHaveBeenCalledWith({ captionEnergy: 'wild' });
    await user.click(screen.getByRole('button', { name: /shuffle/i }));
    const seed = onChange.mock.calls.at(-1)![0].captionSeed;
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).not.toBe(3);
  });

  it('Shuffle never re-picks the current seed', async () => {
    const user = userEvent.setup();
    mockCatalogue(studioCatalogue);
    const random = vi.spyOn(Math, 'random').mockReturnValue(3 / 2147483647);
    try {
      const onChange = show({ captions: 'kinetic', captionPreset: 'studio-lagos-night', captionSeed: 3 });
      await user.click(await screen.findByRole('button', { name: /shuffle/i }));
      expect(onChange).toHaveBeenLastCalledWith({ captionSeed: 4 });
    } finally {
      random.mockRestore();
    }
  });

  it('shows a saved Studio look and a usable Energy picker before the catalogue loads', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: false, error: 'offline' } as any);
    show({ captions: 'kinetic', captionPreset: 'studio-lagos-night' });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const animation = screen.getByRole('combobox', { name: 'Caption animation' });
    expect(animation).toHaveValue('studio-lagos-night');
    expect(screen.getByRole('option', { name: 'Lagos Night' })).toBeInTheDocument();
    const energy = screen.getByRole('combobox', { name: 'Energy' });
    expect(energy).toHaveValue('lively');
    expect(within(energy).getAllByRole('option')).toHaveLength(3);
  });

  it('a Studio look offers an optional title intro, saved when the field loses focus', async () => {
    const user = userEvent.setup();
    mockCatalogue(studioCatalogue);
    const onChange = show({ captions: 'kinetic', captionPreset: 'studio-lagos-night', captionTitle: 'Old' });
    const field = await screen.findByRole('textbox', { name: 'Title intro' });
    expect(field).toHaveValue('Old');
    await user.clear(field);
    await user.type(field, 'Hold My Hand');
    expect(onChange).not.toHaveBeenCalledWith({ captionTitle: 'Hold My Hand' });
    await user.tab();
    expect(onChange).toHaveBeenCalledWith({ captionTitle: 'Hold My Hand' });
  });

  it('a title that only gained spaces is tidied on screen and not saved again', async () => {
    const user = userEvent.setup();
    mockCatalogue(studioCatalogue);
    const onChange = show({ captions: 'kinetic', captionPreset: 'studio-lagos-night', captionTitle: 'Hold' });
    const field = await screen.findByRole('textbox', { name: 'Title intro' });
    await user.clear(field);
    await user.type(field, '  Hold  ');
    await user.tab();
    expect(field).toHaveValue('Hold');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ordinary looks have no title intro', async () => {
    mockCatalogue(studioCatalogue);
    show({ captions: 'kinetic', captionPreset: 'cinematic-default' });
    await screen.findByRole('option', { name: 'Lagos Night' });
    expect(screen.queryByRole('textbox', { name: 'Title intro' })).not.toBeInTheDocument();
  });

  it('plays a sample clip of the chosen Studio look', async () => {
    mockCatalogue(studioCatalogue);
    const { container } = render(<StoryCaptionsPanel value={{ captions: 'kinetic', captionPreset: 'studio-lagos-night' }} onChange={vi.fn()} />);
    await screen.findByRole('combobox', { name: 'Energy' });
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.getAttribute('src')).toBe('/studio-looks/lagos-night.mp4');
    expect(video!.muted).toBe(true);
  });

  it('hides the sample clip when it fails to load', async () => {
    mockCatalogue(studioCatalogue);
    const { container } = render(<StoryCaptionsPanel value={{ captions: 'kinetic', captionPreset: 'studio-lagos-night' }} onChange={vi.fn()} />);
    await screen.findByRole('combobox', { name: 'Energy' });
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    fireEvent.error(video!);
    expect(container.querySelector('video')).toBeNull();
  });

  it('shows no sample clip for ordinary looks', async () => {
    mockCatalogue(studioCatalogue);
    const { container } = render(<StoryCaptionsPanel value={{ captions: 'kinetic', captionPreset: 'cinematic-default' }} onChange={vi.fn()} />);
    await screen.findByRole('option', { name: 'Lagos Night' });
    expect(container.querySelector('video')).toBeNull();
  });

  it('Studio looks are unavailable when the server has no libass', async () => {
    mockCatalogue({ ...studioCatalogue, libass: false });
    show({ captions: 'kinetic', captionPreset: 'cinematic-default' });
    const opt = await screen.findByRole('option', { name: /Lagos Night/ });
    expect(opt).toBeDisabled();
    expect(opt.textContent).toMatch(/unavailable/i);
  });

  it('a saved Studio look on a server without libass shows disabled controls and says why', async () => {
    mockCatalogue({ ...studioCatalogue, libass: false });
    show({ captions: 'kinetic', captionPreset: 'studio-lagos-night' });
    expect(await screen.findByText(/Studio effects unavailable on this server/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Energy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /shuffle effects/i })).toBeDisabled();
  });
});

describe('StoryCaptionsPanel caption animation select', () => {
  it('a new project ("default") shows Cinematic (default), not the first option, and no Energy control', async () => {
    mockCatalogue(studioCatalogue);
    show({ captions: 'kinetic', captionPreset: 'default' });
    await screen.findByRole('option', { name: 'Lagos Night' });
    const select = screen.getByRole('combobox', { name: 'Caption animation' });
    expect(select).toHaveValue('cinematic-default');
    expect(within(select).getByRole('option', { name: 'Cinematic (default)' })).toHaveProperty('selected', true);
    expect(screen.queryByRole('combobox', { name: 'Energy' })).not.toBeInTheDocument();
  });

  it('"default" is Cinematic (default) before the catalogue has loaded too', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: false, error: 'offline' } as any);
    show({ captions: 'kinetic', captionPreset: 'default' });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getByRole('combobox', { name: 'Caption animation' })).toHaveValue('cinematic-default');
  });

  it('a value that is not among the options shows Cinematic (default) once the catalogue has loaded', async () => {
    mockCatalogue(studioCatalogue);
    show({ captions: 'kinetic', captionPreset: 'retired-preset' });
    await screen.findByRole('option', { name: 'Lagos Night' });
    expect(screen.getByRole('combobox', { name: 'Caption animation' })).toHaveValue('cinematic-default');
  });

  it('keeps a catalogue animation and a classic preset selected', async () => {
    mockCatalogue(studioCatalogue);
    const { unmount } = render(<StoryCaptionsPanel value={{ captions: 'kinetic', captionPreset: 'karaoke-pop' }} onChange={vi.fn()} />);
    await screen.findByRole('option', { name: 'Lagos Night' });
    expect(screen.getByRole('combobox', { name: 'Caption animation' })).toHaveValue('karaoke-pop');
    unmount();
    render(<StoryCaptionsPanel value={{ captions: 'kinetic', captionPreset: 'playful-pop' }} onChange={vi.fn()} />);
    await screen.findByRole('option', { name: 'Lagos Night' });
    expect(screen.getByRole('combobox', { name: 'Caption animation' })).toHaveValue('playful-pop');
  });
});
