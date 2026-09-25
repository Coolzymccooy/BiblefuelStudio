import { describe, it, expect } from 'vitest';
import { resolvePreviewFrame, toPlayableUrl } from '../livePreview';
import { buildWorshipDocumentaryProject, insertAssetOnTrack } from '../timelineProject';
import { addEffectToScene } from '../timelineEffects';

const project = () => buildWorshipDocumentaryProject({ title: 'T' });

function withVideo(startSec = 0, durationSec = 30) {
  const p = project();
  return insertAssetOnTrack(p, {
    trackKind: 'video',
    asset: {
      id: 'a-vid', kind: 'video', source: 'upload',
      label: 'sermon.mp4', path: '/uploads/sermon.mp4',
    },
    startSec,
    durationSec,
  });
}

describe('resolvePreviewFrame', () => {
  it('reports nothing to show for an empty timeline', () => {
    const frame = resolvePreviewFrame(project(), { timeSec: 0, backgrounds: [] });
    expect(frame.layers).toHaveLength(0);
    expect(frame.isEmpty).toBe(true);
  });

  it('shows a background when one is selected, even with no clips', () => {
    const frame = resolvePreviewFrame(project(), {
      timeSec: 0,
      backgrounds: [{ id: 'b1', url: '/bg/one.jpg', kind: 'image' }],
    });
    expect(frame.isEmpty).toBe(false);
    expect(frame.layers[0]).toMatchObject({ role: 'background', kind: 'image' });
  });

  it('picks the video clip covering the playhead', () => {
    const frame = resolvePreviewFrame(withVideo(0, 30), { timeSec: 10, backgrounds: [] });
    const video = frame.layers.find((l) => l.role === 'video');
    expect(video?.src).toContain('sermon.mp4');
    // The offset into the clip drives <video>.currentTime.
    expect(video?.seekSec).toBe(10);
  });

  it('ignores a clip the playhead has not reached', () => {
    const frame = resolvePreviewFrame(withVideo(20, 30), { timeSec: 5, backgrounds: [] });
    expect(frame.layers.find((l) => l.role === 'video')).toBeUndefined();
  });

  it('ignores a clip the playhead has passed', () => {
    const frame = resolvePreviewFrame(withVideo(0, 10), { timeSec: 25, backgrounds: [] });
    expect(frame.layers.find((l) => l.role === 'video')).toBeUndefined();
  });

  it('layers b-roll ABOVE the base video', () => {
    const base = withVideo(0, 60);
    const withBroll = insertAssetOnTrack(base, {
      trackKind: 'broll',
      asset: { id: 'a-img', kind: 'image', source: 'library', label: 'cut.jpg', path: '/bg/cut.jpg' },
      startSec: 5,
      durationSec: 5,
    });
    const frame = resolvePreviewFrame(withBroll, { timeSec: 6, backgrounds: [] });
    const roles = frame.layers.map((l) => l.role);
    expect(roles.indexOf('broll')).toBeGreaterThan(roles.indexOf('video'));
  });

  it('surfaces the caption line for the current time', () => {
    const frame = resolvePreviewFrame(withVideo(0, 30), {
      timeSec: 4,
      backgrounds: [],
      captionLines: ['first line', 'second line', 'third line'],
      totalSec: 30,
    });
    // 30s over 3 lines = 10s each, so t=4 is the first line.
    expect(frame.caption).toBe('first line');
  });

  it('has no caption when captions are disabled', () => {
    const frame = resolvePreviewFrame(withVideo(), {
      timeSec: 4, backgrounds: [], captionLines: [],
    });
    expect(frame.caption).toBeUndefined();
  });

  it('reports the grade look that applies at the playhead', () => {
    const p = withVideo(0, 60);
    const scene = p.scenes[0];
    const graded = addEffectToScene(p, {
      sceneId: scene.id, effect: 'grade', options: { look: 'cinematic' },
    });
    const frame = resolvePreviewFrame(graded, { timeSec: scene.startSec + 1, backgrounds: [] });
    expect(frame.grade).toBe('cinematic');
  });

  it('has no grade outside the effect window', () => {
    const p = withVideo(0, 300);
    const graded = addEffectToScene(p, { sceneId: p.scenes[0].id, effect: 'grade' });
    const frame = resolvePreviewFrame(graded, { timeSec: 280, backgrounds: [] });
    expect(frame.grade).toBeUndefined();
  });

  it('is pure - the project is never mutated', () => {
    const p = withVideo();
    const before = JSON.stringify(p);
    resolvePreviewFrame(p, { timeSec: 5, backgrounds: [] });
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('toPlayableUrl', () => {
  // Mirrors api.mediaUrl: it serves by BASENAME out of /outputs.
  const base = (p: string) => `http://host/outputs/${p.split(/[\/]/).pop()}`;

  it('passes an absolute URL straight through', () => {
    const u = 'https://cdn.example.com/clip.mp4';
    expect(toPlayableUrl(u, base)).toBe(u);
  });

  it('passes a root-relative served path through unchanged', () => {
    // /outputs/... is already what the server exposes.
    expect(toPlayableUrl('/outputs/a.mp4', base)).toBe('/outputs/a.mp4');
  });

  it('resolves a bare storage path through the media base', () => {
    // This is the case that broke the preview: `uploads/bg.jpg` is a storage
    // key, not a URL, so putting it in src produced a broken image.
    expect(toPlayableUrl('uploads/bg.jpg', base)).toBe('http://host/outputs/bg.jpg');
  });

  it('returns empty for nothing', () => {
    expect(toPlayableUrl('', base)).toBe('');
    expect(toPlayableUrl(undefined, base)).toBe('');
  });

  it('handles a blob/data url without mangling it', () => {
    expect(toPlayableUrl('blob:http://x/abc', base)).toBe('blob:http://x/abc');
  });
});
