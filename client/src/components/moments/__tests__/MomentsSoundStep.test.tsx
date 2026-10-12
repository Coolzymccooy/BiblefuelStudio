import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MomentsSoundStep } from '../MomentsSoundStep';
import { momentsApi } from '../../../lib/momentsApi';
import * as errors from '../../../lib/errors';
import { ApiError } from '../../../lib/apiError';
import { META, mkMoment } from '../../../lib/__tests__/momentsFixtures';
import type { MomentMeta } from '../../../lib/momentsTypes';

type Pick = { path: string | null; volume: number };

// The real picker calls onChange for every change (track, Vol, Autoduck), so the mock offers both kinds.
vi.mock('../../MusicPicker', () => ({
  MusicPicker: ({ value, onChange }: { value: Pick; onChange: (v: Pick) => void }) => (
    <div>
      <button type="button" onClick={() => onChange({ path: 'library:hopeful', volume: 1 })}>picker:{value.path ?? 'none'}</button>
      <button type="button" onClick={() => onChange({ path: value.path, volume: 0.5 })}>picker volume</button>
    </div>
  ),
}));

function renderStep(project = mkMoment(), meta: MomentMeta = META) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = { project, meta, refresh: vi.fn(), busy: false, setBusy: vi.fn() };
  render(<QueryClientProvider client={qc}><MomentsSoundStep {...props} /><Toaster /></QueryClientProvider>);
  return props;
}

/** Like the page: `busy` is real state that setBusy flips, so a disabled control really is disabled. */
function renderLive(project: ReturnType<typeof mkMoment>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const refresh = vi.fn();
  function Host({ p }: { p: ReturnType<typeof mkMoment> }) {
    const [busy, setBusy] = useState(false);
    return <MomentsSoundStep project={p} meta={META} refresh={refresh} busy={busy} setBusy={setBusy} />;
  }
  const view = render(<QueryClientProvider client={qc}><Host p={project} /></QueryClientProvider>);
  return { rerender: (p: ReturnType<typeof mkMoment>) => view.rerender(<QueryClientProvider client={qc}><Host p={p} /></QueryClientProvider>) };
}
const withSong = (ref: string | null, windowStartSec: number | null = null) =>
  mkMoment({ sound: { song: ref ? { ref, windowStartSec } : null, voiceover: null } });

let toastErr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  toastErr = vi.spyOn(errors, 'toastError').mockImplementation(() => {});
  vi.spyOn(momentsApi, 'songWindow').mockResolvedValue({ durationSec: 180, tempo: 100, windowStartSec: 42, autoStartSec: 42 });
});

