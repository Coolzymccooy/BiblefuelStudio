import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import storyRouter, { confineImportAudio } from './story.js';

function app() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-import-'));
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.ctx = { userId: 'test-user', dataDir: dir, outputDir: dir };
    next();
  });
  a.use('/api/story', storyRouter);
  return { a, dir };
}

describe('POST /api/story/import-script', () => {
  test('creates a project ready to segment, skipping transcription', async () => {
    const { a } = app();
    const res = await request(a).post('/api/story/import-script').send({
      script: 'The Lord is my shepherd I shall not want',
      audioPath: '/outputs/narration.mp3',
      durationMs: 6000,
      title: 'Psalm 23 Day 1',
    }).expect(200);

    assert.equal(res.body.ok, true);
    assert.equal(res.body.project.status, 'segmenting',
      'must arrive at segmentation — transcription is skipped');
    assert.ok(res.body.project.transcript.words.length > 0,
      'transcript must be pre-filled so transcribeStage short-circuits');
    assert.equal(res.body.project.source.audioPath, '/outputs/narration.mp3');
  });

  test('uses provider word timings when supplied', async () => {
    const { a } = app();
    const res = await request(a).post('/api/story/import-script').send({
      script: 'be still',
      audioPath: '/outputs/n.mp3',
      durationMs: 2000,
      words: [
        { text: 'be', startMs: 0, endMs: 600 },
        { text: 'still', startMs: 600, endMs: 2000 },
      ],
    }).expect(200);

    const w = res.body.project.transcript.words;
    assert.equal(w.length, 2);
    assert.equal(w[0].endMs, 600, 'real timings preserved, not re-derived');
  });

  test('does not rewrite the caller supplied script', async () => {
    const { a } = app();
    const script = 'Cast all your anxiety on Him because He cares for you';
    const res = await request(a).post('/api/story/import-script').send({
      script, audioPath: '/outputs/n.mp3', durationMs: 5000,
    }).expect(200);

    const joined = res.body.project.transcript.words.map((x) => x.text).join(' ');
    assert.equal(joined, script, 'the operator’s own words must survive verbatim');
  });

  test('rejects a missing script', async () => {
    const { a } = app();
    const res = await request(a).post('/api/story/import-script')
      .send({ audioPath: '/x.mp3', durationMs: 1000 }).expect(400);
    assert.match(res.body.error, /script/i);
  });

  test('rejects a missing audioPath', async () => {
    const { a } = app();
    const res = await request(a).post('/api/story/import-script')
      .send({ script: 'hello there', durationMs: 1000 }).expect(400);
    assert.match(res.body.error, /audioPath/i);
  });

  test('rejects a non-positive duration', async () => {
    const { a } = app();
    const res = await request(a).post('/api/story/import-script')
      .send({ script: 'hello there', audioPath: '/x.mp3', durationMs: 0 }).expect(400);
    assert.match(res.body.error, /durationMs/i);
  });

  test('the created project is retrievable by id', async () => {
    const { a } = app();
    const created = await request(a).post('/api/story/import-script')
      .send({ script: 'a psalm of David', audioPath: '/x.mp3', durationMs: 3000 }).expect(200);
    const id = created.body.project.projectId;
    const got = await request(a).get(`/api/story/${id}`).expect(200);
    assert.equal(got.body.project.projectId, id);
  });
});

describe('cast management', () => {
  test('GET /characters lists the available figures', async () => {
    const { a } = app();
    const res = await request(a).get('/api/story/characters').expect(200);
    const keys = res.body.characters.map((c) => c.key);
    assert.ok(keys.includes('jesus'));
    assert.ok(keys.includes('david_young'));
    assert.ok(res.body.characters.every((c) => c.description.length > 20));
  });

  test('PATCH /:id/cast stores the cast on the project', async () => {
    const { a } = app();
    const created = await request(a).post('/api/story/import-script')
      .send({ script: 'David faced the giant', audioPath: '/x.mp3', durationMs: 3000 }).expect(200);
    const id = created.body.project.projectId;

    const res = await request(a).patch(`/api/story/${id}/cast`)
      .send({ cast: ['david_young', 'goliath'] }).expect(200);
    assert.deepEqual(res.body.project.cast, ['david_young', 'goliath']);
  });

  test('rejects unknown character keys but keeps the valid ones', async () => {
    const { a } = app();
    const created = await request(a).post('/api/story/import-script')
      .send({ script: 'a story', audioPath: '/x.mp3', durationMs: 3000 }).expect(200);
    const id = created.body.project.projectId;

    const res = await request(a).patch(`/api/story/${id}/cast`)
      .send({ cast: ['jesus', 'gandalf'] }).expect(200);
    assert.deepEqual(res.body.project.cast, ['jesus']);
    assert.deepEqual(res.body.rejected, ['gandalf']);
  });

  test('deduplicates and lowercases incoming keys', async () => {
    const { a } = app();
    const created = await request(a).post('/api/story/import-script')
      .send({ script: 'a story', audioPath: '/x.mp3', durationMs: 3000 }).expect(200);
    const id = created.body.project.projectId;
    const res = await request(a).patch(`/api/story/${id}/cast`)
      .send({ cast: ['JESUS', 'jesus', ' Jesus '] }).expect(200);
    assert.deepEqual(res.body.project.cast, ['jesus']);
  });

  test('requires an array', async () => {
    const { a } = app();
    const created = await request(a).post('/api/story/import-script')
      .send({ script: 'a story', audioPath: '/x.mp3', durationMs: 3000 }).expect(200);
    const res = await request(a).patch(`/api/story/${created.body.project.projectId}/cast`)
      .send({ cast: 'jesus' }).expect(400);
    assert.match(res.body.error, /array/i);
  });

  test('404s for an unknown project', async () => {
    const { a } = app();
    await request(a).patch('/api/story/nope/cast').send({ cast: [] }).expect(404);
  });

  test('import-script accepts a cast up front', async () => {
    const { a } = app();
    const res = await request(a).post('/api/story/import-script').send({
      script: 'David faced the giant', audioPath: '/x.mp3', durationMs: 3000,
      cast: ['david_young'],
    }).expect(200);
    assert.deepEqual(res.body.project.cast, ['david_young']);
  });
});

