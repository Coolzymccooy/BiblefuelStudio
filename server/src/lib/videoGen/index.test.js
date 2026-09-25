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
  'VEO_MODEL',
  'VEO_MAX_POLLS',
  'VEO_POLL_MS',
  'GOOGLE_AI_API_KEY',
  'GEMINI_API_KEY',
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

  test('configured Veo provider calls the official Gemini long-running video API when no custom endpoint is set', async () => {
    process.env.VEO_API_KEY = 'key';
    process.env.VEO_MAX_POLLS = '1';
    process.env.VEO_POLL_MS = '250';
    const calls = [];
    const result = await generateVideoVeo({
      projectId: 'lhp',
      prompt: 'cinematic golden worship light rays',
      aspect: '16:9',
      durationSec: 8,
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        // Model discovery: the provider asks which veo models this key can
        // drive rather than trusting a hardcoded id that goes stale.
        if (String(url).includes('/models?')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              models: [
                { name: 'models/veo-3.1-lite-generate-preview', supportedGenerationMethods: ['predictLongRunning'] },
                { name: 'models/veo-3.1-generate-preview', supportedGenerationMethods: ['predictLongRunning'] },
                { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
              ],
            }),
          };
        }
        if (String(url).includes(':predictLongRunning')) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ name: 'operations/veo-123' }) };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            done: true,
            response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://download.example.test/veo.mp4' } }] } },
          }),
        };
      },
      r2Config: { configured: false },
    });

    // Discovery first, then generate against a model the key ACTUALLY has.
    // This used to pin veo-3.0-generate-preview, which Google stopped serving:
    // every real request died on "model ... is not found for API version
    // v1beta" while /status still reported enabled:true. Pinning the id in a
    // test only made the stale value look correct.
    assert.match(calls[0].url, /\/models\?/);
    assert.match(calls[1].url, /models\/veo-3\.1-generate-preview(%3A|:)predictLongRunning/);
    // The full model wins over fast/lite when nobody pinned VEO_MODEL.
    assert.ok(!/lite/.test(calls[1].url));
    assert.match(calls[2].url, /operations\/veo-123/);
    // Veo 3.1 rejects 'allow_adult' and 'dont_allow' outright.
    assert.equal(JSON.parse(calls[1].init.body).parameters.personGeneration, 'allow_all');
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'veo');
    assert.equal(result.publicUrl, 'https://download.example.test/veo.mp4');
    assert.equal(result.storage.provider, 'google-temporary');
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
