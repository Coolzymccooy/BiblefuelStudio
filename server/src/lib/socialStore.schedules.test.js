import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readSocialStore, writeSocialStore } from './socialStore.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'social-store-'));
}

describe('writeSocialStore — schedule persistence', () => {
  test('PRESERVES type=auto_generate across a write/read cycle', () => {
    const dir = tmpDir();
    writeSocialStore(dir, {
      schedules: [{ id: 's1', name: 'Morning', type: 'auto_generate', cron: '0 6 * * *', timezone: 'Europe/London' }],
    });
    const back = readSocialStore(dir);
    assert.equal(back.schedules[0].type, 'auto_generate',
      'type was silently dropped — the schedule reloads as "replay" and the UI appears to reset');
  });

  test('preserves the auto_generate content settings', () => {
    const dir = tmpDir();
    writeSocialStore(dir, {
      schedules: [{
        id: 's1', type: 'auto_generate', cron: '0 22 * * *',
        niche: 'Christian encouragement', tone: 'warm', ctaStyle: 'save',
        aspect: 'portrait', durationSec: 25, voiceId: 'v-123', backgroundQuery: 'sunrise',
      }],
    });
    const s = readSocialStore(dir).schedules[0];
    assert.equal(s.niche, 'Christian encouragement');
    assert.equal(s.tone, 'warm');
    assert.equal(s.ctaStyle, 'save');
    assert.equal(s.aspect, 'portrait');
    assert.equal(s.durationSec, 25);
    assert.equal(s.voiceId, 'v-123');
    assert.equal(s.backgroundQuery, 'sunrise');
  });

  test('defaults an unknown or missing type to replay', () => {
    const dir = tmpDir();
    writeSocialStore(dir, { schedules: [{ id: 's1' }, { id: 's2', type: 'nonsense' }] });
    const back = readSocialStore(dir);
    assert.equal(back.schedules[0].type, 'replay');
    assert.equal(back.schedules[1].type, 'replay');
  });

  test('survives a round trip unchanged — the cross-device case', () => {
    const dir = tmpDir();
    const original = {
      id: 's1', name: 'Night', enabled: true, type: 'auto_generate',
      cron: '0 22 * * *', timezone: 'Europe/London', destination: 'webhook',
      webhookId: 'wh_1', niche: 'faith', durationSec: 20,
    };
    writeSocialStore(dir, { schedules: [original] });
    const first = readSocialStore(dir);
    // Simulate another device loading and re-saving without edits.
    writeSocialStore(dir, first);
    const second = readSocialStore(dir);
    assert.deepEqual(second.schedules, first.schedules,
      'a save-with-no-edits must not mutate the schedule');
  });
});

describe('reading schedules written before type was persisted', () => {
  test('recovers a typeless schedule with no video URL as auto_generate', () => {
    const dir = tmpDir();
    // Simulate a store written by the buggy build: no `type` key at all.
    fs.writeFileSync(path.join(dir, 'social.json'), JSON.stringify({
      schedules: [{ id: 's1', name: 'Morning', cron: '0 6 * * *', timezone: 'Europe/London' }],
    }));
    const s = readSocialStore(dir).schedules[0];
    assert.equal(s.type, 'auto_generate',
      'a replay schedule with no videoUrl can never post — it is a lost auto_generate');
  });

  test('a typeless schedule WITH a video URL stays replay', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'social.json'), JSON.stringify({
      schedules: [{ id: 's1', cron: '0 6 * * *', videoUrl: '/outputs/a.mp4', caption: 'hi' }],
    }));
    assert.equal(readSocialStore(dir).schedules[0].type, 'replay');
  });

  test('an EXPLICIT replay type is always honoured', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'social.json'), JSON.stringify({
      schedules: [{ id: 's1', type: 'replay', cron: '0 6 * * *' }],
    }));
    assert.equal(readSocialStore(dir).schedules[0].type, 'replay',
      'migration must never override a deliberate choice');
  });
});

// ---------------------------------------------------------------------------
// Kinetic captions on scheduled posts.
//
// The operator's scheduled videos came out with static, boxed caption lines -
// the "preview mode" look - rather than the word-by-word reveal. Two layers
// dropped the setting: normalizeSchedule had no such field, so it was stripped
// on save, and the cron payload in social.js never carried it, so
// `payload?.kineticCaptions` was always undefined and the kinetic branch in
// jobs.js never ran.
//
// Exercised through the STORE rather than the normalizer directly: that is the
// path a saved schedule actually takes, so it proves the setting survives a
// round trip rather than merely surviving one function.
describe('kinetic captions on schedules', () => {
  function roundTrip(schedule) {
    const dir = tmpDir();
    writeSocialStore(dir, { schedules: [schedule] });
    return readSocialStore(dir).schedules[0];
  }

  test('an explicit true survives the round trip', () => {
    assert.equal(roundTrip({ type: 'auto_generate', kineticCaptions: true }).kineticCaptions, true);
  });

  test('an explicit false survives - a deliberate opt-out is not "absent"', () => {
    assert.equal(roundTrip({ type: 'auto_generate', kineticCaptions: false }).kineticCaptions, false);
  });

  test('defaults to TRUE for auto_generate', () => {
    // These posts reach a public feed with no human review, so the better
    // caption is the right default. Static was never chosen - it was the
    // accident of an absent field.
    assert.equal(roundTrip({ type: 'auto_generate' }).kineticCaptions, true);
  });

  test('a replay schedule gains no caption setting', () => {
    // Replay reposts an existing video; there is nothing to caption.
    const s = roundTrip({ type: 'replay', videoUrl: 'https://x/v.mp4' });
    assert.equal(s.kineticCaptions, undefined);
  });

  test('a non-boolean is coerced', () => {
    assert.equal(typeof roundTrip({ type: 'auto_generate', kineticCaptions: 'yes' }).kineticCaptions, 'boolean');
  });
});
