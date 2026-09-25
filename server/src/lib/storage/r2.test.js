import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildR2ObjectKey, getR2Config, publicUrlForKey, putR2Object } from './r2.js';

describe('R2 storage adapter', () => {
  test('reports unconfigured until endpoint bucket and credentials exist', () => {
    const cfg = getR2Config({});
    assert.equal(cfg.configured, false);
  });

  test('accepts BibleFuel R2 env naming and builds public URLs', () => {
    const cfg = getR2Config({
      R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      R2_BUCKET: 'biblefuel-media',
      R2_ACCESS_KEY_ID: 'id',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_PUBLIC_BASE_URL: 'https://media.example.test/biblefuel',
    });
    assert.equal(cfg.configured, true);
    assert.equal(publicUrlForKey('veo/project/file name.mp4', cfg), 'https://media.example.test/biblefuel/veo/project/file%20name.mp4');
  });

  test('uploads a signed PUT request without exposing secrets in the response', async () => {
    const calls = [];
    const result = await putR2Object({
      key: 'veo/proj/video.mp4',
      body: Buffer.from('video'),
      contentType: 'video/mp4',
      config: {
        configured: true,
        endpoint: 'https://acct.r2.cloudflarestorage.com',
        bucket: 'biblefuel-media',
        accessKeyId: 'id',
        secretAccessKey: 'secret',
        publicBaseUrl: 'https://media.example.test',
        region: 'auto',
      },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, text: async () => '' };
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://acct.r2.cloudflarestorage.com/biblefuel-media/veo/proj/video.mp4');
    assert.match(calls[0].init.headers.Authorization, /^AWS4-HMAC-SHA256 /);
    assert.equal(result.path, 'r2://biblefuel-media/veo/proj/video.mp4');
    assert.equal(result.publicUrl, 'https://media.example.test/veo/proj/video.mp4');
  });

  test('builds scoped object keys', () => {
    const key = buildR2ObjectKey({ projectId: 'Lighthouse Praise 2026', prefix: 'veo', extension: '.mp4' });
    assert.match(key, /^veo\/Lighthouse-Praise-2026\/[0-9a-f-]+\.mp4$/i);
  });
});
