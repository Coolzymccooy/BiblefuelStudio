import type { ReactNode } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

describe('StudioEffectsControls shuffle feedback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const renderControls = (props: Partial<Parameters<typeof StudioEffectsControls>[0]> = {}) =>
    render(
      <StudioEffectsControls look="studio-lagos-night" energy="lively" onEnergyChange={vi.fn()} onShuffle={vi.fn()} {...props} />,
    );
  const shuffleButton = () => screen.getByRole('button', { name: /shuffle effects|shuffled/i });

  it('shows no mix line before Shuffle is pressed', () => {
    renderControls();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/new effect mix/i)).toBeNull();
    expect(shuffleButton()).toHaveTextContent('Shuffle effects');
  });

  it('the first press calls onShuffle and announces mix 2', () => {
    const onShuffle = vi.fn();
    renderControls({ onShuffle });
    fireEvent.click(shuffleButton());
    expect(onShuffle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(
      "New effect mix (mix 2) — you'll see it on your next render.",
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('each further press counts up and the line stays', () => {
    vi.useFakeTimers();
    const onShuffle = vi.fn();
    renderControls({ onShuffle });
    fireEvent.click(shuffleButton());
    fireEvent.click(shuffleButton());
    expect(onShuffle).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('(mix 3)');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('(mix 3)');
  });

  it('shows a tick on the button, then reverts after about 1.2 seconds', () => {
    vi.useFakeTimers();
    renderControls();
    fireEvent.click(shuffleButton());
    expect(shuffleButton()).toHaveTextContent('✓ Shuffled');
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(shuffleButton()).toHaveTextContent('✓ Shuffled');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(shuffleButton()).toHaveTextContent('Shuffle effects');
  });

  it('a second press restarts the tick timer', () => {
    vi.useFakeTimers();
    renderControls();
    fireEvent.click(shuffleButton());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(shuffleButton());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(shuffleButton()).toHaveTextContent('✓ Shuffled');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(shuffleButton()).toHaveTextContent('Shuffle effects');
  });

  it('resets the line and the tick when the chosen look changes', () => {
    const { rerender } = renderControls();
    fireEvent.click(shuffleButton());
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<StudioEffectsControls look="studio-gospel-gold" energy="lively" onEnergyChange={vi.fn()} onShuffle={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(shuffleButton()).toHaveTextContent('Shuffle effects');
    fireEvent.click(shuffleButton());
    expect(screen.getByRole('status')).toHaveTextContent('(mix 2)');
  });

  it('does nothing when disabled', () => {
    const onShuffle = vi.fn();
    renderControls({ onShuffle, disabled: true });
    fireEvent.click(shuffleButton());
    expect(onShuffle).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(shuffleButton()).toHaveTextContent('Shuffle effects');
  });

  it('clears its timer on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = renderControls();
    fireEvent.click(shuffleButton());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
