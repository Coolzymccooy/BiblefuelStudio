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
