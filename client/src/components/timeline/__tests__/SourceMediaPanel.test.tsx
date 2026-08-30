import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourceMediaPanel, type SourceMediaPanelProps } from '../SourceMediaPanel';

function setup(over: Partial<SourceMediaPanelProps> = {}) {
  const props: SourceMediaPanelProps = {
    sourceMediaPath: '',
    sourceMediaKind: null,
    isUploading: false,
    hasProject: true,
    maxUploadMb: 1024,
    onUpload: vi.fn(),
    onPreviewSource: vi.fn(),
    onUseAsMusicBed: vi.fn(),
    onTrim: vi.fn(),
    onInsertSourceMedia: vi.fn(),
    onInsertVoiceoverPlaceholder: vi.fn(),
    onClear: vi.fn(),
    ...over,
  };
  render(<SourceMediaPanel {...props} />);
  return props;
}

describe('SourceMediaPanel', () => {
  it('offers Clear once media is loaded, so a stale image never sticks on the stage', async () => {
    const user = userEvent.setup();
    const props = setup({ sourceMediaPath: 'uploads/bg-image-1.jpg', sourceMediaKind: 'image' });
    await user.click(screen.getByRole('button', { name: /clear source media/i }));
    expect(props.onClear).toHaveBeenCalled();
  });

  it('hides Clear when nothing is loaded', () => {
    setup({ sourceMediaPath: null, sourceMediaKind: null });
    expect(screen.queryByRole('button', { name: /clear source media/i })).not.toBeInTheDocument();
  });
  it('states the upload limit so the user knows before choosing a file', () => {
    setup({ maxUploadMb: 512 });
    expect(screen.getByText(/512 MB/)).toBeInTheDocument();
  });

  it('shows the loaded file name and kind once media exists', () => {
    setup({ sourceMediaPath: '/uploads/sermon-final.mp4', sourceMediaKind: 'video' });
    expect(screen.getByText('sermon-final.mp4')).toBeInTheDocument();
    // The kind is now a compact caption beside the name rather than the
    // sentence "Loaded (video):", which out-shouted the controls.
    expect(screen.getByText('video')).toBeInTheDocument();
  });

  it('shows no actions until media is loaded', () => {
    setup();
    expect(screen.queryByRole('button', { name: /insert source media/i })).not.toBeInTheDocument();
  });

  it('reflects the uploading state on the picker', () => {
    setup({ isUploading: true });
    expect(screen.getByText('Uploading...')).toBeInTheDocument();
  });

  it('explains why insert is unavailable when there is no project', () => {
    setup({ hasProject: false });
    expect(screen.getByText(/create a documentary timeline first/i)).toBeInTheDocument();
  });

  describe('actions by media kind', () => {
    it('offers Preview source only for video', () => {
      setup({ sourceMediaPath: '/a.mp4', sourceMediaKind: 'video' });
      expect(screen.getByRole('button', { name: /preview source/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /music bed/i })).not.toBeInTheDocument();
    });

    it('offers Use as Music Bed only for audio', () => {
      setup({ sourceMediaPath: '/a.mp3', sourceMediaKind: 'audio' });
      expect(screen.getByRole('button', { name: /music bed/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /preview source/i })).not.toBeInTheDocument();
    });

    it('hides Trim for images, which have nothing to trim', () => {
      setup({ sourceMediaPath: '/a.png', sourceMediaKind: 'image' });
      expect(screen.queryByRole('button', { name: /trim/i })).not.toBeInTheDocument();
    });

    it('offers Trim for audio and video', () => {
      setup({ sourceMediaPath: '/a.mp3', sourceMediaKind: 'audio' });
      expect(screen.getByRole('button', { name: /trim/i })).toBeInTheDocument();
    });
  });

  describe('proxy status badge', () => {
    it('shows the proxy state for video', () => {
      setup({
        sourceMediaPath: '/a.mp4', sourceMediaKind: 'video',
        sourceMediaProxyPath: '/p.mp4', sourceMediaProxyStatus: 'ready',
      });
      expect(screen.getByText(/proxy ready/i)).toBeInTheDocument();
    });

    it('treats an unknown status as pending rather than showing nothing', () => {
      setup({
        sourceMediaPath: '/a.mp4', sourceMediaKind: 'video',
        sourceMediaProxyPath: '/p.mp4', sourceMediaProxyStatus: null,
      });
      expect(screen.getByText(/proxy pending/i)).toBeInTheDocument();
    });

    it('shows no badge when there is no proxy', () => {
      setup({ sourceMediaPath: '/a.mp4', sourceMediaKind: 'video' });
      expect(screen.queryByText(/proxy/i)).not.toBeInTheDocument();
    });
  });

  describe('disabled states', () => {
    it('disables insert actions without a project', () => {
      setup({ sourceMediaPath: '/a.mp4', sourceMediaKind: 'video', hasProject: false });
      expect(screen.getByRole('button', { name: /insert source media/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /insert vo placeholder/i })).toBeDisabled();
    });

    it('enables insert actions when a project exists', () => {
      setup({ sourceMediaPath: '/a.mp4', sourceMediaKind: 'video', hasProject: true });
      expect(screen.getByRole('button', { name: /insert source media/i })).toBeEnabled();
    });
  });

  describe('handlers', () => {
    it('passes the media path to the music-bed handler', async () => {
      const user = userEvent.setup();
      const props = setup({ sourceMediaPath: '/x/bed.mp3', sourceMediaKind: 'audio' });
      await user.click(screen.getByRole('button', { name: /music bed/i }));
      expect(props.onUseAsMusicBed).toHaveBeenCalledWith('/x/bed.mp3');
    });

    it('fires insert and trim handlers', async () => {
      const user = userEvent.setup();
      const props = setup({ sourceMediaPath: '/a.mp4', sourceMediaKind: 'video' });
      await user.click(screen.getByRole('button', { name: /trim/i }));
      expect(props.onTrim).toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: /insert source media/i }));
      expect(props.onInsertSourceMedia).toHaveBeenCalled();
    });
  });
});
