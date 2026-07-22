import { describe, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import timelineRouter, { _resetTimelineRenderJobsForTest, _setTimelineRendererForTest } from './timeline.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.ctx = { userId: 'test-user' };
    next();
  });
  a.use('/api/timeline', timelineRouter);
  return a;
}

function projectWithClip() {
  return {
    id: 'timeline-test',
    title: 'Lighthouse Praise',
    template: 'worship-documentary',
    aspect: '16:9',
    targetDurationSec: 270,
    assets: {
      'asset-video': { id: 'asset-video', kind: 'video', source: 'upload', label: 'Main footage', path: 'uploads/main.mp4', durationSec: 30 },
    },
    scenes: [],
    tracks: [
      { id: 'track-video', kind: 'video', label: 'Real footage', clips: [{ id: 'clip-v', assetId: 'asset-video', startSec: 0, durationSec: 30, transform: { fit: 'face-safe' } }] },
    ],
    renderSettings: { quality: 'proof_720p', faceSafeDefault: true, voiceProvider: 'chatterbox' },
  };
}

describe('timeline route', () => {
  beforeEach(() => _resetTimelineRenderJobsForTest());

  test('POST /render rejects invalid timeline payload', async () => {
    const res = await request(app()).post('/api/timeline/render').send({ project: { id: 'bad', title: 'Bad' } }).expect(400);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /tracks/i);
  });

  test('POST /render queues a render job immediately and GET /render/:jobId reports completion later', async () => {
    _setTimelineRendererForTest(async () => ({
      ok: true,
      outputPath: 'C:/tmp/timeline-proof.mp4',
      publicUrl: '/outputs/timeline/timeline-proof.mp4',
      ignoredPlaceholders: 0,
      generatedVoiceovers: [{ clipId: 'vo', path: '/outputs/timeline/audio/test.wav', provider: 'abi', fallbacks: [{ provider: 'chatterbox', error: 'down' }] }],
    }));

    const queued = await request(app())
      .post('/api/timeline/render')
      .send({ project: projectWithClip(), quality: 'proof_720p' })
      .expect(202);

    assert.equal(queued.body.ok, true);
    assert.match(queued.body.jobId, /^timeline-/);
    assert.equal(queued.body.status, 'queued');
    assert.equal(queued.body.progress, 0);
    assert.equal(queued.body.publicUrl, undefined);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const done = await request(app()).get(`/api/timeline/render/${queued.body.jobId}`).expect(200);
    assert.equal(done.body.ok, true);
    assert.equal(done.body.status, 'completed');
    assert.equal(done.body.progress, 100);
    assert.equal(done.body.publicUrl, '/outputs/timeline/timeline-proof.mp4');
    assert.equal(done.body.generatedVoiceovers[0].path, '/outputs/timeline/audio/test.wav');
    assert.deepEqual(done.body.voiceProvidersUsed, ['abi']);
    assert.deepEqual(done.body.voiceFallbacks, [{ provider: 'chatterbox', error: 'down' }]);
    assert.equal(done.body.plan.projectId, 'timeline-test');
    assert.equal(done.body.plan.durationSec, 30);
    assert.equal(done.body.plan.tracks[0].kind, 'video');
  });

  test('GET /render/:jobId reports failed jobs without losing the job id', async () => {
    _setTimelineRendererForTest(async () => ({ ok: false, error: 'Chatterbox unavailable' }));

    const queued = await request(app())
      .post('/api/timeline/render')
      .send({ project: projectWithClip(), quality: 'proof_720p' })
      .expect(202);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const failed = await request(app()).get(`/api/timeline/render/${queued.body.jobId}`).expect(200);
    assert.equal(failed.body.ok, true);
    assert.equal(failed.body.jobId, queued.body.jobId);
    assert.equal(failed.body.status, 'failed');
    assert.equal(failed.body.progress, 100);
    assert.match(failed.body.error, /Chatterbox unavailable/);
  });
});
