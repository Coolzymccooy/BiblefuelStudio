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
      // Comfortably past WAVEFORM_MIN_WIDTH_PCT (12% of the 270s target).
      // A 16.7s clip is ~6% wide and is deliberately NOT given a trace.
      durationSec: 90,
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

  test('drops the trace on a clip too narrow to hold it and the label', async () => {
    // A 2s clip on a 270s timeline is ~0.7% wide. Splitting that between the
    // label and a trace left the name truncated to one character and the
    // canvas at 0px — both useless, which is worse than no waveform.
    const { api } = await import('../../../lib/api');
    vi.spyOn(api, 'get').mockResolvedValue({
      ok: true,
      data: { ok: true, peaks: [[-0.8, 0.8], [-0.4, 0.4]] },
    } as never);
    const base = buildWorshipDocumentaryProject({ title: 'Narrow' });
    const project = insertAssetOnTrack(base, {
      trackKind: 'voiceover',
      asset: { ...AUDIO, id: 'vo-narrow', path: 'C:/outputs/narrow.mp3' },
      startSec: 0,
      durationSec: 2,
    });
    const { container } = render(<VisualTimelineCanvas project={project} compact />);
    await screen.findByText('Edge-TTS');
    expect(container.querySelector('canvas')).not.toBeInTheDocument();
  });

  test('sits BESIDE the label, not stacked over it', async () => {
    // The trace used to be absolutely positioned across the whole clip, which
    // put peaks directly behind the filename and the two read as one smeared
    // line. It is now a flex sibling that takes the room left after the label.
    const { container } = await renderWithPeaks(true);
    const canvas = await vi.waitFor(() => {
      const c = container.querySelector('canvas');
      expect(c).toBeInTheDocument();
      return c!;
    });
    expect(canvas.className).not.toContain('absolute');
    expect(canvas.className).toContain('flex-1');
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

// Codex caught this on PR #6. Hiding a lane EXCLUDES it from the render, and
// the code comment beside the branch already claimed the lane "stops taking
// pointer events so a clip cannot be edited into a lane that will not render"
// — but the branch only set opacity-40. Clips in a hidden lane stayed
// selectable, their Mute/Delete controls still worked, and an empty hidden lane
// still opened its insertion tool. So an edit could be made to a lane whose
// content the renderer then silently drops, which is the exact failure mode
// hiddenLanes.ts exists to prevent.
describe('hidden lanes are not editable', () => {
  function hiddenVoiceover() {
    const base = buildWorshipDocumentaryProject({ title: 'Hidden' });
    const withClip = insertAssetOnTrack(base, {
      trackKind: 'voiceover',
      asset: { id: 'vo-h', kind: 'audio', source: 'upload', label: 'Hidden VO', path: 'C:/outputs/h.mp3' },
      startSec: 0,
      durationSec: 30,
    });
    return {
      ...withClip,
      tracks: withClip.tracks.map((t) => (t.kind === 'voiceover' ? { ...t, hidden: true } : t)),
    };
  }

  test('a hidden lane does not accept pointer events', () => {
    // onProjectChange is required for the lane controls to render at all, and
    // the eye control is the way back from hidden — so this test asserts both
    // halves against the same render.
    render(<VisualTimelineCanvas project={hiddenVoiceover()} compact onProjectChange={vi.fn()} />);
    // The aria-labelled wrapper holds the HEADER as well as the clips, and the
    // header must stay live — that is where the eye control that un-hides the
    // lane lives. So the inert element is the lane BODY inside it, identified
    // by its bed class.
    const wrapper = screen.getByLabelText('Track lane: Voice-over');
    // The HEADER also carries .bg-lane-bed, and it comes first in the DOM, so
    // querySelector alone returns the header — which must stay interactive.
    // Take the last one: the lane body.
    const beds = [...wrapper.querySelectorAll('.bg-lane-bed')];
    const body = beds[beds.length - 1];
    expect(body, 'the lane body should render').toBeTruthy();
    expect(body.className).toMatch(/pointer-events-none/);
    // The header is a SIBLING of the body, not a parent, which is what keeps
    // the eye control clickable while the clips are inert.
    expect(beds[0].className).not.toMatch(/pointer-events-none/);
    // And the header alongside it is NOT inert.
    expect(screen.getByRole('button', { name: 'Show Voice-over lane' })).toBeInTheDocument();
  });

  test('the eye control still works, so the lane can be shown again', async () => {
    const onProjectChange = vi.fn();
    render(<VisualTimelineCanvas project={hiddenVoiceover()} compact onProjectChange={onProjectChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show Voice-over lane' }));
    expect(onProjectChange).toHaveBeenCalled();
    const next = onProjectChange.mock.calls[0][0];
    expect(next.tracks.find((t: { kind: string }) => t.kind === 'voiceover').hidden).toBe(false);
  });

  test('a visible lane is left interactive', () => {
    const base = buildWorshipDocumentaryProject({ title: 'Visible' });
    render(<VisualTimelineCanvas project={base} compact />);
    const beds = [...screen.getByLabelText('Track lane: Voice-over').querySelectorAll('.bg-lane-bed')];
    expect(beds[beds.length - 1].className).not.toMatch(/pointer-events-none/);
  });
});

// Codex caught this on PR #6. The 920px floor is a Tailwind min-width, so it
// ALWAYS won over the inline width computed from the zoom. contentWidth is
// containerWidth x zoom, so on a 1200px timeline zoom 0.5 asked for ~600px and
// 0.25 for ~300px — both clamped to 920px. Successive Zoom Out clicks stopped
// changing anything below 1x, and on narrower desktops even Fit stayed
// horizontally scrollable.
describe('zoom-out is not swallowed by the minimum width', () => {
  function widthClassesAtZoom(zoom: number) {
    window.localStorage.setItem(`bf.timeline.zoom.${'zoomfloor'}`, String(zoom));
    const base = buildWorshipDocumentaryProject({ title: 'Zoom' });
    const project = { ...base, id: 'zoomfloor' };
    const { container, unmount } = render(<VisualTimelineCanvas project={project} compact />);
    const scroller = container.querySelector('.overflow-x-auto');
    const inner = scroller?.firstElementChild as HTMLElement | null;
    const cls = inner?.className ?? '';
    unmount();
    return cls;
  }

  test('keeps the floor at default zoom, where it protects the lanes', () => {
    expect(widthClassesAtZoom(1)).toMatch(/min-w-\[920px\]/);
  });

  test('drops the floor below 1x, where the operator asked for less width', () => {
    expect(widthClassesAtZoom(0.5)).not.toMatch(/min-w-\[920px\]/);
    expect(widthClassesAtZoom(0.25)).not.toMatch(/min-w-\[920px\]/);
  });

  test('keeps the floor when zoomed IN, where content is wider anyway', () => {
    expect(widthClassesAtZoom(2)).toMatch(/min-w-\[920px\]/);
  });
});
