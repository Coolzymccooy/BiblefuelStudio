import toast from 'react-hot-toast';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as youtubePublish from '../../../lib/youtubePublish';
import { api } from '../../../lib/api';
import { ambientApi } from '../../../lib/ambientApi';
import * as libraryApi from '../../../lib/musicLibraryApi';
import { AmbientRenderStep } from '../AmbientRenderStep';
import type { AmbientProject, AmbientStatus } from '../../../lib/ambientTypes';

const project = (status: AmbientStatus, percent = 40): AmbientProject => ({
  projectId: 'p1', title: 'T', theme: 'peace', translation: 'kjv', targetSec: 7200, aspect: 'landscape', status,
  bed: { mode: 'assemble', trackRefs: [], filePath: null, crossfadeSec: 6, volume: 0.85 },
  drops: [], movements: [], motion: 'still', captions: 'static', captionPreset: 'default',
  duck: { threshold: 0.02, ratio: 8, attackMs: 20, releaseMs: 800 },
  render: { jobId: 'j1', outputPath: null, status: 'running', percent, phase: '' },
  error: null, createdAt: 0, updatedAt: 0,
} as AmbientProject);

const renderStep = (p: AmbientProject, refresh = () => {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AmbientRenderStep project={p} busy={false} setBusy={() => {}} refresh={refresh} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: false, amfEncoder: false });
});

describe('AmbientRenderStep progress', () => {
  it('says what it is really doing while encoding — never a Story stage', () => {
    renderStep(project('rendering'));
    expect(screen.getByText('Encoding the video…')).toBeInTheDocument();
    expect(screen.queryByText(/synthesising voice/i)).toBeNull();
  });

  it('shows progress, not a second Render button, while the bed is being built', () => {
    // A second click here used to start a second render of the same video.
    renderStep(project('assembling', 0));
    expect(screen.getByText('Building the music bed…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Render' })).toBeNull();
  });

  it('tells the truth about leaving the page, and how long it usually takes', () => {
    renderStep(project('rendering'));
    expect(screen.queryByText(/don.t refresh/i)).toBeNull();
    expect(screen.getByText(/you can leave this page/i)).toBeInTheDocument();
    expect(screen.getByText(/about 40 minutes for 2 hours/i)).toBeInTheDocument();
  });

  it('shows the server-reported phase — waiting for another job to finish — over the generic stage text', () => {
    renderStep({
      ...project('assembling', 0),
      render: { jobId: 'j1', outputPath: null, status: 'running', percent: 0, phase: 'waiting for another job to finish' },
    } as AmbientProject);
    expect(screen.getByText('waiting for another job to finish')).toBeInTheDocument();
    expect(screen.queryByText('Building the music bed…')).toBeNull();
  });

  it('shows the retrying-on-the-CPU phase during an encode too', () => {
    renderStep({
      ...project('rendering', 10),
      render: { jobId: 'j1', outputPath: null, status: 'running', percent: 10, phase: 'retrying on the CPU' },
    } as AmbientProject);
    expect(screen.getByText('retrying on the CPU')).toBeInTheDocument();
  });
});

