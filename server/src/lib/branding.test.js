import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  brandLogoFor,
  logoFileFor,
  logoGeometry,
  logoOverlay,
  readBranding,
  withLogoVf,
  writeBranding,
} from './branding.js';

const FF = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
const hasFfmpeg = spawnSync(FF, ['-version']).status === 0;

function account(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function putLogo(dataDir, colour = 'red') {
  const file = logoFileFor(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = spawnSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${colour}:s=64x64`, '-frames:v', '1', file]);
  assert.equal(r.status, 0, String(r.stderr));
  return file;
}

/** RGB of one pixel of the frame at `t` seconds. */
function pixelAt(video, x, y, t = 0.5) {
  const r = spawnSync(FF, ['-v', 'error', '-ss', String(t), '-i', video, '-frames:v', '1',
    '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-']);
  assert.equal(r.status, 0, String(r.stderr));
  return [...r.stdout.subarray(0, 3)];
}

test('an account with no branding has it off, with sensible defaults', (t) => {
  const b = readBranding(account(t));
  assert.deepEqual(b, { enabled: false, position: 'top-right', size: 'medium', opacity: 0.85, hasLogo: false });
});

test('settings are kept, and bad values fall back rather than being stored', (t) => {
  const dir = account(t);
  writeBranding(dir, { position: 'bottom-left', size: 'large', opacity: 0.6 });
  assert.deepEqual(
    { ...readBranding(dir), hasLogo: undefined },
    { enabled: false, position: 'bottom-left', size: 'large', opacity: 0.6, hasLogo: undefined },
  );
  writeBranding(dir, { position: 'middle', size: 'huge', opacity: 7, enabled: 'yes' });
  const b = readBranding(dir);
  assert.equal(b.position, 'top-right');
  assert.equal(b.size, 'medium');
  assert.equal(b.opacity, 1);
  assert.equal(b.enabled, false, 'only a real true turns branding on');
});

test('a corrupt settings file reads as defaults instead of breaking renders', (t) => {
  const dir = account(t);
  fs.writeFileSync(path.join(dir, 'branding.json'), '{not json');
  assert.equal(readBranding(dir).enabled, false);
  assert.equal(brandLogoFor(dir), null);
});

test('a logo is drawn only when branding is on AND a logo is uploaded', (t) => {
  const dir = account(t);
  assert.equal(brandLogoFor(dir), null);
  writeBranding(dir, { enabled: true });
  assert.equal(brandLogoFor(dir), null, 'on, but no logo yet');
  fs.mkdirSync(path.dirname(logoFileFor(dir)), { recursive: true });
  fs.writeFileSync(logoFileFor(dir), 'x');
  assert.deepEqual(brandLogoFor(dir), { file: logoFileFor(dir), position: 'top-right', size: 'medium', opacity: 0.85 });
  writeBranding(dir, { enabled: false });
  assert.equal(brandLogoFor(dir), null);
  assert.equal(brandLogoFor(undefined), null, 'no account, no logo');
});

test('accounts never see each other\'s logo', (t) => {
  const a = account(t);
  const b = account(t);
  fs.mkdirSync(path.dirname(logoFileFor(a)), { recursive: true });
  fs.writeFileSync(logoFileFor(a), 'x');
  writeBranding(a, { enabled: true });
  writeBranding(b, { enabled: true });
  assert.ok(brandLogoFor(a));
  assert.equal(brandLogoFor(b), null);
});

test('the logo is sized and placed for the frame\'s shape', () => {
  // A box a tenth of the shorter side: discreet whatever the logo's shape.
  assert.deepEqual(logoGeometry(1920, 1080), { box: 108, marginX: 58, marginY: 43 });
  assert.deepEqual(logoGeometry(1080, 1920), { box: 130, marginX: 32, marginY: 115 });
  assert.equal(logoGeometry(1080, 1080).box, 108);
  assert.equal(logoGeometry(1920, 1080, 'large').box, 140);
  assert.equal(logoGeometry(1920, 1080, 'small').box, 82);
});

test('the overlay reads the logo inside the graph and lands in the chosen corner', () => {
  const logo = { file: 'C:\\brand\\logo.png', position: 'top-right', size: 'medium', opacity: 0.85 };
  const f = logoOverlay(logo, { w: 1920, h: 1080, from: 'vout', to: 'vlogo' });
  // The drive colon is escaped once for the options layer, then that
  // backslash once more for the graph layer.
  assert.equal(f, "movie=C\\\\:/brand/logo.png,scale=108:108:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=0.85[brandlogo];"
    + '[vout][brandlogo]overlay=x=main_w-overlay_w-58:y=43[vlogo]');
  const bl = logoOverlay({ ...logo, position: 'bottom-left' }, { w: 1920, h: 1080, from: 'a', to: 'b' });
  assert.match(bl, /overlay=x=58:y=main_h-overlay_h-43\[b\]$/);
});

test('a quote in the logo path cannot end the filter argument', { skip: !hasFfmpeg && 'ffmpeg not installed' }, (t) => {
  const dir = path.join(account(t), "o'brien");
  writeBranding(dir, { enabled: true, opacity: 1 });
  putLogo(dir, 'red');
  const logo = brandLogoFor(dir);
  const out = path.join(dir, 'q.mp4');
  const r = spawnSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x00FF00:s=640x360:d=1:r=25',
    '-vf', withLogoVf('null', logo, { w: 640, h: 360 }), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
  assert.equal(r.status, 0, String(r.stderr));
  const { box: width, marginX, marginY } = logoGeometry(640, 360);
  const [red] = pixelAt(out, 640 - marginX - width / 2, marginY + width / 2);
  assert.ok(red > 180, 'the logo was still found and drawn');
});

test('withLogoVf leaves a chain alone without a logo, and ends it with the overlay with one', () => {
  assert.equal(withLogoVf('scale=10:10', null, { w: 10, h: 10 }), 'scale=10:10');
  const logo = { file: '/l.png', position: 'top-left', size: 'medium', opacity: 1 };
  assert.match(withLogoVf('scale=1920:1080', logo, { w: 1920, h: 1080 }),
    /^scale=1920:1080\[brandbase\];movie=\/l\.png,.*\[brandbase\]\[brandlogo\]overlay=x=58:y=43$/);
});

test('ffmpeg draws the logo in the corner for the whole video, in both graph forms', { skip: !hasFfmpeg && 'ffmpeg not installed' }, (t) => {
  const dir = account(t);
  writeBranding(dir, { enabled: true, opacity: 1 });
  putLogo(dir, 'red');
  const logo = brandLogoFor(dir);
  const [W, H] = [640, 360];
  const { box: width, marginX, marginY } = logoGeometry(W, H);
  const at = [W - marginX - width / 2, marginY + width / 2];
  const green = ['-f', 'lavfi', '-i', `color=c=0x00FF00:s=${W}x${H}:d=2:r=25`];
  const outs = {
    complex: ['-filter_complex', `[0:v]null[base];${logoOverlay(logo, { w: W, h: H, from: 'base', to: 'v' })}`, '-map', '[v]'],
    vf: ['-vf', withLogoVf('null', logo, { w: W, h: H })],
  };
  for (const [name, graph] of Object.entries(outs)) {
    const out = path.join(dir, `${name}.mp4`);
    const r = spawnSync(FF, ['-y', '-v', 'error', ...green, ...graph, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    for (const time of [0.1, 1.9]) {
      const [red, grn] = pixelAt(out, at[0], at[1], time);
      assert.ok(red > 180 && grn < 90, `${name} at ${time}s: logo pixel was ${red},${grn}`);
    }
    const [r2, g2] = pixelAt(out, 20, H - 20, 1);
    assert.ok(g2 > 180 && r2 < 90, `${name}: the rest of the frame is untouched`);
  }
});
