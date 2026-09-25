import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { AmbientLookStep } from '../AmbientLookStep';
import { ambientApi } from '../../../lib/ambientApi';
import * as mediaUpload from '../../../lib/mediaUpload';
import { api } from '../../../lib/api';
import type { AmbientMovement, AmbientProject, AmbientStatus } from '../../../lib/ambientTypes';

const movement = (over: Partial<AmbientMovement> = {}): AmbientMovement => ({
  id: 'm1', startMs: 0, endMs: 600_000, imagePrompt: 'storm', imagePath: null, imageUrl: null,
  imageStatus: 'pending', ...over,
});

const project = (status: AmbientStatus = 'draft', movements = [movement()]): AmbientProject => ({
  projectId: 'p1', title: 'T', theme: 'peace', translation: 'kjv', targetSec: 600, aspect: 'landscape',
  status,
  bed: { mode: 'assemble', trackRefs: [], filePath: null, crossfadeSec: 6, volume: 0.85 },
  drops: [], movements, motion: 'still', captions: 'none', captionPreset: 'default',
  duck: { threshold: 0.02, ratio: 8, attackMs: 20, releaseMs: 800 },
  render: { jobId: null, outputPath: null, status: null }, error: null, createdAt: 0, updatedAt: 0,
} as AmbientProject);

function renderStep(p: AmbientProject, refresh = vi.fn()) {
  render(<AmbientLookStep project={p} busy={false} setBusy={() => {}} refresh={refresh} />);
  return { refresh };
}

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'sunrise.png', { type: 'image/png' });

beforeEach(() => {
  vi.restoreAllMocks();
  // StoryCaptionsPanel loads its catalogue; nothing here depends on it.
  vi.spyOn(api, 'get').mockResolvedValue({ ok: false, status: 404, error: 'not mocked' } as never);
});

describe('AmbientLookStep — your own pictures', () => {
  it('every movement can take an upload, a library pick, or a fresh generation', () => {
    renderStep(project());
    expect(screen.getByRole('button', { name: 'Upload photo for movement 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose from library for movement 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate movement 1' })).toBeInTheDocument();
  });

  it('says what each action does in words — a phone shows no hover tooltip', () => {
    // Icon-only, the upload button went unnoticed on an iPhone.
    renderStep(project());
    expect(screen.getByRole('button', { name: 'Upload photo for movement 1' })).toHaveTextContent('Upload photo');
    expect(screen.getByRole('button', { name: 'Choose from library for movement 1' })).toHaveTextContent('Library');
    expect(screen.getByRole('button', { name: 'Regenerate movement 1' })).toHaveTextContent('Regenerate');
  });

  it('an uploaded photo is attached to that movement', async () => {
    const upload = vi.spyOn(mediaUpload, 'uploadMedia').mockResolvedValue({ file: '/out/bg-image-x.png', kind: 'image' });
    const attach = vi.spyOn(ambientApi, 'setMovementImage').mockResolvedValue(project());
    const { refresh } = renderStep(project());

    await userEvent.upload(screen.getByLabelText('Photo file for movement 1'), png());

    await waitFor(() => expect(attach).toHaveBeenCalledWith('p1', 'm1', { uploadPath: '/out/bg-image-x.png' }));
    expect(upload.mock.calls[0][2]).toBe('background');
    expect(refresh).toHaveBeenCalled();
  });

  it('a video is refused with a plain reason, and nothing is attached', async () => {
    vi.spyOn(mediaUpload, 'uploadMedia').mockResolvedValue({ file: '/out/bg-video-x.mp4', kind: 'video' });
    const attach = vi.spyOn(ambientApi, 'setMovementImage');
    const err = vi.spyOn(toast, 'error');
    renderStep(project());

    const clip = new File([new Uint8Array([0])], 'clip.mp4', { type: 'video/mp4' });
    await userEvent.upload(screen.getByLabelText('Photo file for movement 1'), clip, { applyAccept: false });

    await waitFor(() => expect(err).toHaveBeenCalledWith(expect.stringMatching(/photo/i)));
    expect(attach).not.toHaveBeenCalled();
  });

  it('the server’s reason reaches the operator when an attach fails', async () => {
    vi.spyOn(mediaUpload, 'uploadMedia').mockResolvedValue({ file: '/out/bg-image-x.jpg', kind: 'image' });
    vi.spyOn(ambientApi, 'setMovementImage').mockRejectedValue(new Error('Save it as JPG or PNG'));
    const err = vi.spyOn(toast, 'error');
    renderStep(project());

    await userEvent.upload(screen.getByLabelText('Photo file for movement 1'), png());
    await waitFor(() => expect(err).toHaveBeenCalledWith('Save it as JPG or PNG'));
  });

  it('the library opens a picker and the chosen picture is attached by id', async () => {
    vi.spyOn(ambientApi, 'listLibraryImages').mockResolvedValue([
      { id: 'img_a', url: '/outputs/imagelib-a.png', aspect: 'landscape', source: 'generated', createdAt: 2 },
      { id: 'img_b', url: '/outputs/imagelib-b.jpg', aspect: 'landscape', source: 'upload', createdAt: 1 },
    ]);
    const attach = vi.spyOn(ambientApi, 'setMovementImage').mockResolvedValue(project());
    renderStep(project());

    await userEvent.click(screen.getByRole('button', { name: 'Choose from library for movement 1' }));
    const picker = await screen.findByRole('dialog', { name: /movement 1/i });
    await userEvent.click(within(picker).getByRole('button', { name: /uploaded picture/i }));

    await waitFor(() => expect(attach).toHaveBeenCalledWith('p1', 'm1', { libraryId: 'img_b' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('an empty library says what to do instead', async () => {
    vi.spyOn(ambientApi, 'listLibraryImages').mockResolvedValue([]);
    renderStep(project());
    await userEvent.click(screen.getByRole('button', { name: 'Choose from library for movement 1' }));
    expect(await screen.findByText(/no pictures yet/i)).toBeInTheDocument();
  });

  it('regenerate redoes only that movement', async () => {
    const regen = vi.spyOn(ambientApi, 'regenerateMovement').mockResolvedValue(project('generating_images'));
    renderStep(project('ready_to_render', [movement({ imageStatus: 'done', imageUrl: '/outputs/a.png', imagePath: '/a.png' })]));
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate movement 1' }));
    await waitFor(() => expect(regen).toHaveBeenCalledWith('p1', 'm1'));
  });

  it('nothing on a tile can be changed while images generate or a render runs', () => {
    renderStep(project('generating_images'));
    for (const name of ['Upload photo for movement 1', 'Choose from library for movement 1', 'Regenerate movement 1']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('says where a picture came from', () => {
    renderStep(project('ready_to_render', [movement({ imageStatus: 'done', imageUrl: '/outputs/a.jpg', imagePath: '/a.jpg', imageSource: 'upload' })]));
    expect(screen.getByText('Your photo')).toBeInTheDocument();
  });
});

describe('AmbientLookStep — motion', () => {
  it('shows the motion choice alongside the pictures', () => {
    renderStep(project());
    expect(screen.getByRole('radiogroup', { name: /motion/i })).toBeInTheDocument();
  });
});
