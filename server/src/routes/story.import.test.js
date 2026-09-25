import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import storyRouter from './story.js';

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
