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
  it('shows the caption text, and reveals the editor + time label when tuned', async () => {
    render(<SceneCard scene={scene()} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} />);
    // Caption is shown as read-only text until the tune panel is opened.
    expect(screen.getByText('When life feels dark')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /tune scene/i }));
    expect(screen.getByDisplayValue('When life feels dark')).toBeInTheDocument();
    expect(screen.getByText('0:00–0:08')).toBeInTheDocument();
  });

  it('patches the caption on blur when changed', async () => {
    const onPatch = vi.fn();
    render(<SceneCard scene={scene()} index={0} onPatch={onPatch} onRegenerate={vi.fn()} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: /tune scene/i }));
    const input = screen.getByDisplayValue('When life feels dark');
    await userEvent.clear(input);
    await userEvent.type(input, 'New caption');
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledWith('scene-001', { text: 'New caption' });
  });

  it('calls onRegenerate when Regenerate is clicked', async () => {
    const onRegenerate = vi.fn();
    render(<SceneCard scene={scene()} index={0} onPatch={vi.fn()} onRegenerate={onRegenerate} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: /tune scene/i }));
    await userEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(onRegenerate).toHaveBeenCalledWith('scene-001');
  });

  it('shows a Failed status when the image errored', () => {
    render(<SceneCard scene={scene({ imageStatus: 'error', imageUrl: null })} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} />);
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });

  describe('your own picture', () => {
    const own = { onUpload: vi.fn(), onChooseFromLibrary: vi.fn() };

    it('a scene without a picture offers Upload and From library straight away', async () => {
      const onChooseFromLibrary = vi.fn();
      render(<SceneCard scene={scene({ imageStatus: 'error', imageUrl: null })} index={2} onPatch={vi.fn()} onRegenerate={vi.fn()}
        busy={false} onUpload={vi.fn()} onChooseFromLibrary={onChooseFromLibrary} />);
      expect(screen.getByRole('button', { name: 'Upload image or video for scene 3' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Choose image for scene 3 from library' }));
      expect(onChooseFromLibrary).toHaveBeenCalledWith('scene-001');
    });

    it('a scene with a picture keeps them inside Tune, out of the way', async () => {
      render(<SceneCard scene={scene()} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} {...own} />);
      expect(screen.queryByRole('button', { name: /upload image/i })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /tune scene/i }));
      expect(screen.getByRole('button', { name: 'Upload image or video for scene 1' })).toBeInTheDocument();
    });

    it('a chosen photo is handed over with its scene', async () => {
      const onUpload = vi.fn();
      render(<SceneCard scene={scene({ imageStatus: 'error' })} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} onUpload={onUpload} />);
      const photo = new File(['x'], 'Scene 1.png', { type: 'image/png' });
      await userEvent.upload(screen.getByLabelText('Image or video file for scene 1'), photo);
      expect(onUpload).toHaveBeenCalledWith('scene-001', photo);
    });

    it('takes a video clip as well as a photo, and says so', async () => {
      const onUpload = vi.fn();
      render(<SceneCard scene={scene({ imageStatus: 'error', imageUrl: null })} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} onUpload={onUpload} />);
      expect(screen.getByRole('button', { name: 'Upload image or video for scene 1' })).toHaveTextContent('Upload image or video');
      const input = screen.getByLabelText('Image or video file for scene 1');
      const accept = (input.getAttribute('accept') || '').split(',');
      expect(accept).toEqual(expect.arrayContaining(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']));
      const clip = new File(['x'], 'pixabay-sunrise.mp4', { type: 'video/mp4' });
      await userEvent.upload(input, clip);
      expect(onUpload).toHaveBeenCalledWith('scene-001', clip);
    });

    it('a scene playing your own clip shows a Video badge', () => {
      const { rerender } = render(<SceneCard scene={scene({ imageChosenByUser: true, imageSource: 'upload', mediaKind: 'video', videoUrl: '/outputs/bg-video-x.mp4' })}
        index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} />);
      expect(screen.getByText('Video')).toBeInTheDocument();
      rerender(<SceneCard scene={scene({ mediaKind: 'image' })} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} />);
      expect(screen.queryByText('Video')).not.toBeInTheDocument();
    });

    it('a scene a cancelled run left "generating" still offers your own picture; a live run does not', () => {
      const stuck = scene({ imageStatus: 'generating', imageUrl: null });
      const { rerender } = render(<SceneCard scene={stuck} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} {...own} />);
      expect(screen.getByRole('button', { name: 'Upload image or video for scene 1' })).toBeInTheDocument();
      rerender(<SceneCard scene={stuck} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} {...own} imagesRunning />);
      expect(screen.queryByRole('button', { name: 'Upload image or video for scene 1' })).not.toBeInTheDocument();
    });

    it('a picture you chose says so', () => {
      render(<SceneCard scene={scene({ imageChosenByUser: true, imageSource: 'upload' })} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} />);
      expect(screen.getByText('Your image')).toBeInTheDocument();
    });

    it('Copy prompt copies the scene\'s image prompt', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      render(<SceneCard scene={scene()} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} />);
      await userEvent.click(screen.getByRole('button', { name: /tune scene/i }));
      await userEvent.click(screen.getByRole('button', { name: 'Copy image prompt for scene 1' }));
      expect(writeText).toHaveBeenCalledWith('a lonely figure');
    });

    it('Copy prompt copies the prompt as just edited, before the save comes back', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      render(<SceneCard scene={scene()} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} />);
      await userEvent.click(screen.getByRole('button', { name: /tune scene/i }));
      await userEvent.click(screen.getByRole('button', { name: /edit image prompt/i }));
      const box = screen.getByLabelText('Image prompt');
      await userEvent.clear(box);
      await userEvent.type(box, 'a shepherd at dawn');
      await userEvent.click(screen.getByRole('button', { name: 'Copy image prompt for scene 1' }));
      expect(writeText).toHaveBeenCalledWith('a shepherd at dawn');
    });
  });
});
