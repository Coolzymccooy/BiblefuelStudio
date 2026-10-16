import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { StoryVideoPage } from '../StoryVideoPage';
import { storyApi } from '../../lib/storyApi';
import userEvent from '@testing-library/user-event';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';

const uploadMediaMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/mediaUpload', async (orig) => {
  const real = await orig<typeof import('../../lib/mediaUpload')>();
  uploadMediaMock.mockImplementation(real.uploadMedia);
  return { ...real, uploadMedia: (...args: Parameters<typeof real.uploadMedia>) => uploadMediaMock(...args) };
});

vi.mock('../../components/MediaTrimmer', () => ({
  MediaTrimmer: ({ onApply, onCancel }: any) => (
    <div data-testid="media-trimmer">
      <button onClick={() => onApply('/out/trimmed.mp3', 12)}>trimmer-apply</button>
      <button onClick={() => onCancel()}>trimmer-close</button>
    </div>
  ),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(StoryVideoPage)),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(storyApi, 'listProjects').mockResolvedValue([] as any);
});

describe('StoryVideoPage', () => {
  function mkDraft(id = 'np') {
    return {
      projectId: id, title: 'T', style: 'cinematic-bible', status: 'draft',
      source: { audioPath: null, durationMs: 0 }, transcript: { words: [], hash: null },
      scenes: [], music: { path: null, volume: 0.3 }, captionPreset: 'default',
      render: { jobId: null, outputPath: null, status: null }, error: null, createdAt: 0, updatedAt: 0,
    } as any;
  }
  function mockPipeline() {
    vi.spyOn(storyApi, 'createProject').mockResolvedValue(mkDraft());
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(mkDraft());
    return vi.spyOn(storyApi, 'process').mockResolvedValue(undefined);
  }
  function pickFile() {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['xxxxxxxx'], 'sermon.mp3', { type: 'audio/mpeg' });
    fireEvent.change(input, { target: { files: [file] } });
  }

  it('shows step 1 (upload/setup) when there is no active project', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /cinematic scenes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload a sermon/i })).toBeInTheDocument();
  });

  it('resumes an active project from localStorage and shows review when scenes exist', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue({
      projectId: 'p1', title: 'T', style: 'cinematic-bible', status: 'ready_to_render',
      source: { audioPath: 'a', durationMs: 8000 }, transcript: { words: [], hash: 'h' },
      scenes: [{ id: 'scene-001', text: 'a', startMs: 0, endMs: 8000, imagePrompt: 'p', imagePath: '/a.png', imageUrl: '/outputs/x.png', imageStatus: 'done', promptEditedByUser: false }],
      music: { path: null, volume: 0.3 }, captionPreset: 'default',
      render: { jobId: null, outputPath: null, status: null }, error: null, createdAt: 0, updatedAt: 0,
    } as any);
    renderPage();
    // Scene caption is shown as read-only serif text in the review list (the
    // editable input now lives behind each scene's "tune" toggle).
    expect(await screen.findByText('a')).toBeInTheDocument();
  });

  it('shows the shared Start new button in the header and returns to the form', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue({ ...mkDraft('p1'), status: 'ready_to_render' });
    renderPage();
    const startNew = await screen.findByRole('button', { name: 'Start new' });
    const header = screen.getByRole('heading', { level: 1 }).parentElement?.parentElement;
    expect(header?.contains(startNew)).toBe(true);
    expect(startNew).toHaveClass('btn');
    await userEvent.click(startNew);
    expect(await screen.findByRole('button', { name: /upload a sermon/i })).toBeInTheDocument();
    expect(localStorage.getItem('BF_STORY_ACTIVE')).toBeNull();
  });

  it('Render stays off while Upload several is still putting pictures on scenes', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    const done = (id: string) => ({ id, text: id, startMs: 0, endMs: 8000, imagePrompt: 'p', imagePath: '/a.png', imageUrl: '/outputs/x.png', imageStatus: 'done', promptEditedByUser: false });
    vi.spyOn(storyApi, 'getProject').mockResolvedValue({
      projectId: 'p1', title: 'T', style: 'cinematic-bible', status: 'ready_to_render',
      source: { audioPath: 'a', durationMs: 16000 }, transcript: { words: [], hash: 'h' },
      scenes: [done('scene-001'), done('scene-002')],
      music: { path: null, volume: 0.3 }, captionPreset: 'default',
      render: { jobId: null, outputPath: null, status: null }, error: null, createdAt: 0, updatedAt: 0,
    } as any);
    let release!: () => void;
    uploadMediaMock.mockImplementation(() => new Promise((r) => { release = () => r({ file: '/outputs/bg-image-x.png', kind: 'image' }); }));
    vi.spyOn(storyApi, 'setSceneImage').mockResolvedValue({} as any);
    const renderSpy = vi.spyOn(storyApi, 'render').mockResolvedValue(undefined as any);
    renderPage();
    const renderBtn = await screen.findByRole('button', { name: /looks good → render/i });
    expect(renderBtn).toBeEnabled();

    await userEvent.upload(screen.getByLabelText('Image files for several scenes'), [
      new File(['a'], 'Scene 1.png', { type: 'image/png' }), new File(['b'], 'Scene 2.png', { type: 'image/png' }),
    ]);
    await waitFor(() => expect(uploadMediaMock).toHaveBeenCalledTimes(1));
    expect(renderBtn).toBeDisabled();
    expect(screen.getByRole('button', { name: /regenerate all/i })).toBeDisabled();
    fireEvent.click(renderBtn);
    expect(renderSpy).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(uploadMediaMock).toHaveBeenCalledTimes(2));
    release();
    await waitFor(() => expect(renderBtn).toBeEnabled());
  });

  it('shows a Resume button for an interrupted (transient, stale) project and re-drives it', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p2');
    const now = Date.now();
    const proj = {
      projectId: 'p2', title: 'T', style: 'cinematic-bible', status: 'generating_images',
      source: { audioPath: 'a', durationMs: 8000 },
      transcript: { words: [{ text: 'w', startMs: 0, endMs: 500 }], hash: 'h' },
      scenes: [{ id: 'scene-001', text: 'a', startMs: 0, endMs: 8000, imagePrompt: 'p', imagePath: null, imageUrl: null, imageStatus: 'pending', promptEditedByUser: false }],
      music: { path: null, volume: 0.3 }, captionPreset: 'default',
      render: { jobId: null, outputPath: null, status: null }, error: null, createdAt: 0, updatedAt: now - 200_000,
    };
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(proj as any);
    const proc = vi.spyOn(storyApi, 'process').mockResolvedValue(undefined);
    const { default: userEvent } = await import('@testing-library/user-event');
    renderPage();
    const btn = await screen.findByRole('button', { name: /resume/i });
    await userEvent.click(btn);
    expect(proc).toHaveBeenCalledWith('p2', 'a');
  });

  it('upload control is a real button wired to a hidden file input (regression: click opens chooser)', () => {
    renderPage();
    const btn = screen.getByRole('button', { name: /upload a sermon/i });
    expect(btn.tagName).toBe('BUTTON');
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
  });

  it('shows Recent projects above the new-project form when idle', async () => {
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue([
      { projectId: 'h1', title: 'History One', status: 'done', style: 'cinematic-bible', updatedAt: Date.now() },
    ] as any);
    renderPage();
    expect(await screen.findByText('History One')).toBeInTheDocument();
    expect(screen.getByText(/recent projects/i)).toBeInTheDocument();
  });

  it('after picking a file, shows the ready panel — NOT an immediate transcribe', async () => {
    vi.spyOn(storyApi, 'uploadAudio').mockResolvedValue('/out/full.mp3');
    mockPipeline();
    renderPage();
    pickFile();
    expect(await screen.findByRole('button', { name: /use full audio/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /trim audio/i })).toBeInTheDocument();
    expect(storyApi.process).not.toHaveBeenCalled();
  });

  it('"Use full audio" runs the pipeline with the uploaded path', async () => {
    vi.spyOn(storyApi, 'uploadAudio').mockResolvedValue('/out/full.mp3');
    mockPipeline();
    renderPage();
    pickFile();
    await userEvent.click(await screen.findByRole('button', { name: /use full audio/i }));
    await waitFor(() => expect(storyApi.process).toHaveBeenCalledWith('np', '/out/full.mp3', { name: 'sermon.mp3', trimmed: false }));
  });

  it('a script-made voiceover starts the pipeline with no file name', async () => {
    vi.spyOn(storyApi, 'scriptToAudio').mockResolvedValue('/out/story-tts-1.mp3');
    mockPipeline();
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /write a script/i }));
    await userEvent.type(screen.getByLabelText(/your idea/i), 'hope in the morning');
    await userEvent.click(screen.getByRole('button', { name: /generate voiceover/i }));
    await userEvent.click(await screen.findByRole('button', { name: /use full audio/i }));
    await waitFor(() => expect(storyApi.process).toHaveBeenCalledWith('np', '/out/story-tts-1.mp3', { trimmed: false }));
  });

  it('the Music panel shows the soundtrack the story was made from', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue({
      projectId: 'p1', title: 'T', style: 'cinematic-bible', status: 'ready_to_render',
      source: { audioPath: 'a', durationMs: 215000, name: 'Great Is Thy Faithfulness.mp3', trimmed: true }, transcript: { words: [], hash: 'h' },
      scenes: [{ id: 'scene-001', text: 'a', startMs: 0, endMs: 8000, imagePrompt: 'p', imagePath: '/a.png', imageUrl: '/outputs/x.png', imageStatus: 'done', promptEditedByUser: false }],
      music: { path: null, volume: 0.3 }, captionPreset: 'default',
      render: { jobId: null, outputPath: null, status: null }, error: null, createdAt: 0, updatedAt: 0,
    } as any);
    renderPage();
    expect(await screen.findByText('Soundtrack: Great Is Thy Faithfulness.mp3 · trimmed · 3:35')).toBeInTheDocument();
    expect(screen.getByText(/no extra music\. your soundtrack plays on its own/i)).toBeInTheDocument();
  });

  it('a narrated long-form story with no file name calls its soundtrack "your narration"', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue({
      projectId: 'p1', title: 'T', style: 'cinematic-bible', status: 'ready_to_render',
      source: { audioPath: 'a', durationMs: 600000 }, transcript: { words: [], hash: 'h' },
      longform: { script: 's', outline: [], progress: null },
      scenes: [{ id: 'scene-001', text: 'a', startMs: 0, endMs: 8000, imagePrompt: 'p', imagePath: '/a.png', imageUrl: '/outputs/x.png', imageStatus: 'done', promptEditedByUser: false }],
      music: { path: null, volume: 0.3 }, captionPreset: 'default',
      render: { jobId: null, outputPath: null, status: null }, error: null, createdAt: 0, updatedAt: 0,
    } as any);
    renderPage();
    expect(await screen.findByText('Soundtrack: your narration · 10:00')).toBeInTheDocument();
  });

  it('a new project shows Cinematic (default) in the caption picker, not the first option', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue({
      projectId: 'p1', title: 'T', style: 'cinematic-bible', status: 'ready_to_render',
      source: { audioPath: 'a', durationMs: 8000 }, transcript: { words: [], hash: 'h' },
      scenes: [{ id: 'scene-001', text: 'a', startMs: 0, endMs: 8000, imagePrompt: 'p', imagePath: '/a.png', imageUrl: '/outputs/x.png', imageStatus: 'done', promptEditedByUser: false }],
      music: { path: null, volume: 0.3 }, captionPreset: 'default', captions: 'kinetic',
      render: { jobId: null, outputPath: null, status: null }, error: null, createdAt: 0, updatedAt: 0,
    } as any);
    renderPage();
    const select = await screen.findByRole('combobox', { name: 'Caption animation' });
    expect(select).toHaveValue('cinematic-default');
  });

  it('"Trim audio" → apply runs the pipeline with the trimmed path', async () => {
    vi.spyOn(storyApi, 'uploadAudio').mockResolvedValue('/out/full.mp3');
    mockPipeline();
    renderPage();
    pickFile();
    await userEvent.click(await screen.findByRole('button', { name: /trim audio/i }));
    await userEvent.click(await screen.findByRole('button', { name: /trimmer-apply/i }));
    await waitFor(() => expect(storyApi.process).toHaveBeenCalledWith('np', '/out/trimmed.mp3', { name: 'sermon.mp3', trimmed: true }));
  });

  it('upload error returns to the form (no ready panel)', async () => {
    vi.spyOn(storyApi, 'uploadAudio').mockRejectedValue(new Error('upload boom'));
    renderPage();
    pickFile();
    await waitFor(() => expect(storyApi.uploadAudio).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /use full audio/i })).toBeNull();
    expect(screen.getByRole('button', { name: /upload a sermon/i })).toBeInTheDocument();
  });

  it('switches to script mode and generates a voiceover, then shows the ready panel', async () => {
    vi.spyOn(storyApi, 'scriptToAudio').mockResolvedValue('/out/story-tts-1.mp3');
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /write a script/i }));
    await userEvent.type(screen.getByLabelText(/your idea/i), 'hope in the morning');
    await userEvent.click(screen.getByRole('button', { name: /generate voiceover/i }));
    expect(await screen.findByRole('button', { name: /use full audio/i })).toBeInTheDocument();
    expect(storyApi.scriptToAudio).toHaveBeenCalledWith('hope in the morning', 'devotional-30', 'en-US-GuyNeural');
  });

  it('shows the upload button in upload mode (default)', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /upload a sermon/i })).toBeInTheDocument();
  });

  it('a finished story waits for the music library so the description carries the song credit', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p9');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue({
      projectId: 'p9', title: 'Night Psalms', style: 'cinematic-bible', status: 'done',
      source: { audioPath: 'a', durationMs: 480000 }, transcript: { words: [], hash: 'h' },
      scenes: [], music: { path: 'library:t1', volume: 0.3, autoDuck: true }, captionPreset: 'default',
      render: { jobId: null, outputPath: 'o', status: 'done' }, error: null, createdAt: 0, updatedAt: 0,
    } as any);
    let release: (v: unknown) => void = () => {};
    const slow = new Promise((r) => { release = r; });
    vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
      if (url === '/api/music/library') {
        await slow;
        return { ok: true, data: { tracks: [{ id: 't1', ref: 'library:t1', label: 'Still Waters', credit: 'Still Waters by A. Composer', source: 'library' }] } } as never;
      }
      return { ok: false, error: 'not in test' } as never;
    });
    renderPage();
    await screen.findByRole('heading', { name: /publish to youtube/i });
    release(null);
    await waitFor(() => {
      const box = [...document.querySelectorAll('textarea')].find((t) => t.value.includes('Music:'));
      expect(box?.value).toContain('Music: Still Waters by A. Composer');
    });
  });
  it('a new story is created in the chosen output frame', async () => {
    const create = vi.spyOn(storyApi, 'createProject').mockResolvedValue(mkDraft());
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(mkDraft());
    vi.spyOn(storyApi, 'process').mockResolvedValue(undefined as any);
    vi.spyOn(storyApi, 'scriptToAudio').mockResolvedValue('/out/story-tts-1.mp3');
    renderPage();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /output frame/i }), 'square');
    await userEvent.click(screen.getByRole('button', { name: /write a script/i }));
    await userEvent.type(screen.getByLabelText(/your idea/i), 'hope');
    await userEvent.click(screen.getByRole('button', { name: /generate voiceover/i }));
    await userEvent.click(await screen.findByRole('button', { name: /use full audio/i }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][3]).toBe('square');
  });

  it('long-form stories are landscape, so the frame picker gives way to a note', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { templates: [] } } as never);
    renderPage();
    expect(screen.getByRole('combobox', { name: /output frame/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /long-form/i }));
    expect(screen.queryByRole('combobox', { name: /output frame/i })).not.toBeInTheDocument();
    expect(screen.getByText(/long-form videos are landscape/i)).toBeInTheDocument();
  });

  it('a finished story can change its frame and render again', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'pd');
    const done = {
      projectId: 'pd', title: 'Done', style: 'cinematic-bible', status: 'done', aspect: 'portrait',
      source: { audioPath: 'a', durationMs: 8000 }, transcript: { words: [], hash: 'h' },
      scenes: [{ id: 'scene-001', text: 'a', startMs: 0, endMs: 8000, imagePrompt: 'p', imagePath: '/a.png', imageUrl: '/outputs/x.png', imageStatus: 'done', promptEditedByUser: false }],
      music: { path: null, volume: 0.3 }, captionPreset: 'default',
      render: { jobId: null, outputPath: 'o', status: 'done' }, error: null, createdAt: 0, updatedAt: 0,
    } as any;
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(done);
    vi.spyOn(api, 'get').mockResolvedValue({ ok: false, error: 'not in test' } as never);
    const setAspect = vi.spyOn(storyApi, 'setAspect').mockResolvedValue({ project: { ...done, aspect: 'landscape' }, note: '' });
    const renderSpy = vi.spyOn(storyApi, 'render').mockResolvedValue(done);
    renderPage();
    // Wait for the finished view: before the project loads, the new-story form
    // (with its own picker) is on screen.
    const again = await screen.findByRole('button', { name: /render again/i });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /output frame/i }), 'landscape');
    expect(setAspect).toHaveBeenCalledWith('pd', 'landscape');
    await userEvent.click(again);
    expect(renderSpy).toHaveBeenCalledWith('pd');
  });
  describe('AI motion note', () => {
    const note = '2 of 5 scenes animated: monthly AI budget reached';
    function withNote() {
      localStorage.setItem('BF_STORY_ACTIVE', 'pa');
      vi.spyOn(storyApi, 'getProject').mockResolvedValue({
        projectId: 'pa', title: 'T', style: 'cinematic-bible', status: 'ready_to_render',
        source: { audioPath: 'a', durationMs: 8000 }, transcript: { words: [], hash: 'h' },
        scenes: [{ id: 'scene-001', text: 'a', startMs: 0, endMs: 8000, imagePrompt: 'p', imagePath: '/a.png', imageUrl: '/outputs/x.png', imageStatus: 'done', promptEditedByUser: false }],
        music: { path: null, volume: 0.3 }, captionPreset: 'default',
        render: { jobId: null, outputPath: null, status: null }, error: null, createdAt: 0, updatedAt: 0,
        aiMotion: { quality: 'standard', autoStartedAt: 1, note },
      } as any);
      vi.spyOn(storyApi, 'estimateAnimation').mockResolvedValue({
        configured: true, quality: 'standard', running: false, clips: 1, seconds: 8, usd: 0.6, usdPerSecond: 0.0756,
        model: 'm', resolution: '720p', sceneIds: ['scene-001'], month: '2026-10', spentUsd: 0, reservedUsd: 0, capUsd: 30, monthClips: 0,
      });
    }
    afterEach(() => { useAuth.setState({ isSuperAdmin: false }); });

    it('a super admin sees why not every scene was animated', async () => {
      useAuth.setState({ isSuperAdmin: true });
      withNote();
      renderPage();
      expect(await screen.findByText(note)).toBeInTheDocument();
    });

    it('nobody else sees it', async () => {
      useAuth.setState({ isSuperAdmin: false });
      withNote();
      renderPage();
      expect(await screen.findByText('a')).toBeInTheDocument();
      expect(screen.queryByText(note)).toBeNull();
    });
  });
});
