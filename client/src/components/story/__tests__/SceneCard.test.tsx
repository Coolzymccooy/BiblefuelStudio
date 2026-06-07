import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SceneCard } from '../SceneCard';
import type { StoryScene } from '../../../lib/storyTypes';

function scene(over: Partial<StoryScene> = {}): StoryScene {
  return {
    id: 'scene-001', text: 'When life feels dark', startMs: 0, endMs: 8000,
    imagePrompt: 'a lonely figure', imagePath: '/a.png', imageUrl: '/outputs/genImg/p/part-1.png',
    imageStatus: 'done', promptEditedByUser: false, ...over,
  };
}

describe('SceneCard', () => {
  it('shows the caption text and time label', () => {
    render(<SceneCard scene={scene()} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} />);
    expect(screen.getByDisplayValue('When life feels dark')).toBeInTheDocument();
    expect(screen.getByText('0:00–0:08')).toBeInTheDocument();
  });

  it('patches the caption on blur when changed', async () => {
    const onPatch = vi.fn();
    render(<SceneCard scene={scene()} onPatch={onPatch} onRegenerate={vi.fn()} busy={false} />);
    const input = screen.getByDisplayValue('When life feels dark');
    await userEvent.clear(input);
    await userEvent.type(input, 'New caption');
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledWith('scene-001', { text: 'New caption' });
  });

  it('calls onRegenerate when Regenerate is clicked', async () => {
    const onRegenerate = vi.fn();
    render(<SceneCard scene={scene()} onPatch={vi.fn()} onRegenerate={onRegenerate} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(onRegenerate).toHaveBeenCalledWith('scene-001');
  });

  it('shows a retry affordance when the image errored', () => {
    render(<SceneCard scene={scene({ imageStatus: 'error', imageUrl: null })} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} />);
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });
});
