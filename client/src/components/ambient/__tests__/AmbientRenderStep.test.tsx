import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../../lib/api';
import { ambientApi } from '../../../lib/ambientApi';
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

const renderStep = (p: AmbientProject, refresh = () => {}) =>
  render(<AmbientRenderStep project={p} busy={false} setBusy={() => {}} refresh={refresh} />);

beforeEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

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
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { videoId: 'v', videoUrl: 'u', forcedPrivate: false } } as never);
    renderStep(done());
    await userEvent.click(screen.getByRole('button', { name: /publish to youtube/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/api/social/post');
    expect(body).toMatchObject({ destination: 'youtube', videoUrl: '/outputs/ambient/p1/video.mp4', privacyStatus: 'private' });
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

  it('notes a fresh upload in the session history, then refreshes', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { videoId: 'vidVID12345', videoUrl: 'u', forcedPrivate: false } } as never);
    const record = vi.spyOn(ambientApi, 'recordPublished').mockResolvedValue(done());
    const refresh = vi.fn();
    renderStep(done(), refresh);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /privacy/i }), 'unlisted');
    await userEvent.click(screen.getByRole('button', { name: /publish to youtube/i }));
    await waitFor(() => expect(record).toHaveBeenCalledWith('p1', { videoId: 'vidVID12345', privacyStatus: 'unlisted', publishAt: undefined }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
