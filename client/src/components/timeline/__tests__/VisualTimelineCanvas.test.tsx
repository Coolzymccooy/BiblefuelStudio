import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { buildWorshipDocumentaryProject, insertAssetOnTrack } from '../../../lib/timelineProject';
import { VisualTimelineCanvas } from '../VisualTimelineCanvas';

describe('VisualTimelineCanvas', () => {
  test('renders scene ruler, multi-track lanes and empty CapCut-like drop targets', () => {
    const project = buildWorshipDocumentaryProject({ title: 'Lighthouse Praise' });

    render(<VisualTimelineCanvas project={project} />);

    expect(screen.getByText('Visual timeline')).toBeInTheDocument();
    expect(screen.getByText('Opening / Arrival')).toBeInTheDocument();
    expect(screen.getByText('Intense dance')).toBeInTheDocument();
    expect(screen.getByLabelText('Scene block: Opening / Arrival')).toHaveAttribute('draggable', 'true');

    const videoTrack = screen.getByLabelText('Track lane: Real footage');
    expect(within(videoTrack).getByText(/No footage yet/)).toBeInTheDocument();
    expect(screen.getByLabelText('Track lane: AI B-roll / GFX')).toBeInTheDocument();
    expect(screen.getByLabelText('Track lane: Voice-over')).toBeInTheDocument();
    expect(screen.getByText(/target 4:30/i)).toBeInTheDocument();
  });

  test('renders draggable timeline clip blocks from project tracks', () => {
    const base = buildWorshipDocumentaryProject({ title: 'Clip test' });
    const project = insertAssetOnTrack(base, {
      trackKind: 'broll',
      asset: {
        id: 'veo-glory-rays',
        kind: 'video',
        source: 'veo',
        label: 'Golden worship light rays',
        path: '/outputs/videoGen/golden-rays.mp4',
        durationSec: 8,
        aspect: '16:9',
        tags: ['ai_broll'],
      },
      startSec: 30,
      durationSec: 8,
      fit: 'contain',
    });

    render(<VisualTimelineCanvas project={project} />);

    const clip = screen.getByLabelText('Timeline clip: Golden worship light rays');
    expect(clip).toHaveAttribute('draggable', 'true');
    expect(clip).toHaveTextContent('Veo');
    expect(clip).toHaveTextContent('8s');
  });

  test('selects a clip and exposes split/remove actions', async () => {
    const user = userEvent.setup();
    const onProjectChange = vi.fn();
    const base = buildWorshipDocumentaryProject({ title: 'Clip actions' });
    const project = insertAssetOnTrack(base, {
      trackKind: 'broll',
      asset: {
        id: 'veo-glory-rays',
        kind: 'video',
        source: 'veo',
        label: 'Golden worship light rays',
        durationSec: 8,
        aspect: '16:9',
        tags: ['ai_broll'],
      },
      startSec: 30,
      durationSec: 8,
      fit: 'contain',
    });

    render(<VisualTimelineCanvas project={project} onProjectChange={onProjectChange} />);

    await user.click(screen.getByLabelText('Timeline clip: Golden worship light rays'));
    expect(screen.getByText('Selected clip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /split clip/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove clip/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /split clip/i }));
    expect(onProjectChange).toHaveBeenCalledTimes(1);
    const splitProject = onProjectChange.mock.calls[0][0];
    const broll = splitProject.tracks.find((track: any) => track.kind === 'broll');
    expect(broll.clips).toHaveLength(2);
    expect(broll.clips.map((clip: any) => Math.round(clip.durationSec))).toEqual([4, 4]);
  });

  test('shows proxy status for uploaded video assets on timeline clips', () => {
    const base = buildWorshipDocumentaryProject({ title: 'Proxy badge' });
    const project = insertAssetOnTrack(base, {
      trackKind: 'video',
      asset: {
        id: 'asset-large-upload',
        kind: 'video',
        source: 'upload',
        label: '700MB praise night.mov',
        path: '/outputs/source-video.mov',
        proxyPath: '/outputs/source-video-proxy.mp4',
        proxyStatus: 'pending',
        durationSec: 30,
        aspect: '16:9',
        tags: ['real_footage'],
      },
      startSec: 0,
      durationSec: 30,
    });

    render(<VisualTimelineCanvas project={project} />);

    const clip = screen.getByLabelText('Timeline clip: 700MB praise night.mov');
    expect(clip).toHaveTextContent('Proxy pending');
    expect(clip).toHaveAttribute('title', expect.stringContaining('preview: original'));
  });

  test('requests Veo b-roll generation with a scene-aware prompt', async () => {
    const user = userEvent.setup();
    const onRequestVeoBroll = vi.fn();
    const project = buildWorshipDocumentaryProject({ title: 'Veo request' });

    render(<VisualTimelineCanvas project={project} onRequestVeoBroll={onRequestVeoBroll} />);

    await user.click(screen.getByRole('button', { name: /request ai b-roll/i }));

    expect(onRequestVeoBroll).toHaveBeenCalledTimes(1);
    expect(onRequestVeoBroll.mock.calls[0][0]).toMatchObject({
      aspect: '16:9',
      durationSec: 8,
      targetTrackKind: 'broll',
    });
    expect(onRequestVeoBroll.mock.calls[0][0].prompt).toMatch(/worship|light|arrival/i);
  });
});


describe('clearing lanes', () => {
  test('offers Clear on a lane that has clips, and Wipe all in the toolbar', async () => {
    const { buildWorshipDocumentaryProject, insertAssetOnTrack } = await import('../../../lib/timelineProject');
    const base = buildWorshipDocumentaryProject({ title: 'T' });
    const project = insertAssetOnTrack(base, {
      trackKind: 'broll',
      asset: { id: 'a1', kind: 'image', source: 'upload', label: 'sky', path: 'uploads/sky.jpg' },
      startSec: 0, durationSec: 5,
    });
    const onClearLane = vi.fn();
    const onWipeAll = vi.fn();
    render(<VisualTimelineCanvas project={project} compact onClearLane={onClearLane} onWipeAll={onWipeAll} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear AI B-roll / GFX lane' }));
    expect(onClearLane).toHaveBeenCalledWith('broll');
    expect(screen.queryByRole('button', { name: 'Clear Real footage lane' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wipe all lanes' }));
    expect(onWipeAll).toHaveBeenCalled();
  });
});

// The waveform was gated on `!compact`, alongside the second text line of the
// clip label. But the two are not the same problem — a stacked LABEL wrapped
// and broke the 28px compact row, while a trace painted BEHIND the text costs
// no height at all. Since the timeline renders compact by default, that gate
// meant F4 never appeared on the screen the operator actually uses: the page
// showed zero <canvas> elements with an audio clip sitting right there.
describe('audio clip waveform (F4)', () => {
  const AUDIO = {
    id: 'vo-1',
    kind: 'audio' as const,
    source: 'upload' as const,
    label: 'Edge-TTS',
    path: 'C:/outputs/tts-edge.mp3',
    durationSec: 16.7,
  };

  function projectWithVoiceover() {
    const base = buildWorshipDocumentaryProject({ title: 'Waveform' });
    return insertAssetOnTrack(base, {
      trackKind: 'voiceover',
      asset: AUDIO,
      startSec: 0,
      durationSec: 16.7,
    });
  }

  async function renderWithPeaks(compact: boolean) {
    const { api } = await import('../../../lib/api');
    // Two buckets is enough: the draw loop samples peaks to the pixel width,
    // so the trace does not depend on how many it is given.
    vi.spyOn(api, 'get').mockResolvedValue({
      ok: true,
      data: { ok: true, peaks: [[-0.8, 0.8], [-0.4, 0.4]] },
    } as never);
    const view = render(
      compact
        ? <VisualTimelineCanvas project={projectWithVoiceover()} compact />
        : <VisualTimelineCanvas project={projectWithVoiceover()} />,
    );
    // The canvas only mounts once peaks resolve.
    await screen.findByText('Edge-TTS');
    return view;
  }

  test('draws the trace on a COMPACT clip — the default timeline view', async () => {
    const { container } = await renderWithPeaks(true);
    await vi.waitFor(() => {
      expect(container.querySelector('canvas')).toBeInTheDocument();
    });
  });

  test('still draws it on the full-size clip', async () => {
    const { container } = await renderWithPeaks(false);
    await vi.waitFor(() => {
      expect(container.querySelector('canvas')).toBeInTheDocument();
    });
  });

  test('clears the icon-chip offset in compact, where there is no chip', async () => {
    // left-7 exists to clear the lane icon. Compact draws no icon, so reusing
    // that offset would leave a stray gap at the head of every audio clip.
    const { container } = await renderWithPeaks(true);
    const canvas = await vi.waitFor(() => {
      const c = container.querySelector('canvas');
      expect(c).toBeInTheDocument();
      return c!;
    });
    expect(canvas.className).toContain('left-1');
    expect(canvas.className).not.toContain('left-7');
  });

  test('a clip with no peaks stays exactly as it was', async () => {
    const { api } = await import('../../../lib/api');
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { ok: true, peaks: null } } as never);
    // A DIFFERENT path than the other tests in this file: ClipWaveform keeps a
    // module-level cache keyed by asset path, deliberately, so that the same
    // audio in several clips costs one request. Reusing the path here would
    // hand this test the peaks an earlier test cached and assert nothing.
    const base = buildWorshipDocumentaryProject({ title: 'Silent' });
    const project = insertAssetOnTrack(base, {
      trackKind: 'voiceover',
      asset: { ...AUDIO, id: 'vo-silent', path: 'C:/outputs/no-peaks.mp3' },
      startSec: 0,
      durationSec: 16.7,
    });
    const { container } = render(<VisualTimelineCanvas project={project} compact />);
    await screen.findByText('Edge-TTS');
    expect(container.querySelector('canvas')).not.toBeInTheDocument();
  });
});
