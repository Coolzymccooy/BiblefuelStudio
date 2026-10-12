import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudioLookOptions, StudioEffectsControls } from '../StudioEffects';
import { resetShuffleMixesForTests } from '../../../lib/shuffleMixes';

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

describe('StudioEffectsControls shuffle feedback', () => {
  beforeEach(() => {
    resetShuffleMixesForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  type Props = Parameters<typeof StudioEffectsControls>[0];
  const element = (props: Partial<Props> = {}) => (
    <StudioEffectsControls look="studio-lagos-night" energy="lively" seed={100} onEnergyChange={vi.fn()} onShuffle={vi.fn()} {...props} />
  );
  const shuffleButton = () => screen.getByRole('button', { name: /shuffle effects|shuffling|shuffled/i });
  const advance = (ms: number) => act(() => {
    vi.advanceTimersByTime(ms);
  });

  it('shows no mix line before Shuffle is pressed', () => {
    render(element());
    expect(screen.queryByRole('status')).toBeNull();
    expect(shuffleButton()).toHaveTextContent('Shuffle effects');
  });

  it('a press calls onShuffle and shows Shuffling... until the seed changes', () => {
    const onShuffle = vi.fn();
    render(element({ onShuffle }));
    fireEvent.click(shuffleButton());
    expect(onShuffle).toHaveBeenCalledTimes(1);
    expect(shuffleButton()).toHaveTextContent('Shuffling…');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('claims success only once the seed prop changes: tick, then mix 2', () => {
    const { rerender } = render(element());
    fireEvent.click(shuffleButton());
    rerender(element({ seed: 101 }));
    expect(shuffleButton()).toHaveTextContent('✓ Shuffled');
    expect(screen.getByRole('status')).toHaveTextContent("New effect mix (mix 2) — you'll see it on your next render.");
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('the tick reverts after about 1.2 seconds and the line stays', () => {
    vi.useFakeTimers();
    const { rerender } = render(element());
    fireEvent.click(shuffleButton());
    rerender(element({ seed: 101 }));
    advance(1100);
    expect(shuffleButton()).toHaveTextContent('✓ Shuffled');
    advance(200);
    expect(shuffleButton()).toHaveTextContent('Shuffle effects');
    advance(10000);
    expect(screen.getByRole('status')).toHaveTextContent('(mix 2)');
  });

  it('counts up on each saved shuffle', () => {
    const { rerender } = render(element());
    fireEvent.click(shuffleButton());
    rerender(element({ seed: 101 }));
    fireEvent.click(shuffleButton());
    rerender(element({ seed: 102 }));
    expect(screen.getByRole('status')).toHaveTextContent('(mix 3)');
  });

  it('a save that never lands shows no tick and no line, and the label returns after 8 seconds', () => {
    vi.useFakeTimers();
    const { rerender } = render(element());
    fireEvent.click(shuffleButton());
    advance(7900);
    expect(shuffleButton()).toHaveTextContent('Shuffling…');
    advance(200);
    expect(shuffleButton()).toHaveTextContent('Shuffle effects');
    expect(screen.queryByRole('status')).toBeNull();
    // A seed change long after the give-up is not credited to the abandoned press.
    rerender(element({ seed: 101 }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(shuffleButton()).toHaveTextContent('Shuffle effects');
  });

  it('a seed change nobody asked for is not announced', () => {
    const { rerender } = render(element());
    rerender(element({ seed: 555 }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(shuffleButton()).toHaveTextContent('Shuffle effects');
  });

  it('keeps the mix across a remount with the same look and seed', () => {
    const first = render(element());
    fireEvent.click(shuffleButton());
    first.rerender(element({ seed: 101 }));
    fireEvent.click(shuffleButton());
    first.rerender(element({ seed: 102 }));
    first.unmount();
    render(element({ seed: 102 }));
    expect(screen.getByRole('status')).toHaveTextContent('(mix 3)');
    expect(shuffleButton()).toHaveTextContent('Shuffle effects');
  });

  it('hides the line for a different look or a different seed', () => {
    const { rerender } = render(element());
    fireEvent.click(shuffleButton());
    rerender(element({ seed: 101 }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(element({ look: 'studio-gospel-gold', seed: 101 }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(shuffleButton()).toHaveTextContent('Shuffle effects');
    rerender(element({ seed: 999 }));
    expect(screen.queryByRole('status')).toBeNull();
    rerender(element({ seed: 101 }));
    expect(screen.getByRole('status')).toHaveTextContent('(mix 2)');
  });

  it('does nothing when disabled', () => {
    const onShuffle = vi.fn();
    render(element({ onShuffle, disabled: true }));
    fireEvent.click(shuffleButton());
    expect(onShuffle).not.toHaveBeenCalled();
    expect(shuffleButton()).toHaveTextContent('Shuffle effects');
  });

  it('clears its timers on unmount', () => {
    vi.useFakeTimers();
    const { rerender, unmount } = render(element());
    fireEvent.click(shuffleButton());
    expect(vi.getTimerCount()).toBe(1);
    rerender(element({ seed: 101 }));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
