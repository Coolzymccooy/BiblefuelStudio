import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { storyApi } from '../../../lib/storyApi';
import { longformApi } from '../../../lib/longformApi';
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

const LONGFORM_DRAFT = {
  projectId: 'lf1',
  title: 'Psalms for Rest',
  style: 'cinematic-bible',
  status: 'draft_script',
  aspect: 'landscape',
  updatedAt: Date.now(),
  scenes: [],
  transcript: { words: [] },
  render: { outputPath: null },
  longform: {
    templateId: 'sleep-30',
    sections: [
      { heading: 'Welcome', text: 'a', targetSec: 60 },
      { heading: 'Psalm 23', text: 'b', targetSec: 300 },
      { heading: 'Closing', text: 'c', targetSec: 60 },
    ],
  },
};

describe('StoryQuickPanel', () => {
  it("offers a Long-form entry mode in the editor, sharing the Story page's drafting flow", async () => {
    const user = userEvent.setup();
    vi.spyOn(longformApi, 'listTemplates').mockResolvedValue([{ id: 'sleep-30', label: 'Scripture Sleep Session · 30 min', targetSec: 1800 }] as any);
    const draft = vi.spyOn(longformApi, 'draft').mockResolvedValue({ project: LONGFORM_DRAFT } as any);
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(LONGFORM_DRAFT as any);
    renderWith(<StoryQuickPanel onUseVideo={() => {}} onPreviewVideo={() => {}} />);
    await user.click(screen.getByRole('button', { name: /long-form/i }));
    await user.type(await screen.findByLabelText(/what's on your heart/i), "psalms for when I can't sleep");
    await user.click(screen.getByRole('button', { name: /write the outline/i }));
    expect(draft).toHaveBeenCalledWith(expect.objectContaining({ idea: "psalms for when I can't sleep" }));
    // The drafted project becomes the shared active project.
    expect(localStorage.getItem('BF_STORY_ACTIVE')).toBe('lf1');
    expect(await screen.findByText('Psalms for Rest')).toBeInTheDocument();
  });

  it('shows the outline summary for a draft and can start narration from the editor', async () => {
    const user = userEvent.setup();
    localStorage.setItem('BF_STORY_ACTIVE', 'lf1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(LONGFORM_DRAFT as any);
    const narrate = vi.spyOn(longformApi, 'narrate').mockResolvedValue({ ...LONGFORM_DRAFT, status: 'narrating' } as any);
    renderWith(<StoryQuickPanel onUseVideo={() => {}} onPreviewVideo={() => {}} />);
    expect(await screen.findByText(/3 sections/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review .*story page/i })).toHaveAttribute('href', '/app/story');
    await user.click(screen.getByRole('button', { name: /generate narration/i }));
    expect(narrate).toHaveBeenCalledWith('lf1', expect.any(String));
  });

  it('shows the narration chunk counter while narrating', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'lf1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue({ ...LONGFORM_DRAFT, status: 'narrating', longform: { ...LONGFORM_DRAFT.longform, progress: { done: 4, total: 20, provider: 'azure', alive: true } } } as any);
    renderWith(<StoryQuickPanel onUseVideo={() => {}} onPreviewVideo={() => {}} />);
    expect(await screen.findByText(/Generating narration/i)).toBeInTheDocument();
    expect(screen.getByText('4/20')).toBeInTheDocument();
  });

  it('offers the entry form when no project is active', () => {
    renderWith(<StoryQuickPanel onUseVideo={() => {}} onPreviewVideo={() => {}} />);
    expect(screen.getByPlaceholderText('Trusting God in the waiting')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /visual style/i })).toBeInTheDocument();
    expect(screen.getByText(/Upload a sermon/i)).toBeInTheDocument();
  });

  it('the upload button actually opens the file picker', async () => {
    // The styled drop area LOOKED clickable but was not - regression guard.
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    renderWith(<StoryQuickPanel onUseVideo={() => {}} onPreviewVideo={() => {}} />);
    await user.click(screen.getByRole('button', { name: /upload a sermon/i }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('tracks the SAME active project as the Story page (shared key)', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(DONE_PROJECT as any);
    renderWith(<StoryQuickPanel onUseVideo={() => {}} onPreviewVideo={() => {}} />);
    expect(await screen.findByText('Trusting God in the waiting')).toBeInTheDocument();
  });

  it('LANDS the finished render on the timeline as source media', async () => {
    const user = userEvent.setup();
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(DONE_PROJECT as any);
    const onUseVideo = vi.fn();
    renderWith(<StoryQuickPanel onUseVideo={onUseVideo} onPreviewVideo={() => {}} />);
    await user.click(await screen.findByRole('button', { name: /use as source media/i }));
    // Leading slash: mediaUrl keeps /outputs/ paths intact; a bare relative
    // path is stripped to its basename - a 404 for this nested dir.
    expect(onUseVideo).toHaveBeenCalledWith('/outputs/story/p1/video.mp4');
  });

  it('previews the finished render ON THE STAGE, without leaving the editor', async () => {
    const user = userEvent.setup();
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(DONE_PROJECT as any);
    const onPreviewVideo = vi.fn();
    renderWith(<StoryQuickPanel onUseVideo={() => {}} onPreviewVideo={onPreviewVideo} />);
    await user.click(await screen.findByRole('button', { name: /preview on stage/i }));
    expect(onPreviewVideo).toHaveBeenCalledWith('/outputs/story/p1/video.mp4');
  });

  it('offers the real recovery actions when the pipeline errored', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue({
      ...DONE_PROJECT,
      status: 'error',
      error: 'cancelled by user',
      render: {},
    } as any);
    renderWith(<StoryQuickPanel onUseVideo={() => {}} onPreviewVideo={() => {}} />);
    expect(await screen.findByText(/pick up where you left off/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument();
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
    renderWith(<StoryQuickPanel onUseVideo={() => {}} onPreviewVideo={() => {}} />);
    const btn = await screen.findByRole('button', { name: /waiting for all images/i });
    expect(btn).toBeDisabled();
    // Classic parity: the music config is available at step 2, not hidden.
    expect(screen.getByRole('group', { name: /background music/i })).toBeInTheDocument();
    // The classic page's on-the-fly scene preview is here too, before the
    // final render exists.
    expect(screen.getByText(/Scene 1 \/ 2/)).toBeInTheDocument();
  });

  it('shows WHICH image failed and WHY, with a targeted regenerate', async () => {
    const user = userEvent.setup();
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    const project = {
      ...DONE_PROJECT,
      status: 'ready_to_render',
      render: {},
      scenes: [
        { id: 'sc1', text: 'x', imagePrompt: 'y', imageStatus: 'done', startMs: 0, endMs: 9000 },
        { id: 'sc2', text: 'z', imagePrompt: 'w', imageStatus: 'error', imageError: 'Daily image quota reached', startMs: 9000, endMs: 18000 },
      ],
    };
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(project as any);
    const regen = vi.spyOn(storyApi, 'regenerateScene').mockResolvedValue({
      ...project,
      scenes: project.scenes.map((s) => (s.id === 'sc2' ? { ...s, imageStatus: 'done' } : s)),
    } as any);
    renderWith(<StoryQuickPanel onUseVideo={() => {}} onPreviewVideo={() => {}} />);
    // Insight: the actual failure reason is visible, not just a dead button.
    expect(await screen.findByText('Daily image quota reached')).toBeInTheDocument();
    expect(screen.getAllByText(/1 failed/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(regen).toHaveBeenCalledWith('p1', 'sc2');
  });
});
