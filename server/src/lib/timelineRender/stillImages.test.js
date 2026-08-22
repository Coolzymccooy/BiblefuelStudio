import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProofRenderCommand } from './proofRenderer.js';

const SR = process.cwd();

function planWithStill(brollDurationSec = 5, totalSec = 30) {
  return {
    projectId: 'p', aspect: '16:9', durationSec: totalSec,
    assets: {
      v: { id: 'v', kind: 'video', path: '/outputs/main.mp4' },
      i: { id: 'i', kind: 'image', path: '/outputs/still.jpg' },
    },
    tracks: [
      { kind: 'video', clips: [{ id: 'c0', assetId: 'v', startSec: 0, durationSec: totalSec }] },
      { kind: 'broll', clips: [{ id: 'c1', assetId: 'i', startSec: 10, durationSec: brollDurationSec }] },
      { kind: 'voiceover', clips: [] }, { kind: 'music', clips: [] },
      { kind: 'captions', clips: [] }, { kind: 'effects', clips: [] },
    ],
  };
}

function argsFor(plan) {
  const r = buildProofRenderCommand(plan, { outputDir: SR, serverRoot: SR, dataDir: SR });
  return r.ok ? r.args : null;
}

test('a still B-roll input is looped', () => {
  // Without -loop a still decodes to ONE frame at t=0 and has no timeline, so
  // the overlay's enable='between(t,...)' never matched and the image simply
  // never appeared - with no error.
  const args = argsFor(planWithStill());
  assert.ok(args, 'command should build');
  assert.ok(args.includes('-loop'), 'still must be looped');
});

test('the loop runs for the whole OUTPUT, not the clip length', () => {
  // Each input has its own timeline starting at 0, but enable= is evaluated on
  // the output timeline. A still capped at its own 5s duration had already
  // ended before its 10-15s overlay window opened.
  const args = argsFor(planWithStill(5, 30));
  const loopIdx = args.indexOf('-loop');
  const tAfterLoop = Number(args[loopIdx + 3]);   // -loop 1 -t <n>
  assert.equal(args[loopIdx + 2], '-t');
  assert.ok(tAfterLoop >= 30, `loop -t should cover the output, got ${tAfterLoop}`);
});

test('a video B-roll input is NOT looped', () => {
  const plan = planWithStill();
  plan.assets.i = { id: 'i', kind: 'video', path: '/outputs/cut.mp4' };
  const args = argsFor(plan);
  assert.ok(!args.includes('-loop'), 'video b-roll needs no loop');
});
