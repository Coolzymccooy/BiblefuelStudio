import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { StoryVideoPage } from '../StoryVideoPage';
import { storyApi } from '../../lib/storyApi';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(StoryVideoPage)),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('StoryVideoPage', () => {
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
});
