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
