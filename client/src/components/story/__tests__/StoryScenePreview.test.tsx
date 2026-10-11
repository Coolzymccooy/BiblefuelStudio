import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('marks a reused image so the operator knows it cost no quota', () => {
    render(<StoryScenePreview scenes={[scene({ imageStatus: 'done', imageUrl: '/outputs/imageLib/a.png', imageSource: 'library' })]} aspect="landscape" />);
    expect(screen.getByText(/Reused/)).toBeInTheDocument();
  });

  it('says nothing for a freshly generated image', () => {
    render(<StoryScenePreview scenes={[scene({ imageStatus: 'done', imageUrl: '/o/gen-1.png', imageSource: 'generated' })]} aspect="landscape" />);
    expect(screen.queryByText(/Reused/)).not.toBeInTheDocument();
  });

  it('says nothing for a scene from before the library existed', () => {
    render(<StoryScenePreview scenes={[scene()]} />);
    expect(screen.queryByText(/Reused/)).not.toBeInTheDocument();
  });

  it('plays a scene\'s own clip, muted and looping, inline on a phone', () => {
    const { container } = render(<StoryScenePreview scenes={[scene({
      imageStatus: 'done', imageUrl: '/outputs/bg-video-x-poster.jpg', imageSource: 'upload',
      mediaKind: 'video', videoUrl: '/outputs/bg-video-x.mp4',
    })]} />);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.getAttribute('src')).toMatch(/\/outputs\/bg-video-x\.mp4$/);
    expect(video!.muted).toBe(true);
    expect(video!.loop).toBe(true);
    expect(video!.hasAttribute('playsinline')).toBe(true);
    expect(video!.className).toMatch(/object-cover/);
    expect(screen.queryByAltText('Be still.')).not.toBeInTheDocument();
  });

  it('a still scene stays a picture', () => {
    const { container } = render(<StoryScenePreview scenes={[scene({ imageStatus: 'done', imageUrl: '/o/gen-1.png', mediaKind: 'image' })]} />);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByAltText('Be still.')).toBeInTheDocument();
  });

  it('a clip that will not play falls back to its poster', async () => {
    const { container } = render(<StoryScenePreview scenes={[scene({
      imageStatus: 'done', imageUrl: '/outputs/bg-video-x-poster.jpg', mediaKind: 'video', videoUrl: '/outputs/bg-video-x.mp4',
    })]} />);
    fireEvent.error(container.querySelector('video')!);
    expect(container.querySelector('video')).toBeNull();
    expect(await screen.findByAltText('Be still.')).toBeInTheDocument();
  });
});
