import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../../lib/lyricVideoApi', () => ({ lyricVideoApi: { render: vi.fn(), renderStatus: vi.fn(), cancelRender: vi.fn(), get: vi.fn(), publishDraft: vi.fn() } }));
// The panel has its own tests; here only what the render step hands it matters.
vi.mock('../../share/YoutubePublishPanel', () => ({
  YoutubePublishPanel: (props: { videoUrl: string; initial?: { title?: string; description?: string; tags?: string[] }; categoryId?: string }) => (
    <div data-testid="yt-panel">{props.videoUrl}|{props.initial?.title}|{props.initial?.tags?.join(',')}|{props.categoryId}</div>
  ),
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
import toast from 'react-hot-toast';
import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { RenderStep } from '../RenderStep';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const p = { projectId: 'lv_1', title: 'My Time', renders: [], lines: [{ id: 'l1', words: [{ text: 'x', start: 0, end: 1 }] }] } as unknown as LyricProject;

describe('RenderStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders portrait 720p by default and shows the result', async () => {
    vi.mocked(lyricVideoApi.render).mockResolvedValue('job1');
    vi.mocked(lyricVideoApi.renderStatus).mockResolvedValue({ jobId: 'job1', status: 'done', progress: 100, error: null, file: 'lyric-lv_1.mp4' });
    vi.mocked(lyricVideoApi.get).mockResolvedValue(p);
    render(<RenderStep project={p} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /render video/i }));
    await waitFor(() => expect(lyricVideoApi.render).toHaveBeenCalledWith('lv_1', 'portrait', '720p'));
    const link = await screen.findByRole('link', { name: /download/i }, { timeout: 4000 });
    expect(link.getAttribute('href')).toMatch(/\/outputs\/lyric-lv_1\.mp4\?dl=My%20Time\.mp4$/);
  });

  it('sends the chosen frame and quality', async () => {
    vi.mocked(lyricVideoApi.render).mockResolvedValue('job1');
    vi.mocked(lyricVideoApi.renderStatus).mockResolvedValue({ jobId: 'job1', status: 'running', progress: 10, error: null, file: null });
    render(<RenderStep project={p} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/frame/i), { target: { value: 'landscape' } });
    fireEvent.change(screen.getByLabelText(/quality/i), { target: { value: '1080p' } });
    fireEvent.click(screen.getByRole('button', { name: /render video/i }));
    await waitFor(() => expect(lyricVideoApi.render).toHaveBeenCalledWith('lv_1', 'landscape', '1080p'));
  });

  it('explains each frame and quality in plain words', () => {
    render(<RenderStep project={p} onChange={vi.fn()} />);
    expect(screen.getByRole('option', { name: /portrait.*best for shorts and tiktok/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /1080p.*takes longer/i })).toBeTruthy();
  });

  it('shows progress and lets you cancel', async () => {
    vi.mocked(lyricVideoApi.render).mockResolvedValue('job1');
    vi.mocked(lyricVideoApi.renderStatus).mockResolvedValue({ jobId: 'job1', status: 'running', progress: 42, error: null, file: null });
    vi.mocked(lyricVideoApi.cancelRender).mockResolvedValue(undefined);
    render(<RenderStep project={p} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /render video/i }));
    expect(await screen.findByText(/42%/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(lyricVideoApi.cancelRender).toHaveBeenCalledWith('lv_1', 'job1'));
  });

  it('shows why a render failed and lets you start another', async () => {
    vi.mocked(lyricVideoApi.render).mockResolvedValue('job1');
    vi.mocked(lyricVideoApi.renderStatus).mockResolvedValue({ jobId: 'job1', status: 'error', progress: 0, error: 'The video could not be made.', file: null });
    render(<RenderStep project={p} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /render video/i }));
    expect(await screen.findByText('The video could not be made.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /render video/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the server's sentence when a render is refused", async () => {
    vi.mocked(lyricVideoApi.render).mockRejectedValue(new Error('You already have a video being made — wait for it to finish.'));
    render(<RenderStep project={p} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /render video/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You already have a video being made — wait for it to finish.'));
  });

  it('cannot render before any line is timed', () => {
    render(<RenderStep project={{ ...p, lines: [{ id: 'l1' }] } as unknown as LyricProject} onChange={vi.fn()} />);
    expect((screen.getByRole('button', { name: /render video/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/time the lyrics first/i)).toBeTruthy();
  });

  it('picks a render that is still running back up when you come back to the page (R43)', async () => {
    const away = { ...p, render: { activeJobId: 'job9' } } as unknown as LyricProject;
    const running = { jobId: 'job9', status: 'running', progress: 37, error: null, file: null };
    const finished = { jobId: 'job9', status: 'done', progress: 100, error: null, file: 'lyric-job9.mp4' };
    const refreshed = { ...p, render: null, renders: [] } as unknown as LyricProject;
    vi.mocked(lyricVideoApi.renderStatus).mockResolvedValueOnce(running).mockResolvedValue(finished);
    vi.mocked(lyricVideoApi.get).mockResolvedValue(refreshed);
    const onChange = vi.fn();
    render(<RenderStep project={away} onChange={onChange} />);
    expect(await screen.findByText(/37%/)).toBeTruthy();
    expect(lyricVideoApi.renderStatus).toHaveBeenCalledWith('lv_1', 'job9');
    expect((screen.getByRole('button', { name: /render video/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
    expect(lyricVideoApi.render).not.toHaveBeenCalled();
    const link = await screen.findByRole('link', { name: /download/i }, { timeout: 4000 });
    expect(link.getAttribute('href')).toMatch(/lyric-job9\.mp4/);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(refreshed));
  });

  it('starts idle when no render is saved on the project', () => {
    render(<RenderStep project={{ ...p, render: null } as unknown as LyricProject} onChange={vi.fn()} />);
    expect(lyricVideoApi.renderStatus).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: /render video/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('lists earlier videos with a download link each, newest first', () => {
    const earlier = { ...p, renders: [
      { jobId: 'a', aspect: 'portrait', quality: '720p', file: 'C:\\out\\lyric-a.mp4', durationSec: 181, at: '2026-10-01T10:00:00Z' },
      { jobId: 'b', aspect: 'landscape', quality: '1080p', file: '/out/lyric-b.mp4', durationSec: 181, at: '2026-10-02T10:00:00Z' },
    ] } as unknown as LyricProject;
    render(<RenderStep project={earlier} onChange={vi.fn()} />);
    const links = screen.getAllByRole('link', { name: /download/i });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toMatch(/lyric-b\.mp4\?dl=/);
    expect(links[1].getAttribute('href')).toMatch(/lyric-a\.mp4\?dl=/);
  });

  const made = { ...p, renders: [{ jobId: 'j1', aspect: 'portrait', quality: '720p', file: '/data/out/lyric-a.mp4', durationSec: 30, at: '2026-10-14T10:00:00Z' }] } as unknown as LyricProject;
  const draft = { title: 'My Time — A (Official Lyric Video)', description: 'Lyrics', tags: ['My Time', 'lyrics'], categoryId: '10', note: 'Set Altered or synthetic content in YouTube Studio.' };

  it('offers Publish to YouTube for the video being watched, opened with the draft', async () => {
    vi.mocked(lyricVideoApi.publishDraft).mockResolvedValue(draft);
    render(<RenderStep project={made} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /publish to youtube/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /watch/i }));
    fireEvent.click(screen.getByRole('button', { name: /publish to youtube/i }));
    const panel = await screen.findByTestId('yt-panel');
    expect(lyricVideoApi.publishDraft).toHaveBeenCalledWith('lv_1');
    expect(panel.textContent).toBe('/outputs/lyric-a.mp4|My Time — A (Official Lyric Video)|My Time,lyrics|10');
    expect(screen.getByText(draft.note)).toBeTruthy();
  });

  it('still opens the panel, with the song title, when the draft cannot be fetched', async () => {
    vi.mocked(lyricVideoApi.publishDraft).mockRejectedValue(new Error('offline'));
    render(<RenderStep project={made} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /watch/i }));
    fireEvent.click(screen.getByRole('button', { name: /publish to youtube/i }));
    const panel = await screen.findByTestId('yt-panel');
    expect(panel.textContent).toBe('/outputs/lyric-a.mp4|My Time||10');
  });
});
