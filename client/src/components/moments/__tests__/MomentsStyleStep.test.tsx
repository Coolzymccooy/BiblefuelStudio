import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import userEvent from '@testing-library/user-event';
import { MomentsStyleStep } from '../MomentsStyleStep';
import { momentsApi } from '../../../lib/momentsApi';
import { api } from '../../../lib/api';
import * as errors from '../../../lib/errors';
import { ApiError } from '../../../lib/apiError';
import { META, mkMoment } from '../../../lib/__tests__/momentsFixtures';

beforeEach(() => vi.restoreAllMocks());
const props = (over = {}) => ({ project: mkMoment(over), meta: META, refresh: vi.fn(), busy: false, setBusy: vi.fn(), track: vi.fn(), commit: vi.fn() });

/** Like the page: `busy` is real state that setBusy flips, so a disabled control really is disabled. */
function renderLive(project: ReturnType<typeof mkMoment>) {
  const refresh = vi.fn();
  function Host() {
    const [busy, setBusy] = useState(false);
    return <MomentsStyleStep project={project} meta={META} refresh={refresh} busy={busy} setBusy={setBusy} track={vi.fn()} commit={vi.fn()} />;
  }
  render(<><Host /><Toaster /></>);
  return { refresh };
}

describe('MomentsStyleStep', () => {
  it('shows the four styles with looping previews and marks the current one', () => {
    render(<MomentsStyleStep {...props()} />);
    for (const name of ['Glow', 'Celebrate', 'Hype', 'Gallery']) expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /celebrate/i })).toHaveAttribute('aria-pressed', 'true');
    const video = document.querySelector('video[src$="/moments/previews/glow.mp4#t=0.001"]');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('loop');
  });

  it("picking a style saves it with the style's natural Energy", async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    const p = props();
    render(<MomentsStyleStep {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /hype/i }));
    expect(update).toHaveBeenCalledWith('m1', { style: 'hype', energy: 0.85 });
    await waitFor(() => expect(p.refresh).toHaveBeenCalled());
  });

  it('the picked style is visibly marked: a Selected badge and an outline (not a ring the card shadow hides)', () => {
    render(<MomentsStyleStep {...props()} />);
    const picked = screen.getByRole('button', { name: /celebrate/i });
    expect(picked).toHaveTextContent(/selected/i);
    expect(picked.className).toMatch(/outline-bf-gold/);
    expect(picked.className).not.toMatch(/\bring-/);
    for (const name of [/glow/i, /hype/i, /gallery/i]) expect(screen.getByRole('button', { name })).not.toHaveTextContent(/selected/i);
  });

  it('the badge is visual only: the name starts with the style and the state is aria-pressed', () => {
    render(<MomentsStyleStep {...props()} />);
    expect(screen.getByRole('button', { name: /^celebrate/i, pressed: true })).toBeInTheDocument();
  });

  it('the selected card still shows keyboard focus over its outline', () => {
    render(<MomentsStyleStep {...props()} />);
    expect(screen.getByRole('button', { name: /celebrate/i }).className).toMatch(/focus-visible:outline-/);
  });

  it('a style without a natural Energy (stale meta) saves just the style and leaves the slider', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment({ style: 'glow' }));
    const meta = { ...META, styles: META.styles.map((s) => ({ ...s, energy: undefined as unknown as number })) };
    function Host() {
      const [busy, setBusy] = useState(false);
      return <MomentsStyleStep project={mkMoment({ energy: 0.8 })} meta={meta} refresh={vi.fn()} busy={busy} setBusy={setBusy} track={vi.fn()} commit={vi.fn()} />;
    }
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: /glow/i }));
    expect(update).toHaveBeenCalledWith('m1', { style: 'glow' });
    await waitFor(() => expect(screen.getByRole('button', { name: /glow/i })).not.toBeDisabled());
    expect((screen.getByLabelText(/energy/i) as HTMLInputElement).value).toBe('80');
  });

  it('picking Glow moves the Energy slider to Calm', async () => {
    vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment({ style: 'glow', energy: 0.2 }));
    renderLive(mkMoment({ energy: 0.8 }));
    expect(screen.getByText(/energy: hype/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /glow/i }));
    await waitFor(() => expect((screen.getByLabelText(/energy/i) as HTMLInputElement).value).toBe('20'));
    expect(screen.getByText(/energy: calm/i)).toBeInTheDocument();
  });

  it('picking the style already chosen keeps a fine-tuned Energy (no save)', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsStyleStep {...props({ energy: 0.3 })} />);
    await userEvent.click(screen.getByRole('button', { name: /celebrate/i }));
    expect(update).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/energy/i) as HTMLInputElement).value).toBe('30');
  });

  it('a failed style save leaves the Energy slider where it was', async () => {
    vi.spyOn(momentsApi, 'update').mockRejectedValue(new Error('nope'));
    vi.spyOn(errors, 'toastError').mockImplementation(() => {});
    renderLive(mkMoment({ energy: 0.8 }));
    await userEvent.click(screen.getByRole('button', { name: /glow/i }));
    await waitFor(() => expect(errors.toastError).toHaveBeenCalled());
    expect((screen.getByLabelText(/energy/i) as HTMLInputElement).value).toBe('80');
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

  it('overlapping Energy saves go out in order, and an older failure never undoes a newer change', async () => {
    vi.spyOn(errors, 'toastError').mockImplementation(() => {});
    let failFirst: (e: Error) => void = () => {};
    const update = vi.spyOn(momentsApi, 'update')
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { failFirst = reject; }))
      .mockResolvedValueOnce(mkMoment({ energy: 0.4 }));
    renderLive(mkMoment({ energy: 0.8 }));
    const slider = screen.getByLabelText(/energy/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '25' } });
    fireEvent.mouseUp(slider);
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.keyUp(slider);
    expect(update).toHaveBeenCalledTimes(1); // the second save waits for the first
    failFirst(new Error('network'));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][1]).toEqual({ energy: 0.4 });
    await waitFor(() => expect(slider).not.toBeDisabled());
    expect(slider.value).toBe('40');
  });

  it('when the newest Energy save fails, the slider returns to the last value the server accepted', async () => {
    vi.spyOn(errors, 'toastError').mockImplementation(() => {});
    let failSecond: (e: Error) => void = () => {};
    const update = vi.spyOn(momentsApi, 'update')
      .mockResolvedValueOnce(mkMoment({ energy: 0.25 }))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { failSecond = reject; }));
    renderLive(mkMoment({ energy: 0.8 }));
    const slider = screen.getByLabelText(/energy/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '25' } });
    fireEvent.mouseUp(slider);
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.keyUp(slider);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    failSecond(new Error('network'));
    await waitFor(() => expect(slider.value).toBe('25'));
  });

  // One Cloudflare location gzipped the previews and ignored Range, so an
  // iPhone sometimes got a whole-file 200 and drew a blank card. The media
  // origin bypasses Cloudflare, as rendered videos already do.
  it('loads the previews from the media origin', () => {
    const before = Object.getOwnPropertyDescriptor(api, 'mediaBaseUrl');
    Object.defineProperty(api, 'mediaBaseUrl', { value: 'https://media.example', configurable: true });
    try {
      render(<MomentsStyleStep {...props()} />);
      expect(document.querySelector('video[src="https://media.example/moments/previews/glow.mp4#t=0.001"]')).not.toBeNull();
    } finally {
      if (before) Object.defineProperty(api, 'mediaBaseUrl', before);
    }
  });

  it('previews load metadata only until played', () => {
    render(<MomentsStyleStep {...props()} />);
    expect(document.querySelector('video[src$="/moments/previews/glow.mp4#t=0.001"]')).toHaveAttribute('preload', 'metadata');
  });

  it('disables everything while busy', () => {
    render(<MomentsStyleStep {...props()} busy />);
    expect(screen.getByRole('button', { name: /hype/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: '30 s' })).toBeDisabled();
    expect(screen.getByLabelText(/energy/i)).toBeDisabled();
  });

  describe('Showcase styles', () => {
    const SHOWCASE_META = {
      ...META,
      styles: [
        ...META.styles.map((s) => ({ ...s, family: 'classic' as const })),
        { id: 'fellowship' as const, label: 'Fellowship', description: 'Many photos', energy: 0.6, family: 'showcase' as const },
        { id: 'scrapbook' as const, label: 'Scrapbook', description: 'Paper', energy: 0.35, family: 'showcase' as const },
        { id: 'partyPop' as const, label: 'Party pop', description: 'Colour', energy: 0.8, family: 'showcase' as const },
        { id: 'premiere' as const, label: 'Premiere', description: 'Cinema', energy: 0.45, family: 'showcase' as const },
      ],
      lengths: [15, 30, 60, 90, 120, 180],
      lengthsByFamily: { classic: [15, 30, 60], showcase: [30, 60, 90, 120, 180] },
      shapes: ['tall', 'wide'] as ('tall' | 'wide')[],
    };
    const sprops = (over = {}) => ({ ...props(over), meta: SHOWCASE_META });
    const lengthButtons = () => screen.getAllByRole('button').filter((b) => b.closest('[aria-label="Length"]')).map((b) => b.textContent);

    it('sit under their own heading, after the classic styles', () => {
      render(<MomentsStyleStep {...sprops()} />);
      const heading = screen.getByText('Showcase · many photos at once');
      const fellowship = screen.getByRole('button', { name: /^fellowship/i });
      const glow = screen.getByRole('button', { name: /^glow/i });
      expect(heading.compareDocumentPosition(fellowship) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(heading.compareDocumentPosition(glow) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
      expect(screen.getByText('Classic · one photo at a time')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Showcase · many photos at once' })).toContainElement(fellowship);
    });

    it('offer a shape; classic styles do not', () => {
      const { unmount } = render(<MomentsStyleStep {...sprops({ style: 'premiere', lengthSec: 60 })} />);
      const group = screen.getByRole('group', { name: 'Shape' });
      expect(group).toHaveTextContent('Portrait 9:16');
      expect(group).toHaveTextContent('Widescreen 16:9');
      expect(screen.getByRole('button', { name: 'Portrait 9:16' })).toHaveAttribute('aria-pressed', 'true');
      unmount();
      render(<MomentsStyleStep {...sprops({ style: 'glow' })} />);
      expect(screen.queryByRole('group', { name: 'Shape' })).toBeNull();
    });

    it('picking Widescreen saves the wide shape', async () => {
      const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
      render(<MomentsStyleStep {...sprops({ style: 'premiere', lengthSec: 60 })} />);
      await userEvent.click(screen.getByRole('button', { name: 'Widescreen 16:9' }));
      expect(update).toHaveBeenCalledWith('m1', { shape: 'wide' });
    });

    it("Length lists the picked style's own lengths", () => {
      const { unmount } = render(<MomentsStyleStep {...sprops({ style: 'glow' })} />);
      expect(lengthButtons()).toEqual(['15 s', '30 s', '60 s']);
      unmount();
      render(<MomentsStyleStep {...sprops({ style: 'premiere', lengthSec: 60 })} />);
      expect(lengthButtons()).toEqual(['30 s', '60 s', '90 s', '120 s', '180 s']);
    });

    it('picking a classic style from a long widescreen Moment brings length and shape back in one save', async () => {
      const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment({ style: 'glow' }));
      render(<MomentsStyleStep {...sprops({ style: 'premiere', lengthSec: 120, shape: 'wide' })} />);
      await userEvent.click(screen.getByRole('button', { name: /^glow/i }));
      expect(update).toHaveBeenCalledWith('m1', { style: 'glow', energy: 0.2, lengthSec: 60, shape: 'tall' });
    });

    it('picking a Showcase style lifts a 15 s Moment to 30 s', async () => {
      const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment({ style: 'fellowship' }));
      render(<MomentsStyleStep {...sprops({ style: 'glow', lengthSec: 15 })} />);
      await userEvent.click(screen.getByRole('button', { name: /^fellowship/i }));
      expect(update).toHaveBeenCalledWith('m1', { style: 'fellowship', energy: 0.6, lengthSec: 30 });
    });

    it('older meta without families keeps one grid and the old lengths', () => {
      render(<MomentsStyleStep {...props()} />);
      expect(screen.queryByText('Showcase · many photos at once')).toBeNull();
      expect(lengthButtons()).toEqual(['15 s', '30 s', '60 s']);
    });
  });
});