describe('POST /api/story/import-script: AI motion and auto-start', () => {
  let savedKey;
  let pipelineCalls;
  let story;

  async function adminApp({ admin = false } = {}) {
    story = await import('./story.js');
    pipelineCalls = [];
    story._setPipelineImpl(async (ctx, projectId, audioPath) => { pipelineCalls.push({ ctx, projectId, audioPath }); });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-import-ai-'));
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      req.ctx = { userId: 'u', dataDir: dir, outputDir: dir, isSuperAdmin: admin };
      next();
    });
    a.use('/api/story', storyRouter);
    return { a, dir };
  }

  const body = (over = {}) => ({ script: 'For God so loved the world', audioPath: '/outputs/n.mp3', durationMs: 4000, ...over });

  beforeEach(() => {
    savedKey = process.env.BYTEPLUS_ARK_API_KEY;
    process.env.BYTEPLUS_ARK_API_KEY = 'ark-test';
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.BYTEPLUS_ARK_API_KEY; else process.env.BYTEPLUS_ARK_API_KEY = savedKey;
    story?._resetPipelineImpl();
  });

  test("a normal account's aiMotion is stored as null, and its scene policy is untouched", async () => {
    const { a } = await adminApp({ admin: false });
    const res = await request(a).post('/api/story/import-script').send(body({ aiMotion: true })).expect(200);
    assert.equal(res.body.project.aiMotion, null);
    assert.equal(res.body.project.scene, null);
  });

  test("a super admin's aiMotion is kept and asks for 10 s scenes", async () => {
    const { a } = await adminApp({ admin: true });
    const res = await request(a).post('/api/story/import-script').send(body({ aiMotion: true })).expect(200);
    assert.deepEqual(res.body.project.aiMotion, { quality: 'standard', autoStartedAt: null, note: null });
    assert.equal(res.body.project.scene.targetSceneSec, 10);
    const high = await request(a).post('/api/story/import-script').send(body({ aiMotion: { quality: 'high' } })).expect(200);
    assert.equal(high.body.project.aiMotion.quality, 'high');
  });

  test('a scene policy the caller sends is kept', async () => {
    const { a } = await adminApp({ admin: true });
    const res = await request(a).post('/api/story/import-script').send(body({ aiMotion: true, scene: { targetSceneSec: 7 } })).expect(200);
    assert.equal(res.body.project.scene.targetSceneSec, 7);
  });

  test('without a BytePlus key even a super admin gets no AI motion', async () => {
    delete process.env.BYTEPLUS_ARK_API_KEY;
    const { a } = await adminApp({ admin: true });
    const res = await request(a).post('/api/story/import-script').send(body({ aiMotion: true })).expect(200);
    assert.equal(res.body.project.aiMotion, null);
    assert.equal(res.body.project.scene, null);
  });

  test('autoStart runs the pipeline on the confined audio path', async () => {
    const { a, dir } = await adminApp();
    const audio = path.join(dir, 'tts-1.mp3');
    fs.writeFileSync(audio, 'ID3');
    const res = await request(a).post('/api/story/import-script').send(body({ audioPath: audio, autoStart: true })).expect(200);
    assert.equal(res.body.project.status, 'segmenting');
    assert.equal(pipelineCalls.length, 1);
    assert.equal(pipelineCalls[0].projectId, res.body.project.projectId);
    assert.equal(pipelineCalls[0].audioPath, path.resolve(audio));
    assert.deepEqual(pipelineCalls[0].ctx, { dataDir: dir, outputDir: dir });
  });

  test('autoStart refuses an audio path outside your own folders, and makes no project', async () => {
    const { a, dir } = await adminApp();
    const evil = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/passwd';
    const res = await request(a).post('/api/story/import-script').send(body({ audioPath: evil, autoStart: true })).expect(400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, 'mediaPath is outside the allowed directory');
    assert.equal(pipelineCalls.length, 0);
    assert.equal(fs.existsSync(path.join(dir, 'story-projects')), false);
  });

  test('autoStart refuses a missing audio file inside your folders', async () => {
    const { a, dir } = await adminApp();
    const res = await request(a).post('/api/story/import-script').send(body({ audioPath: path.join(dir, 'gone.mp3'), autoStart: true })).expect(400);
    assert.equal(res.body.error, 'mediaPath not found');
    assert.equal(pipelineCalls.length, 0);
  });

  test('without autoStart nothing runs and any path is still accepted, as before', async () => {
    const { a } = await adminApp();
    const res = await request(a).post('/api/story/import-script').send(body({ audioPath: '/somewhere/else.mp3' })).expect(200);
    assert.equal(res.body.project.source.audioPath, '/somewhere/else.mp3');
    assert.equal(pipelineCalls.length, 0);
  });

  test('a pipeline that fails lands the project in error with its message', async () => {
    const { a, dir } = await adminApp();
    story._setPipelineImpl(async () => { throw new Error('segmenter offline'); });
    const audio = path.join(dir, 'tts-2.mp3');
    fs.writeFileSync(audio, 'ID3');
    const res = await request(a).post('/api/story/import-script').send(body({ audioPath: audio, autoStart: true })).expect(200);
    const id = res.body.project.projectId;
    let got;
    for (let i = 0; i < 100; i++) {
      got = (await request(a).get(`/api/story/${id}`).expect(200)).body.project;
      if (got.status === 'error') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(got.status, 'error');
    assert.equal(got.error, 'segmenter offline');
  });
});

