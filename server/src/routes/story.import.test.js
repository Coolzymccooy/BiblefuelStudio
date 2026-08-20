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