describe('MomentsSoundStep', () => {
  it('choosing a song saves it with an automatic window', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep();
    await userEvent.click(screen.getByRole('button', { name: /picker:library:gospel-fire/ }));
    expect(update).toHaveBeenCalledWith('m1', { sound: { song: { ref: 'library:hopeful', windowStartSec: null } } });
  });

  it('a volume change on the same song does not reset a nudged window', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep(mkMoment({ sound: { song: { ref: 'library:gospel-fire', windowStartSec: 30 }, voiceover: null } }));
    await userEvent.click(screen.getByRole('button', { name: /picker volume/ }));
    expect(update).not.toHaveBeenCalled();
  });

  it('shows the auto window and saves a nudged start', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep();
    const slider = await screen.findByLabelText(/start at/i);
    expect(slider).toHaveAttribute('max', '165');
    fireEvent.change(slider, { target: { value: '30' } });
    fireEvent.mouseUp(slider);
    await waitFor(() => expect(update).toHaveBeenCalledWith('m1', { sound: { song: { ref: 'library:gospel-fire', windowStartSec: 30 } } }));
  });

  it('Auto puts a nudged window back on automatic', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep(mkMoment({ sound: { song: { ref: 'library:gospel-fire', windowStartSec: 30 }, voiceover: null } }));
    await userEvent.click(await screen.findByRole('button', { name: /auto \(0:42\)/i }));
    expect(update).toHaveBeenCalledWith('m1', { sound: { song: { ref: 'library:gospel-fire', windowStartSec: null } } });
  });

  it('shows the reason inline when the song cannot be analysed', async () => {
    vi.spyOn(momentsApi, 'songWindow').mockRejectedValue(new ApiError("We couldn't read that song.", 'HTTP_422', {}, 422));
    renderStep();
    expect(await screen.findByText(/couldn't read that song/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/start at/i)).not.toBeInTheDocument();
  });

  it('hides the slider at once when the song is removed', async () => {
    const { rerender } = renderLive(withSong('library:gospel-fire'));
    await screen.findByLabelText(/start at/i);
    rerender(withSong(null));
    expect(screen.queryByLabelText(/start at/i)).not.toBeInTheDocument();
  });

  it('shows no slider for a new song until its own analysis lands', async () => {
    const win = vi.spyOn(momentsApi, 'songWindow');
    const { rerender } = renderLive(withSong('library:gospel-fire'));
    await screen.findByLabelText(/start at/i);
    win.mockReturnValue(new Promise(() => {}));
    rerender(withSong('library:hopeful'));
    expect(screen.queryByLabelText(/start at/i)).not.toBeInTheDocument();
  });

  it('keeps the slider while a nudge on the same song is re-read', async () => {
    const win = vi.spyOn(momentsApi, 'songWindow');
    const { rerender } = renderLive(withSong('library:gospel-fire'));
    await screen.findByLabelText(/start at/i);
    win.mockReturnValue(new Promise(() => {}));
    rerender(withSong('library:gospel-fire', 30));
    expect(screen.getByLabelText(/start at/i)).toBeInTheDocument();
  });

  it('does not save a start that is already the saved or automatic one', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep();
    const slider = await screen.findByLabelText(/start at/i);
    fireEvent.keyUp(slider, { key: 'Tab' });
    fireEvent.mouseUp(slider);
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps keyboard focus on the slider while its own save runs', async () => {
    let finish: (m: ReturnType<typeof mkMoment>) => void = () => {};
    const update = vi.spyOn(momentsApi, 'update').mockReturnValue(new Promise((res) => { finish = res; }));
    renderLive(mkMoment());
    const slider = await screen.findByLabelText(/start at/i);
    slider.focus();
    fireEvent.change(slider, { target: { value: '30' } });
    fireEvent.keyUp(slider, { key: 'ArrowLeft' });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(slider).not.toBeDisabled();
    expect(slider).toHaveAttribute('aria-busy', 'true');
    expect(document.activeElement).toBe(slider);
    fireEvent.keyUp(slider, { key: 'ArrowLeft' });
    expect(update).toHaveBeenCalledTimes(1);
    finish(mkMoment());
    await waitFor(() => expect(slider).toHaveAttribute('aria-busy', 'false'));
  });

  it('No music removes the song', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep();
    await userEvent.click(screen.getByRole('button', { name: /no music/i }));
    expect(update).toHaveBeenCalledWith('m1', { sound: { song: null } });
  });

  it('a failed save is reported with toastError and unlocks the page', async () => {
    const err = new ApiError('Nope', 'HTTP_500', {}, 500);
    vi.spyOn(momentsApi, 'update').mockRejectedValue(err);
    const props = renderStep();
    await userEvent.click(screen.getByRole('button', { name: /no music/i }));
    await waitFor(() => expect(toastErr).toHaveBeenCalledWith(err));
    expect(props.setBusy).toHaveBeenLastCalledWith(false);
  });

  it('a typed voiceover is made with the chosen voice', async () => {
    const vo = vi.spyOn(momentsApi, 'voiceover').mockResolvedValue(mkMoment());
    renderStep();
    await userEvent.type(screen.getByLabelText(/voiceover script/i), 'Happy birthday Tolu, God bless you.');
    await userEvent.selectOptions(screen.getByLabelText(/voice/i, { selector: 'select' }), 'en-NG-EzinneNeural');
    await userEvent.click(screen.getByRole('button', { name: /make voiceover/i }));
    expect(vo).toHaveBeenCalledWith('m1', { script: 'Happy birthday Tolu, God bless you.', voiceId: 'en-NG-EzinneNeural' });
  });

  it('locks the page while the voiceover is made and releases it after', async () => {
    let finish: (m: ReturnType<typeof mkMoment>) => void = () => {};
    vi.spyOn(momentsApi, 'voiceover').mockReturnValue(new Promise((res) => { finish = res; }));
    const props = renderStep();
    await userEvent.type(screen.getByLabelText(/voiceover script/i), 'Happy birthday Tolu.');
    await userEvent.click(screen.getByRole('button', { name: /make voiceover/i }));
    expect(props.setBusy).toHaveBeenLastCalledWith(true);
    finish(mkMoment());
    await waitFor(() => expect(props.setBusy).toHaveBeenLastCalledWith(false));
    expect(props.refresh).toHaveBeenCalled();
  });

  it('a failed voiceover is reported and releases the lock', async () => {
    const err = new ApiError('Voice is off', 'HTTP_400', {}, 400);
    vi.spyOn(momentsApi, 'voiceover').mockRejectedValue(err);
    const props = renderStep();
    await userEvent.type(screen.getByLabelText(/voiceover script/i), 'Happy birthday Tolu.');
    await userEvent.click(screen.getByRole('button', { name: /make voiceover/i }));
    await waitFor(() => expect(toastErr).toHaveBeenCalledWith(err));
    expect(props.setBusy).toHaveBeenLastCalledWith(false);
  });

  it('Write it for me sends the idea instead of a script', async () => {
    const vo = vi.spyOn(momentsApi, 'voiceover').mockResolvedValue(mkMoment());
    renderStep();
    await userEvent.type(screen.getByLabelText(/voiceover script/i), 'a blessing for my mum turning 60');
    await userEvent.click(screen.getByRole('button', { name: /write it for me/i }));
    expect(vo).toHaveBeenCalledWith('m1', { idea: 'a blessing for my mum turning 60', voiceId: expect.any(String) });
  });

  it('the script box is limited by the server limit from /meta', () => {
    renderStep(mkMoment(), { ...META, limits: { ...META.limits, scriptMax: 321 } });
    expect(screen.getByLabelText(/voiceover script/i)).toHaveAttribute('maxlength', '321');
  });

  it('an existing voiceover can be played and removed', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep(mkMoment({ sound: { song: null, voiceover: { script: 'Hi', voiceId: null, file: 'moment-vo-1.mp3' } } }));
    expect(document.querySelector('audio')?.getAttribute('src')).toContain('moment-vo-1.mp3');
    await userEvent.click(screen.getByRole('button', { name: /remove voiceover/i }));
    expect(update).toHaveBeenCalledWith('m1', { sound: { voiceover: null } });
  });
});
