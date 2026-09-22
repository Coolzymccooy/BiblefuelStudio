import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    const onChange = show({ captions: 'static' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Captions' }), 'none');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Captions' }), 'on');
    // Off then on is a round trip: the stored 'static' is still what renders.
    expect(onChange).toHaveBeenLastCalledWith({ captions: 'static' });
  });

  it('offers highlighting only where a whole line is on screen', async () => {
    const { rerender } = render(<StoryCaptionsPanel value={{ captions: 'kinetic', captionMotion: 'words' }} onChange={vi.fn()} />);
    await screen.findByRole('combobox', { name: 'Caption motion' });
    expect(screen.queryByLabelText(/Highlight each word/)).not.toBeInTheDocument();
    rerender(<StoryCaptionsPanel value={{ captions: 'kinetic', captionMotion: 'lines' }} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/Highlight each word/)).toBeInTheDocument();
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
