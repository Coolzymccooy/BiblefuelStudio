import { describe, expect, test } from 'vitest';
import {
  buildWorshipDocumentaryProject,
  insertAssetOnTrack,
  insertSourceMediaOnTimeline,
  getTimelineAssetPreviewPath,
  insertVoiceoverPlaceholderOnTimeline,
  loadTimelineProject,
  saveTimelineProject,
  type TimelineAsset,
} from '../timelineProject';

describe('timelineProject', () => {
  test('buildWorshipDocumentaryProject creates a CapCut-like multi-track under-5 documentary timeline', () => {
    const project = buildWorshipDocumentaryProject({
      title: 'Lighthouse Praise Highlight',
      aspect: '16:9',
      targetDurationSec: 270,
    });

    expect(project.title).toBe('Lighthouse Praise Highlight');
    expect(project.aspect).toBe('16:9');
    expect(project.template).toBe('worship-documentary');
    expect(project.targetDurationSec).toBeLessThanOrEqual(300);
    expect(project.tracks.map((track) => track.kind)).toEqual([
      'video',
      'broll',
      'voiceover',
      'music',
      'captions',
      'effects',
    ]);
    expect(project.scenes.map((scene) => scene.label)).toEqual([
      'Opening / Arrival',
      'Behind the scenes',
      'Interview / testimony',
      'Praise begins',
      'Worship body',
      'Intense dance',
      'Afterglow / closing',
    ]);
    expect(project.renderSettings.faceSafeDefault).toBe(true);
    expect(project.renderSettings.realEventAudioFor).toContain('praise');
    expect(project.renderSettings.voiceProvider).toBe('chatterbox');
  });

  test('insertAssetOnTrack adds Veo generated clips as normal timeline assets without special casing render tracks', () => {
    const project = buildWorshipDocumentaryProject({ title: 'AI B-roll test' });
    const veoClip: TimelineAsset = {
      id: 'asset-veo-light-rays',
      kind: 'video',
      source: 'veo',
      label: 'Golden worship light rays',
      path: '/outputs/videoGen/light-rays.mp4',
      durationSec: 8,
      aspect: '16:9',
      tags: ['ai_broll', 'worship_atmosphere'],
    };

    const updated = insertAssetOnTrack(project, {
      trackKind: 'broll',
      asset: veoClip,
      startSec: 12,
      durationSec: 8,
      fit: 'contain',
    });

    const broll = updated.tracks.find((track) => track.kind === 'broll');
    expect(broll?.clips).toHaveLength(1);
    expect(broll?.clips[0]).toMatchObject({
      assetId: 'asset-veo-light-rays',
      startSec: 12,
      durationSec: 8,
      transform: { fit: 'contain' },
    });
    expect(updated.assets['asset-veo-light-rays']).toEqual(veoClip);
  });

  test('saveTimelineProject and loadTimelineProject persist the active documentary edit locally', () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };
    const project = buildWorshipDocumentaryProject({ title: 'Persist me' });

    saveTimelineProject(project, adapter);
    const loaded = loadTimelineProject(adapter);

    expect(loaded?.id).toBe(project.id);
    expect(loaded?.title).toBe('Persist me');
    expect(loaded?.tracks.map((track) => track.kind)).toContain('broll');
  });

  test('insertSourceMediaOnTimeline inserts uploaded source media into Real footage track', () => {
    const project = buildWorshipDocumentaryProject({ title: 'Source media insert' });
    const updated = insertSourceMediaOnTimeline(project, {
      label: 'Uploaded event footage.mov',
      path: 'uploads/event-footage.mov',
      kind: 'video',
      durationSec: 42,
    });

    const video = updated.tracks.find((track) => track.kind === 'video');
    expect(video?.clips).toHaveLength(1);
    expect(video?.clips[0]).toMatchObject({ startSec: 0, durationSec: 42, transform: { fit: 'face-safe' } });
    expect(updated.assets[video!.clips[0].assetId]).toMatchObject({ source: 'upload', label: 'Uploaded event footage.mov' });
  });

  test('insertSourceMediaOnTimeline preserves proxy metadata and prefers ready proxies for previews', () => {
    const project = buildWorshipDocumentaryProject({ title: 'Proxy insert' });
    const updated = insertSourceMediaOnTimeline(project, {
      label: 'Large worship event.mov',
      path: 'outputs/source-video-original.mov',
      proxyPath: 'outputs/source-video-original-proxy.mp4',
      proxyStatus: 'ready',
      kind: 'video',
      durationSec: 42,
    });

    const video = updated.tracks.find((track) => track.kind === 'video')!;
    const asset = updated.assets[video.clips[0].assetId];
    expect(asset).toMatchObject({
      path: 'outputs/source-video-original.mov',
      proxyPath: 'outputs/source-video-original-proxy.mp4',
      proxyStatus: 'ready',
    });
    expect(getTimelineAssetPreviewPath(asset)).toBe('outputs/source-video-original-proxy.mp4');
  });

  test('getTimelineAssetPreviewPath keeps original source while proxy is pending or failed', () => {
    const pending: TimelineAsset = {
      id: 'asset-pending',
      kind: 'video',
      source: 'upload',
      label: 'Pending proxy',
      path: 'original.mov',
      proxyPath: 'original-proxy.mp4',
      proxyStatus: 'pending',
    };
    expect(getTimelineAssetPreviewPath(pending)).toBe('original.mov');
    expect(getTimelineAssetPreviewPath({ ...pending, proxyStatus: 'failed' })).toBe('original.mov');
  });

  test('insertSourceMediaOnTimeline appends repeated uploaded videos after existing real-footage clips', () => {
    const project = buildWorshipDocumentaryProject({ title: 'Multi upload insert' });
    const first = insertSourceMediaOnTimeline(project, {
      label: 'first.mp4',
      path: 'uploads/first.mp4',
      kind: 'video',
      durationSec: 12,
    });
    const second = insertSourceMediaOnTimeline(first, {
      label: 'second.mp4',
      path: 'uploads/second.mp4',
      kind: 'video',
      durationSec: 8,
    });

    const video = second.tracks.find((track) => track.kind === 'video');
    expect(video?.clips).toHaveLength(2);
    expect(video?.clips[0].startSec).toBe(0);
    expect(video?.clips[1].startSec).toBe(12);
  });

  test('insertSourceMediaOnTimeline inserts uploaded images into the B-roll cutaway track', () => {
    const project = buildWorshipDocumentaryProject({ title: 'Image insert' });
    const updated = insertSourceMediaOnTimeline(project, {
      label: 'church-arrival.jpg',
      path: 'uploads/church-arrival.jpg',
      kind: 'image',
    });

    const broll = updated.tracks.find((track) => track.kind === 'broll');
    expect(broll?.clips).toHaveLength(1);
    expect(broll?.clips[0].durationSec).toBe(5);
    expect(updated.assets[broll!.clips[0].assetId]).toMatchObject({ kind: 'image', source: 'upload', label: 'church-arrival.jpg' });
  });

  test('insertVoiceoverPlaceholderOnTimeline adds Chatterbox narration placeholder to Voice-over track', () => {
    const project = buildWorshipDocumentaryProject({ title: 'VO insert' });
    const updated = insertVoiceoverPlaceholderOnTimeline(project, {
      label: 'Opening narration',
      text: 'The room gathered with expectation.',
      startSec: 0,
      durationSec: 6,
    });

    const voiceover = updated.tracks.find((track) => track.kind === 'voiceover');
    expect(voiceover?.clips).toHaveLength(1);
    expect(updated.assets[voiceover!.clips[0].assetId]).toMatchObject({
      kind: 'audio',
      source: 'chatterbox',
      label: 'Opening narration',
      prompt: 'The room gathered with expectation.',
    });
  });
});
