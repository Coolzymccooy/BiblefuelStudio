import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../lib/errors', () => ({ toastError: vi.fn() }));
vi.mock('../../../lib/cartoonApi', () => ({
  cartoonApi: { update: vi.fn(), render: vi.fn(), cancelRender: vi.fn() },
}));
vi.mock('../../../lib/musicLibraryApi', () => ({
  fetchMusicLibrary: vi.fn().mockResolvedValue([
    { id: 'calm', label: 'Calm piano', ref: 'library:calm', source: 'bundled' },
    { id: 'song', label: 'Song (vocal)', ref: 'library:song', source: 'bundled' },
    { id: 'mine', label: 'Hillside', ref: 'mylib:mine', source: 'upload' },
  ]),
}));
const youtubeProps = vi.fn();
vi.mock('../../share/YoutubePublishPanel', () => ({
  YoutubePublishPanel: (props: unknown) => { youtubeProps(props); return <div>YouTube panel</div>; },
}));
const tiktokProps = vi.fn();
vi.mock('../../share/TikTokPostPanel', () => ({
  TikTokPostPanel: (props: unknown) => { tiktokProps(props); return <div>TikTok panel</div>; },
}));

import { cartoonApi } from '../../../lib/cartoonApi';
import { ApiError } from '../../../lib/apiError';
import type { CartoonProject, CartoonRender, CartoonShot } from '../../../lib/cartoonTypes';
import { FinishStep } from '../FinishStep';

const shots: CartoonShot[] = [1, 2, 3].map((n) => ({
  id: `sh${n}`, sceneId: 'a', speaker: 'Eli', line: `Line ${n}`, action: null, note: '', seconds: 4, firstFrame: 'fresh',
  clip: { status: 'done', url: `/outputs/c${n}.mp4`, posterUrl: n === 2 ? null : `/outputs/c${n}.jpg` },
}));

function project(over: Partial<CartoonProject> = {}): CartoonProject {
  return {
    id: 'c1',
    mode: 'cartoon',
    meta: { title: 'The Lost Lamb', verse: { reference: 'Luke 15:4', text: 'Leave the ninety-nine and go after the lost sheep.' }, aspect: 'portrait', style: 'family3d' },
    cast: {},
    scenes: [{ id: 'a', place: 'Hillside', note: '' }],
    shots,
    music: { bed: 'library:calm' },
    captions: { enabled: true },
    endCard: { text: 'Follow for more' },
    running: { pictures: false, film: false, render: false },
    render: { status: 'idle' },
    renderBlockers: [],
    renderWarnings: [],
    ...over,
  } as unknown as CartoonProject;
}

function Harness({ initial }: { initial: CartoonProject }) {
  const [p, setP] = useState(initial);
  return <FinishStep project={p} onSaved={setP} />;
}

const done: CartoonRender = { status: 'done', url: '/outputs/cartoons/c1/film.mp4', durationSec: 38, sizeBytes: 12_000_000, renderSec: 50 };

describe('FinishStep', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('NOT_READY blockers are listed', async () => {
    const blockers = ['1 shot has no clip yet. Film it first.', 'The music bed can\'t be found. Choose another, or turn the music off.'];
    vi.mocked(cartoonApi.render).mockRejectedValue(new ApiError(blockers[0], 'NOT_READY', { blockers }, 409));
    render(<Harness initial={project()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Render the film' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(blockers[0]);
    expect(alert).toHaveTextContent(blockers[1]);
  });

  it('render warnings are shown without stopping the render', () => {
    const warning = 'Shot 2 starts from the old last frame of the shot before. Re-make it, or render it as it is.';
    render(<Harness initial={project({ renderWarnings: [warning] })} />);
    expect(screen.getByText(warning)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Render the film' })).toBeEnabled();
  });

  it('captions, music and end card save through update', async () => {
    vi.mocked(cartoonApi.update).mockImplementation(async (_id, edit) => project({
      captions: edit.captions ?? { enabled: true },
      music: { bed: edit.bed === undefined ? 'library:calm' : edit.bed },
    }));
    render(<Harness initial={project()} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Captions' }));
    await waitFor(() => expect(cartoonApi.update).toHaveBeenCalledWith('c1', { captions: { enabled: false } }));
    const bed = await screen.findByRole('combobox', { name: 'Music bed' });
    await screen.findByRole('option', { name: 'Hillside (yours)' });
    expect(screen.queryByRole('option', { name: 'Song (vocal)' })).not.toBeInTheDocument();
    fireEvent.change(bed, { target: { value: '' } });
    await waitFor(() => expect(cartoonApi.update).toHaveBeenCalledWith('c1', { bed: null }));
    const endCard = screen.getByRole('textbox', { name: 'End card text' });
    fireEvent.blur(endCard);
    expect(cartoonApi.update).toHaveBeenCalledTimes(2);
    fireEvent.change(endCard, { target: { value: 'Share it with a friend' } });
    fireEvent.blur(endCard);
    await waitFor(() => expect(cartoonApi.update).toHaveBeenCalledWith('c1', { endCard: { text: 'Share it with a friend' } }));
  });

  it('Render waits for an end-card save still in flight', async () => {
    let finish: (p: CartoonProject) => void = () => {};
    vi.mocked(cartoonApi.update).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<Harness initial={project()} />);
    const endCard = screen.getByRole('textbox', { name: 'End card text' });
    fireEvent.change(endCard, { target: { value: 'Share it with a friend' } });
    fireEvent.blur(endCard);
    const renderButton = screen.getByRole('button', { name: 'Render the film' });
    await waitFor(() => expect(renderButton).toBeDisabled());
    finish(project({ endCard: { text: 'Share it with a friend' } }));
    await waitFor(() => expect(renderButton).toBeEnabled());
  });

  it('rendering shows progress and can be stopped', async () => {
    vi.mocked(cartoonApi.cancelRender).mockResolvedValue({ stopping: true });
    render(<Harness initial={project({ running: { pictures: false, film: false, render: true }, render: { status: 'rendering', progress: 42 } })} />);
    expect(screen.getByRole('progressbar', { name: 'Render progress' })).toHaveAttribute('aria-valuenow', '42');
    fireEvent.click(screen.getByRole('button', { name: 'Stop render' }));
    await waitFor(() => expect(cartoonApi.cancelRender).toHaveBeenCalledWith('c1'));
  });

  it('a finished film offers the video, a download, the post caption, YouTube and TikTok', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<Harness initial={project({ render: done })} />);
    expect(screen.getByLabelText('Finished film')).toHaveAttribute('src', done.url);
    expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute('href', done.url);
    const caption = 'The Lost Lamb\n\n“Leave the ninety-nine and go after the lost sheep.”\nLuke 15:4';
    fireEvent.click(screen.getByRole('button', { name: 'Copy caption' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(caption));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(youtubeProps).toHaveBeenCalledWith(expect.objectContaining({
      videoUrl: done.url,
      initial: { title: 'The Lost Lamb', description: caption, thumbnailTitle: false },
      thumbnailOptions: [{ label: 'Shot 1', path: '/outputs/c1.jpg' }, { label: 'Shot 3', path: '/outputs/c3.jpg' }],
    }));
    expect(tiktokProps).toHaveBeenCalledWith({ videoUrl: done.url, caption, title: 'The Lost Lamb' });
  });
});
