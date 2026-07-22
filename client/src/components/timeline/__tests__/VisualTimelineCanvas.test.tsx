import { render, screen, within } from '@testing-library/react';
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
    expect(within(videoTrack).getByText('Drop or insert video clips here')).toBeInTheDocument();
    expect(screen.getByLabelText('Track lane: AI B-roll / cutaways')).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: /generate veo b-roll/i }));

    expect(onRequestVeoBroll).toHaveBeenCalledTimes(1);
    expect(onRequestVeoBroll.mock.calls[0][0]).toMatchObject({
      aspect: '16:9',
      durationSec: 8,
      targetTrackKind: 'broll',
    });
    expect(onRequestVeoBroll.mock.calls[0][0].prompt).toMatch(/worship|light|arrival/i);
  });
});

