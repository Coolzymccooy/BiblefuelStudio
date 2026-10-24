/**
 * Timeline renders must not hand remote media URLs to ffmpeg (it would fetch
 * them with no SSRF check). renderTimelineProof localises every remote clip or
 * asset path first; a refused URL fails the render before ffmpeg runs.
 *
 * OUTPUT_DIR is set BEFORE import because paths.js reads it at import time and
 * the real localiser caches under it.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-remote-'));
process.env.OUTPUT_DIR = dir;
const { renderTimelineProof } = await import('./proofRenderer.js');

const REMOTE_BROLL = 'https://cdn.example.com/rays.mp4';
const REMOTE_ASSET = 'https://cdn.example.com/still.jpg';

function plan({ brollPath = REMOTE_BROLL } = {}) {
  return {
    projectId: 'timeline-remote',
    aspect: '16:9',
    durationSec: 12,
    assets: { pic: { id: 'pic', path: REMOTE_ASSET } },
    tracks: [
      { kind: 'video', clips: [{ id: 'main', path: '/outputs/main.mp4', startSec: 0, durationSec: 12 }] },
      {
        kind: 'broll',
        clips: [
          { id: 'b1', path: brollPath, startSec: 2, durationSec: 3 },
          { id: 'b2', assetId: 'pic', startSec: 6, durationSec: 3 },
        ],
      },
    ],
  };
}

const opts = (extra = {}) => ({
  outputPath: path.join(dir, 'timeline', 'job.mp4'),
  serverRoot: dir,
  outputDir: dir,
  ...extra,
});

let localCopies;
before(() => {
  localCopies = {
    [REMOTE_BROLL]: path.join(dir, 'cache', 'rays.mp4'),
    [REMOTE_ASSET]: path.join(dir, 'cache', 'still.jpg'),
  };
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('renderTimelineProof remote media', () => {
  test('remote clip and asset paths reach ffmpeg as local files, never URLs', async () => {
    const asked = [];
    const localise = async (value) => {
      if (!/^https?:/.test(String(value))) return value;
      asked.push(value);
      return localCopies[value];
    };
    let args = null;
    const runner = async (a) => { args = a; return { ok: true, stderr: '' }; };
    const result = await renderTimelineProof(plan(), opts({ localise, runner }));
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(asked.sort(), [REMOTE_ASSET, REMOTE_BROLL].sort());
    const inputs = args.filter((_a, i) => args[i - 1] === '-i');
    assert.ok(inputs.includes(localCopies[REMOTE_BROLL]), inputs.join(' | '));
    assert.ok(inputs.includes(localCopies[REMOTE_ASSET]), inputs.join(' | '));
    assert.equal(args.some((a) => /^https?:\/\//.test(a)), false);
  });

  test('a still keeps its image handling after localising (extension preserved)', async () => {
    const localise = async (value) => localCopies[value] || value;
    let args = null;
    const runner = async (a) => { args = a; return { ok: true, stderr: '' }; };
    await renderTimelineProof(plan(), opts({ localise, runner }));
    const at = args.indexOf(localCopies[REMOTE_ASSET]);
    assert.ok(at > 0, 'the localised still is an ffmpeg input');
    assert.ok(args.slice(Math.max(0, at - 6), at).includes('-loop'), args.join(' '));
  });

  test('a private URL fails the render with URL_PRIVATE before ffmpeg runs', async () => {
    let ran = false;
    const runner = async () => { ran = true; return { ok: true, stderr: '' }; };
    const result = await renderTimelineProof(
      plan({ brollPath: 'http://169.254.169.254/latest/meta-data/x.mp4' }),
      opts({ runner }),
    );
    assert.equal(result.ok, false);
    assert.ok(String(result.error).startsWith('URL_PRIVATE: '), result.error);
    assert.equal(ran, false);
  });

  test('a plan with only local media is rendered without localising anything', async () => {
    const asked = [];
    const localise = async (value) => { asked.push(value); return value; };
    const local = plan({ brollPath: '/outputs/rays.mp4' });
    delete local.assets;
    local.tracks[1].clips = local.tracks[1].clips.slice(0, 1);
    const runner = async () => ({ ok: true, stderr: '' });
    const result = await renderTimelineProof(local, opts({ localise, runner }));
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(asked.filter((v) => /^https?:/.test(String(v))), []);
  });
});
