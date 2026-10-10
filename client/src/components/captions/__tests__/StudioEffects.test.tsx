import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudioLookOptions, StudioEffectsControls } from '../StudioEffects';

const LOOKS = [{ id: 'studio-lagos-night', label: 'Lagos Night' }];

const inSelect = (ui: ReactNode, value = '') =>
  render(<select aria-label="Style" value={value} onChange={() => {}}><option value="">None</option>{ui}</select>);

describe('StudioLookOptions', () => {
  it('lists the looks under "Studio effects"', () => {
    const { container } = inSelect(<StudioLookOptions looks={LOOKS} libass />);
    expect(container.querySelector('optgroup[label="Studio effects"]')).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Lagos Night' })).not.toBeDisabled();
  });

  it('disables the looks where the server has no libass', () => {
    inSelect(<StudioLookOptions looks={LOOKS} libass={false} />);
    expect(screen.getByRole('option', { name: /Lagos Night \(unavailable on this server\)/ })).toBeDisabled();
  });

  it('keeps a saved look selectable before the catalogue loads', () => {
    inSelect(<StudioLookOptions looks={[]} libass value="studio-gospel-gold" />, 'studio-gospel-gold');
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveValue('studio-gospel-gold');
    expect(screen.getByRole('option', { name: 'Gospel Gold' })).toBeInTheDocument();
  });

  it('renders nothing with no looks and no saved look', () => {
    const { container } = inSelect(<StudioLookOptions looks={[]} libass value="hero-bold" />);
    expect(container.querySelector('optgroup')).toBeNull();
  });
});

describe('StudioEffectsControls', () => {
  it('plays the look sample and hides it if it fails to load', () => {
    const { container } = render(
      <StudioEffectsControls look="studio-lagos-night" energy="lively" onEnergyChange={vi.fn()} onShuffle={vi.fn()} />,
    );
    const video = container.querySelector('video')!;
    expect(video.getAttribute('src')).toBe('/studio-looks/lagos-night.mp4');
    fireEvent.error(video);
    expect(container.querySelector('video')).toBeNull();
  });

  it('reports an energy change and a shuffle', async () => {
    const user = userEvent.setup();
    const onEnergyChange = vi.fn();
    const onShuffle = vi.fn();
    render(<StudioEffectsControls look="studio-lagos-night" energy="lively" onEnergyChange={onEnergyChange} onShuffle={onShuffle} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Energy' }), 'wild');
    expect(onEnergyChange).toHaveBeenCalledWith('wild');
    await user.click(screen.getByRole('button', { name: /shuffle effects/i }));
    expect(onShuffle).toHaveBeenCalled();
  });

  it('disables Energy and Shuffle when disabled', () => {
    render(<StudioEffectsControls look="studio-lagos-night" energy="lively" onEnergyChange={vi.fn()} onShuffle={vi.fn()} disabled />);
    expect(screen.getByRole('combobox', { name: 'Energy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /shuffle effects/i })).toBeDisabled();
  });

  it('when unavailable, disables the controls, says why and still plays the sample', () => {
    const { container } = render(
      <StudioEffectsControls look="studio-lagos-night" energy="lively" onEnergyChange={vi.fn()} onShuffle={vi.fn()} unavailable />,
    );
    expect(screen.getByRole('combobox', { name: 'Energy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /shuffle effects/i })).toBeDisabled();
    expect(
      screen.getByText("Studio effects unavailable on this server — renders use the look's standard style."),
    ).toBeInTheDocument();
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/studio-looks/lagos-night.mp4');
  });

  it('shows no unavailable line by default', () => {
    render(<StudioEffectsControls look="studio-lagos-night" energy="lively" onEnergyChange={vi.fn()} onShuffle={vi.fn()} />);
    expect(screen.queryByText(/Studio effects unavailable on this server/)).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Energy' })).not.toBeDisabled();
  });

  it('offers no Shuffle button when there is nothing to shuffle', () => {
    render(<StudioEffectsControls look="studio-lagos-night" energy="calm" onEnergyChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /shuffle effects/i })).toBeNull();
  });
});
