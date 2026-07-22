import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isVideoGenEnabled,
  listVideoProviderChain,
  generateTimelineVideo,
} from './index.js';
import { generateVideoVeo } from './providers/veo.js';

const ENV_KEYS = [
  'VIDEO_GEN_ENABLED',
  'VIDEO_GEN_PROVIDER',
  'VEO_API_KEY',
  'VEO_API_URL',
  'GOOGLE_VERTEX_PROJECT',
  'GOOGLE_VERTEX_LOCATION',
  'GOOGLE_APPLICATION_CREDENTIALS',
];
const saved = {};

function snapshotEnv() {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
}

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

describe('videoGen orchestrator — config & provider chain', () => {
  beforeEach(() => {
    snapshotEnv();
    clearEnv();
  });

  afterEach(() => restoreEnv());

  test('isVideoGenEnabled defaults false when no provider is configured', () => {
    assert.equal(isVideoGenEnabled(), false);
    assert.deepEqual(listVideoProviderChain(), []);
  });

  test('Veo joins provider chain when API key or Vertex project is configured', () => {
    process.env.VEO_API_KEY = 'key';
    assert.equal(isVideoGenEnabled(), true);
    assert.deepEqual(listVideoProviderChain(), ['veo']);
  });

  test('VIDEO_GEN_ENABLED=false force-disables configured providers', () => {
    process.env.VEO_API_KEY = 'key';
    process.env.VIDEO_GEN_ENABLED = 'false';
    assert.equal(isVideoGenEnabled(), false);
    assert.deepEqual(listVideoProviderChain(), []);
  });

  test('VIDEO_GEN_PROVIDER=none isolates the chain to no providers', () => {
    process.env.VEO_API_KEY = 'key';
    process.env.VIDEO_GEN_PROVIDER = 'none';
    assert.deepEqual(listVideoProviderChain(), []);
  });
});

describe('videoGen orchestrator — generateTimelineVideo', () => {
  beforeEach(() => {
    snapshotEnv();
    clearEnv();
  });

  afterEach(() => restoreEnv());

  test('returns skipped:true when no provider is configured', async () => {
    const result = await generateTimelineVideo({
      projectId: 'lhp',
      prompt: 'cinematic golden worship light rays',
      aspect: '16:9',
      durationSec: 8,
    });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(result.provider, undefined);
  });

  test('configured Veo provider is surfaced as not implemented until real credentials/API call are wired', async () => {
    process.env.VEO_API_KEY = 'key';
    const result = await generateTimelineVideo({
      projectId: 'lhp',
      prompt: 'cinematic golden worship light rays',
      aspect: '16:9',
      durationSec: 8,
    });

    assert.equal(result.ok, false);
    assert.equal(result.provider, 'veo');
    assert.equal(result.code, 'PROVIDER_NOT_IMPLEMENTED');
    assert.match(result.error, /Veo/i);
  });

  test('Veo provider posts to an official configured endpoint when VEO_API_URL is set', async () => {
    process.env.VEO_API_KEY = 'key';
    process.env.VEO_API_URL = 'https://veo.example.test/generate';
    const calls = [];
    const result = await generateVideoVeo({
      projectId: 'lhp',
      prompt: 'cinematic golden worship light rays',
      aspect: '16:9',
      durationSec: 8,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ publicUrl: 'https://cdn.example.test/veo.mp4', path: 'gs://bucket/veo.mp4' }) };
      },
    });

    assert.equal(calls[0].url, 'https://veo.example.test/generate');
    assert.match(calls[0].init.headers.Authorization, /^Bearer /);
    assert.equal(result.ok, true);
    assert.equal(result.publicUrl, 'https://cdn.example.test/veo.mp4');
  });
});
