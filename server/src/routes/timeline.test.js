import { describe, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { OUTPUT_DIR } from '../lib/paths.js';
import timelineRouter, { _resetTimelineRenderJobsForTest, _setTimelineRendererForTest } from './timeline.js';

// The caller's own output folder, holding the footage the test project
// uses: /render reads only the caller's own files (#112).
const OUTPUT = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-route-out-'));
fs.writeFileSync(path.join(OUTPUT, 'main.mp4'), 'x');

function app(ctx = {}) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.ctx = {
      userId: ctx.userId || 'test-user',
      dataDir: ctx.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-route-data-')),
      outputDir: ctx.outputDir || OUTPUT,
    };
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
      'asset-video': { id: 'asset-video', kind: 'video', source: 'upload', label: 'Main footage', path: '/outputs/main.mp4', durationSec: 30 },
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

  test('POST /render forwards a Studio look, energy and seed to the renderer unmapped', async () => {
    let seen;
    _setTimelineRendererForTest(async (_plan, opts) => {
      seen = opts;
      return { ok: true, outputPath: 'C:/tmp/x.mp4', publicUrl: '/outputs/timeline/x.mp4', ignoredPlaceholders: 0, generatedVoiceovers: [] };
    });
    await request(app())
      .post('/api/timeline/render')
      .send({ project: projectWithClip(), typographyPreset: 'studio-gospel-gold', captionEnergy: 'wild', captionSeed: 42 })
      .expect(202);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(seen.typographyPreset, 'studio-gospel-gold');
    assert.equal(seen.captionEnergy, 'wild');
    assert.equal(seen.captionSeed, 42);
  });

  test('POST /render falls back to the project renderSettings for energy and seed', async () => {
    let seen;
    _setTimelineRendererForTest(async (_plan, opts) => {
      seen = opts;
      return { ok: true, outputPath: 'C:/tmp/x.mp4', publicUrl: '/outputs/timeline/x.mp4', ignoredPlaceholders: 0, generatedVoiceovers: [] };
    });
    const project = projectWithClip();
    project.renderSettings = { ...project.renderSettings, typographyPreset: 'studio-clean-white', captionEnergy: 'lively', captionSeed: 7 };
    await request(app()).post('/api/timeline/render').send({ project }).expect(202);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(seen.typographyPreset, 'studio-clean-white');
    assert.equal(seen.captionEnergy, 'lively');
    assert.equal(seen.captionSeed, 7);
  });

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

  test('GET /render/:jobId can recover a terminal timeline job from disk after memory reset', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-route-persist-'));
    _setTimelineRendererForTest(async () => ({
      ok: true,
      outputPath: 'C:/tmp/timeline-proof.mp4',
      publicUrl: '/outputs/timeline/timeline-proof.mp4',
      ignoredPlaceholders: 0,
      generatedVoiceovers: [],
    }));

    const queued = await request(app({ dataDir }))
      .post('/api/timeline/render')
      .send({ project: projectWithClip(), quality: 'proof_720p' })
      .expect(202);

    await new Promise((resolve) => setTimeout(resolve, 25));
    _resetTimelineRenderJobsForTest();

    const recovered = await request(app({ dataDir })).get(`/api/timeline/render/${queued.body.jobId}`).expect(200);
    assert.equal(recovered.body.status, 'completed');
    assert.equal(recovered.body.publicUrl, '/outputs/timeline/timeline-proof.mp4');
  });

  test('timeline projects can be saved, listed, and restored from the user data dir', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-projects-'));
    const project = projectWithClip();

    const saved = await request(app({ dataDir }))
      .put(`/api/timeline/projects/${project.id}`)
      .send({ project })
      .expect(200);

    assert.equal(saved.body.ok, true);
    assert.equal(saved.body.project.id, project.id);

    const listed = await request(app({ dataDir })).get('/api/timeline/projects').expect(200);
    assert.equal(listed.body.projects.length, 1);
    assert.equal(listed.body.projects[0].id, project.id);

    const loaded = await request(app({ dataDir })).get(`/api/timeline/projects/${project.id}`).expect(200);
    assert.equal(loaded.body.project.title, project.title);
    assert.equal(loaded.body.project.tracks[0].clips[0].assetId, 'asset-video');
  });

  test("POST /render renders into the caller's own outputDir, in a folder named by the job (R48)", async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-user-out-'));
    fs.writeFileSync(path.join(outputDir, 'main.mp4'), 'x');
    let seen;
    _setTimelineRendererForTest(async (_plan, opts) => { seen = opts; return { ok: true, outputPath: opts.outputPath, publicUrl: '/outputs/x.mp4' }; });
    const queued = await request(app({ outputDir })).post('/api/timeline/render').send({ project: projectWithClip() }).expect(202);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(seen.outputDir, outputDir);
    assert.equal(seen.outputPath, path.join(outputDir, 'timeline', queued.body.jobId, 'video.mp4'));
  });

  test('POST /render keeps the global folder and its flat timeline/<jobId>.mp4 for the owner (R48)', async () => {
    // The owner's footage lives in the global folder, so #112 lets them read it.
    const footage = `timeline-r48-${process.pid}-${Date.now()}.mp4`;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, footage), 'x');
    const project = projectWithClip();
    project.assets['asset-video'].path = `/outputs/${footage}`;
    let seen;
    _setTimelineRendererForTest(async (_plan, opts) => { seen = opts; return { ok: true, outputPath: opts.outputPath, publicUrl: '/outputs/x.mp4' }; });
    let queued;
    try {
      queued = await request(app({ outputDir: OUTPUT_DIR })).post('/api/timeline/render').send({ project }).expect(202);
      await new Promise((resolve) => setTimeout(resolve, 25));
    } finally {
      fs.rmSync(path.join(OUTPUT_DIR, footage), { force: true });
    }
    assert.equal(seen.outputDir, OUTPUT_DIR);
    assert.equal(seen.outputPath, path.join(OUTPUT_DIR, 'timeline', `${queued.body.jobId}.mp4`));
  });

  test('GET /render/:jobId answers 404 to another user for a job in memory (R49)', async () => {
    _setTimelineRendererForTest(async () => new Promise(() => {}));
    const mine = { userId: 'owner-a', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-a-')) };
    const theirs = { userId: 'other-b', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-b-')) };
    const queued = await request(app(mine)).post('/api/timeline/render').send({ project: projectWithClip() }).expect(202);
    await request(app(mine)).get(`/api/timeline/render/${queued.body.jobId}`).expect(200);
    const refused = await request(app(theirs)).get(`/api/timeline/render/${queued.body.jobId}`).expect(404);
    assert.equal(refused.body.error, 'NOT_FOUND');
  });
});