describe('AmbientRenderStep when the video is ready', () => {
  const done = (): AmbientProject => ({
    ...project('done'),
    title: 'God got me, everlasting love',
    render: { jobId: 'j1', outputPath: '/x/video.mp4', status: 'done', percent: 100, phase: '' },
  } as AmbientProject);

  it('offers Publish to YouTube under the download, with the title filled in', () => {
    renderStep(done());
    expect(screen.getByRole('heading', { name: 'Publish to YouTube' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('God got me, everlasting love')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /privacy/i })).toHaveValue('private');
  });

  it('publishes this session’s own video, privately unless you choose otherwise', async () => {
    const post = vi.spyOn(youtubePublish, 'publishToYoutube').mockResolvedValue({ ok: true, result: { videoId: 'v', videoUrl: 'u', forcedPrivate: false } } as never);
    renderStep(done());
    await userEvent.click(screen.getByRole('button', { name: /publish to youtube/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [body] = post.mock.calls[0] as [Record<string, unknown>];
    expect(body).toMatchObject({ videoUrl: '/outputs/ambient/p1/video.mp4', privacyStatus: 'private', record: { ambientProjectId: 'p1' } });
  });

  it('puts the title on the thumbnail by default, and can be told not to', async () => {
    const post = vi.spyOn(youtubePublish, 'publishToYoutube').mockResolvedValue({ ok: true, result: { videoId: 'vidVID12345', videoUrl: 'u', forcedPrivate: false } } as never);
    vi.spyOn(ambientApi, 'recordPublished').mockResolvedValue(done());
    renderStep({ ...done(), movements: [{ id: 'm1', startMs: 0, endMs: 1, imagePrompt: '', imagePath: '/x.png', imageUrl: '/outputs/imagelib-a.png', imageStatus: 'done' }] } as AmbientProject);
    const box = screen.getByRole('checkbox', { name: /put the title on the thumbnail/i });
    expect(box).toBeChecked();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: /publish to youtube/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [body] = post.mock.calls[0] as [Record<string, unknown>];
    expect(body).toMatchObject({ thumbnailPath: '/outputs/imagelib-a.png', thumbnailTitle: false });
  });

  it('shows where it already went, and that publishing again makes a new copy', () => {
    renderStep({
      ...done(),
      published: [
        { videoId: 'oldOLD12345', url: 'https://youtu.be/oldOLD12345', privacyStatus: 'private', publishAt: null, at: Date.now() - 3 * 86_400_000 },
        { videoId: 'newNEW12345', url: 'https://youtu.be/newNEW12345', privacyStatus: 'public', publishAt: null, at: Date.now() - 60_000 },
      ],
    } as AmbientProject);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://youtu.be/newNEW12345', 'https://youtu.be/oldOLD12345']);
    expect(screen.getByText(/publishing again uploads a new copy/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /publish to youtube/i })).toBeEnabled();
  });

  it('lets the server note the upload on the session, then refreshes', async () => {
    // The server records it, so closing the page mid-upload loses nothing.
    const publish = vi.spyOn(youtubePublish, 'publishToYoutube').mockResolvedValue({ ok: true, result: { videoId: 'vidVID12345', videoUrl: 'u', forcedPrivate: false, recorded: true } } as never);
    const record = vi.spyOn(ambientApi, 'recordPublished').mockResolvedValue(done());
    const refresh = vi.fn();
    renderStep(done(), refresh);
    await userEvent.click(screen.getByRole('button', { name: /publish to youtube/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(publish.mock.calls[0][0]).toMatchObject({ record: { ambientProjectId: 'p1' } });
    expect(record).not.toHaveBeenCalled();
  });

  it('says so if the upload worked but the session could not note it', async () => {
    vi.spyOn(youtubePublish, 'publishToYoutube').mockResolvedValue({ ok: true, result: { videoId: 'vidVID12345', videoUrl: 'u', forcedPrivate: false, recorded: false } } as never);
    const error = vi.spyOn(toast, 'error').mockImplementation(() => '');
    renderStep(done(), vi.fn());
    await userEvent.click(screen.getByRole('button', { name: /publish to youtube/i }));
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringMatching(/could not be added/)));
  });
});

describe('AmbientRenderStep — graphics chip', () => {
  it('renders with the graphics chip when ticked', async () => {
    vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: false, amfEncoder: true });
    const renderCall = vi.spyOn(ambientApi, 'render').mockResolvedValue({ ok: true });
    renderStep(project('draft'));
    await userEvent.click(await screen.findByRole('checkbox', { name: /graphics chip/i }));
    await userEvent.click(screen.getByRole('button', { name: /render/i }));
    expect(renderCall).toHaveBeenCalledWith(expect.any(String), 'amf');
  });

  it('hides the option when the chip is not available', async () => {
    const spy = vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: false, amfEncoder: false });
    renderStep(project('draft'));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(screen.queryByRole('checkbox', { name: /graphics chip/i })).not.toBeInTheDocument();
  });
});
