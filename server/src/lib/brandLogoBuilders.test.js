import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { buildStoryFfmpegArgs } from './story/storyRender.js';
import { buildAmbientFfmpegArgs } from './ambient/ambientRender.js';
import { buildProofRenderCommand } from './timelineRender/proofRenderer.js';
import { logoGeometry } from './branding.js';

// Story Video (and long-form, which renders through it), Ambient sessions and
// the Timeline editor each build their own ffmpeg command. With a logo, each
// must end its picture with the logo overlay; then a real render must show it.

const FF = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
const hasFfmpeg = spawnSync(FF, ['-version']).status === 0;

let dir;
let m;

function ff(args) {
  const r = spawnSync(FF, ['-y', '-v', 'error', ...args]);
  assert.equal(r.status, 0, String(r.stderr));
}

function run(args) {
  const r = spawnSync(FF, ['-v', 'error', ...args.filter((a, i) => !(a === '-y' && i === 0))]);
  assert.equal(r.status, 0, String(r.stderr).slice(-2000));
}

function assertLogo(video, w, h, t = 0.5) {
  const { width, marginX, marginY } = logoGeometry(w, h);
  const r = spawnSync(FF, ['-v', 'error', '-ss', String(t), '-i', video, '-frames:v', '1',
    '-vf', `crop=1:1:${w - marginX - width / 2}:${marginY + width / 2},format=rgb24`, '-f', 'rawvideo', '-']);
  const [red, green] = r.stdout;
  assert.ok(red > 170 && green < 100, `${path.basename(video)}: expected the logo, got rgb ${red},${green}`);
}

const graphOf = (args) => {
  const i = args.indexOf('-filter_complex');
  if (i >= 0) return args[i + 1];
  return fs.readFileSync(args[args.indexOf('-filter_complex_script') + 1], 'utf8');
};
const mapped = (args) => args[args.indexOf('-map') + 1];

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-builders-'));
  m = {
    logo: { file: path.join(dir, 'logo.png'), position: 'top-right', size: 'medium', opacity: 1 },
    green: path.join(dir, 'green.png'),
    voice: path.join(dir, 'voice.m4a'),
  };
  if (!hasFfmpeg) return fs.writeFileSync(m.logo.file, 'x');
  ff(['-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', m.logo.file]);
  ff(['-f', 'lavfi', '-i', 'color=c=0x00FF00:s=640x360', '-frames:v', '1', m.green]);
  ff(['-f', 'lavfi', '-i', 'sine=f=440:d=2', '-c:a', 'aac', m.voice]);
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('Story Video', () => {
  const build = (logo, over = {}) => buildStoryFfmpegArgs({
    scenes: [{ id: 's1', startMs: 0, endMs: 2000, imagePath: m.green }],
    words: [{ text: 'Peace', startMs: 0, endMs: 900 }], audioPath: m.voice, musicPath: null,
    width: 360, height: 640, outPath: path.join(dir, `story-${logo ? 'logo' : 'plain'}.mp4`),
    audioDurationSec: 2, captions: 'none', logo, ...over,
  }).args;

  test('the logo is the last thing drawn on the picture', () => {
    const args = build(m.logo, { captions: 'kinetic' });
    assert.equal(mapped(args), '[vout]');
    assert.match(graphOf(args), /\[vcat\]drawtext=.*\[vcap\]/);
    assert.match(graphOf(args), /\[vcap\]\[brandlogo\]overlay=[^;]*\[vout\]/);
  });

  test('without a logo the graph is unchanged', () => {
    assert.ok(!graphOf(build(null)).includes('movie='));
    assert.match(graphOf(build(null)), /\[vcat\]copy\[vout\]/);
  });

  test('a real story render carries the logo', { skip: !hasFfmpeg && 'ffmpeg not installed' }, () => {
    const args = build(m.logo);
    run(args);
    assertLogo(args[args.length - 1], 360, 640, 1.5);
  });
});

describe('Ambient sessions', () => {
  const project = (over = {}) => ({
    aspect: 'landscape', targetSec: 2, motion: 'still', captions: 'none',
    bed: { volume: 0.85 }, movements: [{ startMs: 0, endMs: 2000 }], ...over,
  });
  const build = (logo, proj = project()) => buildAmbientFfmpegArgs(proj, {
    bedPath: m.voice, images: [m.green], drops: [], outPath: path.join(dir, `ambient-${logo ? 'logo' : 'plain'}.mp4`),
    workDir: dir, logo,
  });

  test('the logo goes over the picture and is what gets encoded', () => {
    const { args, filter } = build(m.logo);
    assert.equal(mapped(args), '[vlogo]');
    assert.match(filter, /\[s0\]\[brandlogo\]overlay=[^;]*\[vlogo\]/);
  });

  test('without a logo the picture is mapped as before', () => {
    const { args, filter } = build(null);
    assert.equal(mapped(args), '[s0]');
    assert.ok(!filter.includes('movie='));
  });

  test('a real ambient render carries the logo', { skip: !hasFfmpeg && 'ffmpeg not installed' }, () => {
    const { args } = build(m.logo);
    run(args);
    assertLogo(args[args.length - 1], 1920, 1080, 1.5);
  });
});

describe('Timeline editor', () => {
  const plan = () => ({
    projectId: 'brand', aspect: '16:9', quality: 'proof_720p', durationSec: 2,
    tracks: [{ kind: 'video', clips: [{ id: 'main', label: 'Main', path: 'uploads/green.mp4', startSec: 0, durationSec: 2 }] }],
  });
  const build = (logo) => buildProofRenderCommand(plan(), {
    outputPath: path.join(dir, `timeline-${logo ? 'logo' : 'plain'}.mp4`),
    serverRoot: dir, outputDir: dir, logo,
  });

  before(() => {
    fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
    const clip = path.join(dir, 'uploads', 'green.mp4');
    if (!hasFfmpeg) return fs.writeFileSync(clip, 'x');
    ff(['-f', 'lavfi', '-i', 'color=c=0x00FF00:s=640x360:d=2:r=25', '-f', 'lavfi', '-i', 'sine=d=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
  });

  test('the logo produces the final [v] picture', () => {
    const { args } = build(m.logo);
    assert.equal(mapped(args), '[v]');
    assert.match(graphOf(args), /\[brandlogo\]overlay=[^;]*\[v\]/);
    assert.ok(!/null\[v\]/.test(graphOf(args)));
  });

  test('without a logo the picture passes straight through', () => {
    assert.match(graphOf(build(null).args), /null\[v\]/);
  });

  test('a logo removed while voice-overs were being made is skipped, not fatal', () => {
    const gone = { ...m.logo, file: path.join(dir, 'deleted-logo.png') };
    const graph = graphOf(build(gone).args);
    assert.ok(!graph.includes('movie='));
    assert.match(graph, /null\[v\]/);
  });

  test('a real timeline render carries the logo', { skip: !hasFfmpeg && 'ffmpeg not installed' }, () => {
    const { args } = build(m.logo);
    run(args);
    assertLogo(args[args.length - 1], 1280, 720, 1.5);
  });
});
