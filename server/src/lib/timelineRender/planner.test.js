import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTimelineRenderPlan,
  validateTimelineProjectForRender,
} from './planner.js';

function baseProject(overrides = {}) {
  return {
    id: 'timeline-test',
    title: 'Lighthouse Praise',
    template: 'worship-documentary',
    aspect: '16:9',
    targetDurationSec: 270,
    assets: {},
    scenes: [{ id: 'scene-1', label: 'Opening', startSec: 0, targetDurationSec: 25 }],
    tracks: [
      { id: 'track-video', kind: 'video', label: 'Real footage', clips: [] },
      { id: 'track-broll', kind: 'broll', label: 'AI B-roll / cutaways', clips: [] },
      { id: 'track-voiceover', kind: 'voiceover', label: 'Voice-over', clips: [] },
      { id: 'track-music', kind: 'music', label: 'Music bed', clips: [] },
      { id: 'track-captions', kind: 'captions', label: 'Captions', clips: [] },
      { id: 'track-effects', kind: 'effects', label: 'Effects', clips: [] },
    ],
    renderSettings: { quality: 'proof_720p', faceSafeDefault: true, voiceProvider: 'chatterbox' },
    ...overrides,
  };
}

describe('timelineRender planner', () => {
  test('rejects missing/invalid timeline project shape', () => {
    const result = validateTimelineProjectForRender({ id: 'bad', title: 'bad' });
    assert.equal(result.ok, false);
    assert.match(result.error, /tracks/i);
  });

  test('rejects timelines with no renderable clips', () => {
    const result = validateTimelineProjectForRender(baseProject());
    assert.equal(result.ok, false);
    assert.match(result.error, /renderable clips/i);
  });

  test('buildTimelineRenderPlan accepts real footage, Veo B-roll and Chatterbox placeholders as renderable tracks', () => {
    const project = baseProject({
      assets: {
        'asset-video': { id: 'asset-video', kind: 'video', source: 'upload', label: 'Main footage', path: 'uploads/main.mp4', durationSec: 30 },
        'asset-broll': { id: 'asset-broll', kind: 'video', source: 'veo', label: 'Light rays', path: '/outputs/videoGen/rays.mp4', durationSec: 8 },
        'asset-vo': { id: 'asset-vo', kind: 'audio', source: 'chatterbox', label: 'Opening VO', prompt: 'Welcome to worship.', durationSec: 6 },
      },
      tracks: [
        { id: 'track-video', kind: 'video', label: 'Real footage', clips: [{ id: 'clip-v', assetId: 'asset-video', startSec: 0, durationSec: 30, transform: { fit: 'face-safe' } }] },
        { id: 'track-broll', kind: 'broll', label: 'AI B-roll / cutaways', clips: [{ id: 'clip-b', assetId: 'asset-broll', startSec: 10, durationSec: 8, transform: { fit: 'contain' } }] },
        { id: 'track-voiceover', kind: 'voiceover', label: 'Voice-over', clips: [{ id: 'clip-vo', assetId: 'asset-vo', startSec: 0, durationSec: 6, transform: { fit: 'contain' } }] },
      ],
    });

    const plan = buildTimelineRenderPlan(project, { quality: 'proof_720p' });

    assert.equal(plan.ok, true);
    assert.equal(plan.projectId, 'timeline-test');
    assert.equal(plan.aspect, '16:9');
    assert.equal(plan.quality, 'proof_720p');
    assert.equal(plan.durationSec, 30);
    assert.deepEqual(plan.tracks.map((track) => track.kind), ['video', 'broll', 'voiceover']);
    assert.equal(plan.tracks[2].clips[0].placeholder, true);
  });
});

