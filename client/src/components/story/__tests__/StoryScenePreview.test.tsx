import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StoryScenePreview } from '../StoryScenePreview';
import type { StoryScene } from '../../../lib/storyTypes';

vi.mock('../../AuthedImage', () => ({ AuthedImage: (p: { alt: string }) => <img alt={p.alt} /> }));

const scene = (over: Partial<StoryScene> = {}): StoryScene => ({
  id: 's1', text: 'Be still.', startMs: 0, endMs: 1000, imagePrompt: '', imagePath: null,
  imageUrl: null, imageStatus: 'pending', promptEditedByUser: false, ...over,
});

describe('StoryScenePreview', () => {
  it('labels the orientation from the project aspect, defaulting to portrait', () => {
    const { rerender } = render(<StoryScenePreview scenes={[scene()]} />);
    expect(screen.getByText(/Scene 1 \/ 1 · Portrait/)).toBeInTheDocument();
    rerender(<StoryScenePreview scenes={[scene()]} aspect="landscape" />);
    expect(screen.getByText(/Scene 1 \/ 1 · Landscape/)).toBeInTheDocument();
  });
});
