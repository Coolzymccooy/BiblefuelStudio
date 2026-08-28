import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProjectAssets } from '../../src/lib/timelineRender/resolveProjectAssets.js';

const project = (assets) => ({ id: 'p', assets, tracks: [] });

test('a library id on a B-roll asset becomes the resolved media path', () => {
  const out = resolveProjectAssets(project({ a: { id: 'a', kind: 'video', path: '10904745' } }), {
    exists: () => false,
    resolve: (v) => (v === '10904745' ? 'C:/data/library/10904745.mp4' : null),
  });
  assert.equal(out.assets.a.path, 'C:/data/library/10904745.mp4');
  assert.equal(out.assets.a.sourceId, '10904745');
});

test('existing files and URLs are left alone, and the same object comes back when nothing changed', () => {
  const p = project({ f: { path: 'outputs/x.mp4' }, u: { path: 'https://cdn/x.mp4' } });
  const out = resolveProjectAssets(p, { exists: (v) => v === 'outputs/x.mp4', resolve: () => { throw new Error('must not be called'); } });
  assert.equal(out, p);
});

test('an id that resolves to nothing is left for the renderer to report', () => {
  const out = resolveProjectAssets(project({ a: { path: 'nope' } }), { exists: () => false, resolve: () => null });
  assert.equal(out.assets.a.path, 'nope');
});