test('plan clips keep the payloads the renderer reads: caption text, effect kind/options', () => {
  const project = {
    id: 'p', title: 't', targetDurationSec: 10, renderSettings: { quality: 'proof_720p' },
    assets: {
      cap: { id: 'cap', kind: 'caption', source: 'system', label: '2 caption lines' },
      fx: { id: 'fx', kind: 'effect', source: 'system', label: 'grade' },
      v: { id: 'v', kind: 'video', source: 'upload', label: 'main', path: 'outputs/main.mp4' },
    },
    tracks: [
      { id: 'tv', kind: 'video', label: 'Video', clips: [{ id: 'v1', assetId: 'v', startSec: 0, durationSec: 10, transform: { fit: 'cover' } }] },
      { id: 'tc', kind: 'captions', label: 'Captions', clips: [
        { id: 'c1', assetId: 'cap', startSec: 0, durationSec: 5, transform: { fit: 'cover' }, text: 'He is worthy' },
        { id: 'c2', assetId: 'cap', startSec: 5, durationSec: 5, transform: { fit: 'cover' }, text: 'of all praise' },
      ] },
      { id: 'te', kind: 'effects', label: 'Effects', clips: [{ id: 'e1', assetId: 'fx', startSec: 0, durationSec: 10, transform: { fit: 'cover' }, effect: 'grade', effectOptions: { look: 'warm' } }] },
    ],
  };
  const plan = buildTimelineRenderPlan(project, { quality: 'proof_720p' });
  assert.equal(plan.ok, true);
  const caps = plan.tracks.find((t) => t.kind === 'captions').clips;
  assert.deepEqual(caps.map((c) => c.text), ['He is worthy', 'of all praise']);
  const fx = plan.tracks.find((t) => t.kind === 'effects').clips[0];
  assert.equal(fx.effect, 'grade');
  assert.deepEqual(fx.effectOptions, { look: 'warm' });
});

// F3 — a hidden lane is EXCLUDED from the render (NLE behaviour, decided
// 2026-09-17). Both the validator and the plan builder must agree about that:
// if only the builder honoured `hidden`, a project whose sole footage lane was
// hidden would pass validation and then render nothing, which is exactly the
// silent-wrong-video failure the render warning exists to prevent.
describe('timelineRender planner — hidden lanes', () => {
  function projectWithHiddenVideo({ hidden }) {
    return baseProject({
      assets: {
        'asset-video': { id: 'asset-video', kind: 'video', source: 'upload', label: 'Main footage', path: 'uploads/main.mp4', durationSec: 30 },
        'asset-broll': { id: 'asset-broll', kind: 'video', source: 'veo', label: 'Light rays', path: '/outputs/videoGen/rays.mp4', durationSec: 8 },
      },
      tracks: [
        { id: 'track-video', kind: 'video', label: 'Real footage', hidden, clips: [{ id: 'clip-v', assetId: 'asset-video', startSec: 0, durationSec: 30, transform: { fit: 'cover' } }] },
        { id: 'track-broll', kind: 'broll', label: 'AI B-roll / cutaways', clips: [{ id: 'clip-b', assetId: 'asset-broll', startSec: 10, durationSec: 8, transform: { fit: 'contain' } }] },
      ],
    });
  }

  test('a hidden track is dropped from the plan', () => {
    const plan = buildTimelineRenderPlan(projectWithHiddenVideo({ hidden: true }));
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.tracks.map((t) => t.kind), ['broll']);
  });

  test('the same project renders both lanes when nothing is hidden', () => {
    const plan = buildTimelineRenderPlan(projectWithHiddenVideo({ hidden: false }));
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.tracks.map((t) => t.kind), ['video', 'broll']);
  });

  test('hiding a lane shortens the plan duration to what actually renders', () => {
    // The 30s video is hidden, so the render is the 8s B-roll ending at 18s —
    // not 30s of which 22 are black.
    const plan = buildTimelineRenderPlan(projectWithHiddenVideo({ hidden: true }));
    assert.equal(plan.durationSec, 18);
  });

  test('validation does not count clips on a hidden lane as renderable', () => {
    const project = baseProject({
      assets: {
        'asset-video': { id: 'asset-video', kind: 'video', source: 'upload', label: 'Main footage', path: 'uploads/main.mp4', durationSec: 30 },
      },
      tracks: [
        { id: 'track-video', kind: 'video', label: 'Real footage', hidden: true, clips: [{ id: 'clip-v', assetId: 'asset-video', startSec: 0, durationSec: 30, transform: { fit: 'cover' } }] },
      ],
    });
    const result = validateTimelineProjectForRender(project);
    assert.equal(result.ok, false);
    assert.match(result.error, /renderable clips/i);
  });

  test('a locked lane still renders — locked means uneditable, not excluded', () => {
    const project = baseProject({
      assets: {
        'asset-video': { id: 'asset-video', kind: 'video', source: 'upload', label: 'Main footage', path: 'uploads/main.mp4', durationSec: 30 },
      },
      tracks: [
        { id: 'track-video', kind: 'video', label: 'Real footage', locked: true, clips: [{ id: 'clip-v', assetId: 'asset-video', startSec: 0, durationSec: 30, transform: { fit: 'cover' } }] },
      ],
    });
    const plan = buildTimelineRenderPlan(project);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.tracks.map((t) => t.kind), ['video']);
  });
});
