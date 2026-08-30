import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isElevenLabsConfigured, describeElevenLabsKeyProblem } from './elevenLabsTts.js';

const ORIGINAL = process.env.ELEVENLABS_API_KEY;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = ORIGINAL;
});

describe('isElevenLabsConfigured', () => {
  test('accepts a real secret key', () => {
    process.env.ELEVENLABS_API_KEY = 'sk_' + 'a'.repeat(40);
    assert.equal(isElevenLabsConfigured(), true);
  });

  test('rejects a key ID pasted in place of the key', () => {
    // ElevenLabs shows a key ID next to each key in the dashboard; pasting it
    // gets a 400 "API key ID used as API key" on EVERY request.
    process.env.ELEVENLABS_API_KEY = '1b5' + 'f'.repeat(61);
    assert.equal(isElevenLabsConfigured(), false);
  });

  test('rejects an empty or placeholder key', () => {
    process.env.ELEVENLABS_API_KEY = '';
    assert.equal(isElevenLabsConfigured(), false);
    process.env.ELEVENLABS_API_KEY = 'your-key-here';
    assert.equal(isElevenLabsConfigured(), false);
  });

  test('tolerates surrounding quotes and whitespace', () => {
    process.env.ELEVENLABS_API_KEY = '  "sk_' + 'b'.repeat(40) + '"  ';
    assert.equal(isElevenLabsConfigured(), true);
  });
});

describe('describeElevenLabsKeyProblem', () => {
  test('names the key-ID mistake specifically', () => {
    process.env.ELEVENLABS_API_KEY = '1b5' + 'f'.repeat(61);
    assert.match(describeElevenLabsKeyProblem(), /key ID/i);
    assert.match(describeElevenLabsKeyProblem(), /sk_/);
  });

  test('reports a missing key', () => {
    process.env.ELEVENLABS_API_KEY = '';
    assert.match(describeElevenLabsKeyProblem(), /not set/i);
  });

  test('returns empty when the key looks valid', () => {
    process.env.ELEVENLABS_API_KEY = 'sk_' + 'c'.repeat(40);
    assert.equal(describeElevenLabsKeyProblem(), '');
  });
});
