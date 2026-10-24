/**
 * The owner's timeline render keeps the global output folder and its flat
 * timeline/<jobId>.mp4 (R48). Split from timeline.test.js so the global folder
 * is a tmp dir: paths.js reads DATA_DIR / OUTPUT_DIR at import time, and this
 * test writes the owner's footage into that folder.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-owner-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.OUTPUT_DIR = path.join(root, 'outputs');
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const { default: express } = await import('express');
const { default: request } = await import('supertest');
const { OUTPUT_DIR } = await import('../lib/paths.js');
const { default: timelineRouter, _resetTimelineRenderJobsForTest, _setTimelineRendererForTest } = await import('./timeline.js');

after(() => {
  _resetTimelineRenderJobsForTest();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function app(outputDir) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.ctx = { userId: 'test-user', dataDir: fs.mkdtempSync(path.join(root, 'user-data-')), outputDir };
    next();
  });
  a.use('/api/timeline', timelineRouter);
  return a;
}

function projectWithClip(clipPath) {
  return {
    id: 'timeline-test',
    title: 'Lighthouse Praise',
    template: 'worship-documentary',
    aspect: '16:9',
    targetDurationSec: 270,
    assets: {
      'asset-video': { id: 'asset-video', kind: 'video', source: 'upload', label: 'Main footage', path: clipPath, durationSec: 30 },
    },
    scenes: [],
    tracks: [
      { id: 'track-video', kind: 'video', label: 'Real footage', clips: [{ id: 'clip-v', assetId: 'asset-video', startSec: 0, durationSec: 30, transform: { fit: 'face-safe' } }] },
    ],
    renderSettings: { quality: 'proof_720p', faceSafeDefault: true, voiceProvider: 'chatterbox' },
  };
}

test('POST /render keeps the global folder and its flat timeline/<jobId>.mp4 for the owner (R48)', async () => {
  assert.equal(OUTPUT_DIR, path.resolve(process.env.OUTPUT_DIR), 'the global folder is the tmp dir, not server/outputs');
  // The owner's footage lives in the global folder, so #112 lets them read it.
  fs.writeFileSync(path.join(OUTPUT_DIR, 'owner-main.mp4'), 'x');
  _resetTimelineRenderJobsForTest();
  let seen;
  _setTimelineRendererForTest(async (_plan, opts) => { seen = opts; return { ok: true, outputPath: opts.outputPath, publicUrl: '/outputs/x.mp4' }; });
  const queued = await request(app(OUTPUT_DIR)).post('/api/timeline/render').send({ project: projectWithClip('/outputs/owner-main.mp4') }).expect(202);
  for (let i = 0; i < 40 && !seen; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(seen.outputDir, OUTPUT_DIR);
  assert.equal(seen.outputPath, path.join(OUTPUT_DIR, 'timeline', `${queued.body.jobId}.mp4`));
});
