import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import userEvent from '@testing-library/user-event';
import { MomentsStyleStep } from '../MomentsStyleStep';
import { momentsApi } from '../../../lib/momentsApi';
import * as errors from '../../../lib/errors';
import { ApiError } from '../../../lib/apiError';
import { META, mkMoment } from '../../../lib/__tests__/momentsFixtures';

beforeEach(() => vi.restoreAllMocks());
const props = (over = {}) => ({ project: mkMoment(over), meta: META, refresh: vi.fn(), busy: false, setBusy: vi.fn() });

/** Like the page: `busy` is real state that setBusy flips, so a disabled control really is disabled. */
function renderLive(project: ReturnType<typeof mkMoment>) {
  const refresh = vi.fn();
  function Host() {
    const [busy, setBusy] = useState(false);
    return <MomentsStyleStep project={project} meta={META} refresh={refresh} busy={busy} setBusy={setBusy} />;
  }
  render(<><Host /><Toaster /></>);
  return { refresh };
}

describe('MomentsStyleStep', () => {
  it('shows the four styles with looping previews and marks the current one', () => {
    render(<MomentsStyleStep {...props()} />);
    for (const name of ['Glow', 'Celebrate', 'Hype', 'Gallery']) expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /celebrate/i })).toHaveAttribute('aria-pressed', 'true');
    const video = document.querySelector('video[src="/moments/previews/glow.mp4"]');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('loop');
  });

  it('picking a style saves it', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    const p = props();
    render(<MomentsStyleStep {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /hype/i }));
    expect(update).toHaveBeenCalledWith('m1', { style: 'hype' });
    await waitFor(() => expect(p.refresh).toHaveBeenCalled());
  });

  it('Energy saves on release, as 0..1', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsStyleStep {...props()} />);
    const slider = screen.getByLabelText(/energy/i);
    fireEvent.change(slider, { target: { value: '25' } });
    expect(update).not.toHaveBeenCalled();
    fireEvent.mouseUp(slider);
    expect(update).toHaveBeenCalledWith('m1', { energy: 0.25 });
  });

  it('Energy also saves on touch release, key release and blur, once per change', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsStyleStep {...props()} />);
    const slider = screen.getByLabelText(/energy/i);
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.touchEnd(slider);
    fireEvent.keyUp(slider);
    fireEvent.blur(slider);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('m1', { energy: 0.4 });
    fireEvent.change(slider, { target: { value: '70' } });
    fireEvent.blur(slider);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenLastCalledWith('m1', { energy: 0.7 });
  });

  it('releasing Energy without changing it does not save', () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsStyleStep {...props()} />);
    fireEvent.mouseUp(screen.getByLabelText(/energy/i));
    expect(update).not.toHaveBeenCalled();
  });

  it('names the Energy level', () => {
    const { unmount } = render(<MomentsStyleStep {...props({ energy: 0.2 })} />);
    expect(screen.getByText(/energy: calm/i)).toBeInTheDocument();
    unmount();
    render(<MomentsStyleStep {...props({ energy: 0.5 })} />);
    expect(screen.getByText(/energy: lively/i)).toBeInTheDocument();
  });

  it('keeps the slider usable while its own save runs, so keyboard focus survives', async () => {
    let finish: (m: ReturnType<typeof mkMoment>) => void = () => {};
    vi.spyOn(momentsApi, 'update').mockReturnValue(new Promise((r) => { finish = r; }));
    renderLive(mkMoment());
    const slider = screen.getByLabelText(/energy/i);
    slider.focus();
    fireEvent.change(slider, { target: { value: '30' } });
    fireEvent.keyUp(slider);
    await waitFor(() => expect(screen.getByRole('button', { name: /hype/i })).toBeDisabled());
    expect(slider).not.toBeDisabled();
    expect(slider).toHaveFocus();
    finish(mkMoment());
  });

  it('a refetch does not overwrite an Energy value the user is setting', () => {
    vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    const p = props();
    const { rerender } = render(<MomentsStyleStep {...p} />);
    const slider = screen.getByLabelText(/energy/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '25' } });
    rerender(<MomentsStyleStep {...p} project={mkMoment({ energy: 0.8, updatedAt: 9 })} />);
    expect(slider.value).toBe('25');
  });

  it('length is 15, 30 or 60 seconds', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsStyleStep {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: '30 s' }));
    expect(update).toHaveBeenCalledWith('m1', { lengthSec: 30 });
  });

  it('marks the current length', () => {
    render(<MomentsStyleStep {...props({ lengthSec: 60 })} />);
    expect(screen.getByRole('button', { name: '60 s' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '15 s' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('a failed save shows the friendly error and re-enables the controls', async () => {
    vi.spyOn(momentsApi, 'update').mockRejectedValue(new ApiError('nope', 'QUOTA_EXCEEDED', {}));
    const toastError = vi.spyOn(errors, 'toastError').mockImplementation(() => {});
    renderLive(mkMoment());
    await userEvent.click(screen.getByRole('button', { name: /hype/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /hype/i })).not.toBeDisabled();
  });

  it('a failed Energy save rolls the slider back to the last saved value', async () => {
    vi.spyOn(momentsApi, 'update').mockRejectedValue(new Error('nope'));
    vi.spyOn(errors, 'toastError').mockImplementation(() => {});
    renderLive(mkMoment({ energy: 0.8 }));
    const slider = screen.getByLabelText(/energy/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '25' } });
    fireEvent.mouseUp(slider);
    await waitFor(() => expect(slider.value).toBe('80'));
    expect(screen.getByText(/energy: hype/i)).toBeInTheDocument();
  });

  it('previews load metadata only until played', () => {
    render(<MomentsStyleStep {...props()} />);
    expect(document.querySelector('video[src="/moments/previews/glow.mp4"]')).toHaveAttribute('preload', 'metadata');
  });

  it('disables everything while busy', () => {
    render(<MomentsStyleStep {...props()} busy />);
    expect(screen.getByRole('button', { name: /hype/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: '30 s' })).toBeDisabled();
    expect(screen.getByLabelText(/energy/i)).toBeDisabled();
  });
});
