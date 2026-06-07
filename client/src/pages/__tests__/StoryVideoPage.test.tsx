import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { StoryVideoPage } from '../StoryVideoPage';
import { storyApi } from '../../lib/storyApi';
import userEvent from '@testing-library/user-event';

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
    vi.spyOn(storyApi, 'segment').mockResolvedValue(mkDraft());
    vi.spyOn(storyApi, 'generateImages').mockResolvedValue(mkDraft());
    return vi.spyOn(storyApi, 'transcribe').mockResolvedValue(mkDraft());
  }
  function pickFile() {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['xxxxxxxx'], 'sermon.mp3', { type: 'audio/mpeg' });
    fireEvent.change(input, { target: { files: [file] } });
  }

  it('shows step 1 (upload/setup) when there is no active project', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /story video/i })).toBeInTheDocument();
    expect(screen.getByText(/upload/i)).toBeInTheDocument();
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
    expect(await screen.findByDisplayValue('a')).toBeInTheDocument();
  });

  it('shows a Resume button for an interrupted (transient, idle) project and re-drives it', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p2');
    const proj = {
      projectId: 'p2', title: 'T', style: 'cinematic-bible', status: 'generating_images',
      source: { audioPath: 'a', durationMs: 8000 },
      transcript: { words: [{ text: 'w', startMs: 0, endMs: 500 }], hash: 'h' },
      scenes: [{ id: 'scene-001', text: 'a', startMs: 0, endMs: 8000, imagePrompt: 'p', imagePath: null, imageUrl: null, imageStatus: 'pending', promptEditedByUser: false }],
      music: { path: null, volume: 0.3 }, captionPreset: 'default',
      render: { jobId: null, outputPath: null, status: null }, error: null, createdAt: 0, updatedAt: 0,
    };
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(proj as any);
    const gen = vi.spyOn(storyApi, 'generateImages').mockResolvedValue(proj as any);
    const { default: userEvent } = await import('@testing-library/user-event');
    renderPage();
    const btn = await screen.findByRole('button', { name: /resume/i });
    await userEvent.click(btn);
    expect(gen).toHaveBeenCalledWith('p2');
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
    const transcribe = mockPipeline();
    renderPage();
    pickFile();
    expect(await screen.findByRole('button', { name: /use full audio/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /trim audio/i })).toBeInTheDocument();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('"Use full audio" runs the pipeline with the uploaded path', async () => {
    vi.spyOn(storyApi, 'uploadAudio').mockResolvedValue('/out/full.mp3');
    const transcribe = mockPipeline();
    renderPage();
    pickFile();
    await userEvent.click(await screen.findByRole('button', { name: /use full audio/i }));
    await waitFor(() => expect(transcribe).toHaveBeenCalledWith('np', '/out/full.mp3'));
  });

  it('"Trim audio" → apply runs the pipeline with the trimmed path', async () => {
    vi.spyOn(storyApi, 'uploadAudio').mockResolvedValue('/out/full.mp3');
    const transcribe = mockPipeline();
    renderPage();
    pickFile();
    await userEvent.click(await screen.findByRole('button', { name: /trim audio/i }));
    await userEvent.click(await screen.findByRole('button', { name: /trimmer-apply/i }));
    await waitFor(() => expect(transcribe).toHaveBeenCalledWith('np', '/out/trimmed.mp3'));
  });

  it('upload error returns to the form (no ready panel)', async () => {
    vi.spyOn(storyApi, 'uploadAudio').mockRejectedValue(new Error('upload boom'));
    renderPage();
    pickFile();
    await waitFor(() => expect(storyApi.uploadAudio).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /use full audio/i })).toBeNull();
    expect(screen.getByRole('button', { name: /upload a sermon/i })).toBeInTheDocument();
  });
});