describe('confineImportAudio (narration in the shared outputs folder)', () => {
  const tts = 'tts-0dc7c473-7170-4355-b57f-279780487081.mp3';
  let own, shared;
  beforeEach(() => {
    own = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-own-'));
    shared = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-shared-'));
  });
  afterEach(() => {
    for (const d of [own, shared]) fs.rmSync(d, { recursive: true, force: true });
  });

  test('accepts a file in your own folders', () => {
    const f = path.join(own, 'mine.mp3');
    fs.writeFileSync(f, 'mp3');
    assert.deepEqual(confineImportAudio({ outputDir: own, dataDir: own }, f, shared), { ok: true, path: f });
  });
  test('accepts a server-named narration file in the shared outputs folder', () => {
    const f = path.join(shared, tts);
    fs.writeFileSync(f, 'mp3');
    const got = confineImportAudio({ outputDir: own, dataDir: own }, f, shared);
    assert.equal(got.ok, true);
    assert.equal(got.path, f);
  });
  test('accepts every name the narration providers write', () => {
    const uuid = '0dc7c473-7170-4355-b57f-279780487081';
    const ctx = { outputDir: own, dataDir: own };
    for (const name of [
      `tts-${uuid}.mp3`, // ElevenLabs
      `tts-edge-${uuid}.mp3`,
      `tts-azure-${uuid}.mp3`,
      `tts-fish-${uuid}.mp3`,
      `tts-chatterbox-${uuid}.wav`,
      `tts-chatterbox-${uuid}.mp3`,
      `tts-piper-${uuid}.wav`,
      `tts-piper-${uuid}.ogg`,
    ]) {
      const f = path.join(shared, name);
      fs.writeFileSync(f, 'audio');
      assert.equal(confineImportAudio(ctx, f, shared).ok, true, name);
    }
  });
  test('refuses a provider name that is not one of ours, or junk in the name', () => {
    const uuid = '0dc7c473-7170-4355-b57f-279780487081';
    const ctx = { outputDir: own, dataDir: own };
    for (const name of [
      `tts-evil-${uuid}.mp3`,
      `tts-edge-edge-${uuid}.mp3`,
      `tts-EDGE-${uuid}.mp3x`,
      `tts-edge-${uuid}.m4a`,
      `tts-edge-${uuid}.mp3.exe`,
      `xtts-edge-${uuid}.mp3`,
    ]) {
      const f = path.join(shared, name);
      fs.writeFileSync(f, 'audio');
      assert.equal(confineImportAudio(ctx, f, shared).ok, false, name);
    }
    fs.mkdirSync(path.join(shared, 'tts-edge-x'));
    const sep = path.join(shared, 'tts-edge-x', `${uuid}.mp3`);
    fs.writeFileSync(sep, 'audio');
    assert.equal(confineImportAudio(ctx, sep, shared).ok, false, 'a path separator in the provider part');
  });
  test('refuses any other shared file, a nested one, or a missing one', () => {
    const other = path.join(shared, 'someone-elses.mp3');
    fs.writeFileSync(other, 'mp3');
    fs.mkdirSync(path.join(shared, 'users'));
    const nested = path.join(shared, 'users', tts);
    fs.writeFileSync(nested, 'mp3');
    const ctx = { outputDir: own, dataDir: own };
    assert.equal(confineImportAudio(ctx, other, shared).ok, false);
    assert.equal(confineImportAudio(ctx, nested, shared).ok, false);
    assert.equal(confineImportAudio(ctx, path.join(shared, 'tts-00000000-0000-0000-0000-000000000000.mp3'), shared).ok, false);
    assert.equal(confineImportAudio(ctx, path.join(shared, '..', tts), shared).ok, false);
  });
});
