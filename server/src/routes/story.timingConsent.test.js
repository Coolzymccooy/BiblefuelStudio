import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import router, { _setRenderImpl, _resetRenderImpl } from './story.js';
import { createProject, writeProject, readProject } from '../lib/story/projectStore.js';
import tools from '../mcp/tools/story.js';
const renderTool = tools.find(t => t.name === 'story_render');
const dirs = [];
afterEach(() => { _resetRenderImpl(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function fixture(timing, captions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-consent-')); dirs.push(dir);
  const audio = path.join(dir, 'audio.mp3'); fs.writeFileSync(audio, 'synthetic-not-a-provider-file');
  let project = createProject(dir, { title: 'Synthetic consent' });
  project = writeProject(dir, { ...project, status: 'ready_to_render', captions,
    source: { audioPath: audio, durationMs: 100 },
    transcript: { words: [{ text: 'hello', startMs: 0, endMs: 100 }], timing },
    scenes: [{ id: 's1', text: 'hello', imageStatus: 'done', imagePath: path.join(dir, 'fake.png'), startMs: 0, endMs: 100 }] });
  const a = express(); a.use(express.json()); a.use((req, _res, next) => { req.ctx = { userId: 'synthetic', dataDir: dir, outputDir: dir }; next(); }); a.use('/api/story', router);
  let starts = 0; _setRenderImpl(async () => { starts++; return { ok: true }; });
  return { a, dir, project, starts: () => starts };
}
for (const timing of [{ provenance: 'estimated', estimated: true, verified: false }, undefined, { provenance: 'section-spread' }]) {
  test(`HTTP ${timing?.provenance || 'legacy unknown'} refuses without exact boolean consent, creates no job; consent is per-render`, async () => {
    const f = fixture(timing); const url = `/api/story/${f.project.projectId}/render`;
    const before = fs.readdirSync(f.dir).sort();
    for (const body of [{}, { acknowledgeApproximateTiming: false }, { acknowledgeApproximateTiming: 'true' }, { captions: 'none' }]) {
      const r = await request(f.a).post(url).send(body).expect(409);
      assert.equal(r.body.code, 'TIMING_CONSENT_REQUIRED');
      assert.match(r.body.error, /not acoustically verified/);
    }
    assert.equal(f.starts(), 0); assert.deepEqual(fs.readdirSync(f.dir).sort(), before);
    assert.equal(readProject(f.dir, f.project.projectId).render.jobId, null);
    const r = await request(f.a).post(url).send({ acknowledgeApproximateTiming: true }).expect(200);
    assert.ok(r.body.jobId); assert.equal(f.starts(), 1);
    assert.equal(readProject(f.dir, f.project.projectId).acknowledgeApproximateTiming, undefined);
    await request(f.a).post(url).send({}).expect(409); assert.equal(f.starts(), 1);
  });
}
for (const [name, timing, captions] of [
  ['captionless estimates', { estimated: true }, 'none'], ['native', { provenance: 'native', verified: false }],
  ['supplied', { provenance: 'supplied', accuracy: 'unknown', verified: false }],
]) test(`HTTP ${name} starts without approximate consent`, async () => {
  const f = fixture(timing, captions);
  const response = await request(f.a).post(`/api/story/${f.project.projectId}/render`).send({}).expect(200);
  if (captions === 'none') assert.equal(response.body.timingWarning, null);
  else assert.match(response.body.timingWarning, /not acoustically verified/);
  assert.equal(f.starts(), 1);
});
for (const [name, timing, captions, needsConsent] of [
  ['estimated', { estimated: true }, undefined, true], ['legacy', undefined, undefined, true],
  ['unknown', { provenance: 'unknown' }, undefined, true],
  ['manual retains estimates', { provenance: 'manual', originalEvidence: { estimated: true } }, undefined, true],
  ['native estimated flag wins', { provenance: 'native', estimated: true }, undefined, true],
  ['static estimates', { estimated: true }, 'static', true], ['native', { provenance: 'native' }, undefined, false],
  ['supplied', { provenance: 'supplied', accuracy: 'unknown' }, undefined, false],
  ['captionless', { estimated: true }, 'none', false],
]) test(`MCP + HTTP ${name}: refusal before cap; consent forwards and starts once`, async () => {
  const f = fixture(timing, captions); let caps = 0; let posts = 0;
  const ctx = { publicBase: 'http://synthetic', chargeCap: async () => { caps++; return null; },
    api: { call: async (method, url, opts) => {
      if (url === '/api/billing/usage') return { ok: true, usage: { buckets: { render: { unlimited: true, limit: -1 } } } };
      if (method === 'GET') return (await request(f.a).get(url)).body;
      posts++; const r = await request(f.a).post(url).send(opts?.body || {}); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body;
    } } };
  if (needsConsent) {
    const r = await renderTool.handler(ctx, { id: f.project.projectId });
    assert.equal(r.structuredContent.error, 'TIMING_CONSENT_REQUIRED');
    assert.equal(caps, 0); assert.equal(posts, 0); assert.equal(f.starts(), 0);
    assert.equal(readProject(f.dir, f.project.projectId).render.jobId, null);
  }
  const r = await renderTool.handler(ctx, { id: f.project.projectId, ...(needsConsent ? { acknowledgeApproximateTiming: true } : {}) });
  if (captions === "none") assert.equal(r.structuredContent.timingWarning, null);
  else assert.match(r.structuredContent.timingWarning, /not acoustically verified/);
  assert.notEqual(r.isError, true, JSON.stringify(r)); assert.equal(caps, 1); assert.equal(posts, 1); assert.equal(f.starts(), 1);
});
