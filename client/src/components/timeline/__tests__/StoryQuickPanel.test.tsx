import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { storyApi } from '../../../lib/storyApi';
import { StoryQuickPanel } from '../StoryQuickPanel';

function renderWith(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const DONE_PROJECT = {
  projectId: 'p1',
  title: 'Trusting God in the waiting',
  style: 'cinematic-bible',
  status: 'done',
  updatedAt: Date.now(),
  scenes: [
    { id: 'sc1', text: 'x', imagePrompt: 'y', imageStatus: 'done', startMs: 0, endMs: 9000 },
  ],
  transcript: { words: [{ w: 'x', s: 0, e: 1 }] },
  render: { outputPath: '/app/outputs/story/p1/video.mp4' },
};

describe('StoryQuickPanel', () => {
  it('offers the entry form when no project is active', () => {
    renderWith(<StoryQuickPanel onUseVideo={() => {}} />);
    expect(screen.getByPlaceholderText('Trusting God in the waiting')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /visual style/i })).toBeInTheDocument();
    expect(screen.getByText(/Upload a sermon/i)).toBeInTheDocument();
  });

  it('the upload button actually opens the file picker', async () => {
    // The styled drop area LOOKED clickable but was not - regression guard.
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    renderWith(<StoryQuickPanel onUseVideo={() => {}} />);
    await user.click(screen.getByRole('button', { name: /upload a sermon/i }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('tracks the SAME active project as the Story page (shared key)', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(DONE_PROJECT as any);
    renderWith(<StoryQuickPanel onUseVideo={() => {}} />);
    expect(await screen.findByText('Trusting God in the waiting')).toBeInTheDocument();
  });

  it('LANDS the finished render on the timeline as source media', async () => {
    const user = userEvent.setup();
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(DONE_PROJECT as any);
    const onUseVideo = vi.fn();
    renderWith(<StoryQuickPanel onUseVideo={onUseVideo} />);
    await user.click(await screen.findByRole('button', { name: /use as source media/i }));
    expect(onUseVideo).toHaveBeenCalledWith('outputs/story/p1/video.mp4');
  });

  it('offers the real recovery actions when the pipeline errored', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue({
      ...DONE_PROJECT,
      status: 'error',
      error: 'cancelled by user',
      render: {},
    } as any);
    renderWith(<StoryQuickPanel onUseVideo={() => {}} />);
    expect(await screen.findByText(/pick up where you left off/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry failed images/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /re-segment/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start over/i })).toBeInTheDocument();
  });

  it('gates Render on all images being ready, like the Story page', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue({
      ...DONE_PROJECT,
      status: 'ready_to_render',
      render: {},
      scenes: [
        { id: 'sc1', text: 'x', imagePrompt: 'y', imageStatus: 'done', startMs: 0, endMs: 9000 },
        { id: 'sc2', text: 'z', imagePrompt: 'w', imageStatus: 'error', startMs: 9000, endMs: 18000 },
      ],
    } as any);
    renderWith(<StoryQuickPanel onUseVideo={() => {}} />);
    const btn = await screen.findByRole('button', { name: /waiting for all images/i });
    expect(btn).toBeDisabled();
  });
});
