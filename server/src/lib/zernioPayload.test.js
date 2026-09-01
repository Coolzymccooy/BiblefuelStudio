import test from 'node:test';
import assert from 'node:assert/strict';
import { buildZernioPost, isTikTokCapacityError } from './zernioPayload.js';

// The operator's TikTok posts published normally until 28 Aug, then failed on
// every attempt from 30 Aug. Zernio's own error names both the cause and the
// remedy: "TikTok direct posting is at capacity right now. Use
// tiktokSettings.draft: true to deliver via Creator Inbox".
//
// Nothing in this app changed. Without a fallback the render is simply lost.

const BASE = {
  caption: 'The storm may rage, but so can your peace.',
  title: 'Peace',
  videoUrl: 'https://media.tiwaton.co.uk/outputs/video-abc.mp4',
  accountId: '6a01xxxxxxxxxxxxxxxxeca8',
};

test('the normal post publishes immediately and sends no tiktokSettings', () => {
  const p = buildZernioPost(BASE);
  assert.equal(p.publishNow, true);
  // Sending draft:false is NOT the same as omitting it; the happy path must
  // keep behaving exactly as it did while posts were publishing fine.
  assert.equal('tiktokSettings' in p, false);
});

test('the draft fallback asks for Creator Inbox delivery', () => {
  const p = buildZernioPost({ ...BASE, draft: true });
  assert.deepEqual(p.tiktokSettings, { draft: true });
});

test('a draft is not also asked to publish now', () => {
  // publishNow:true alongside draft delivery is contradictory and is what
  // TikTok is refusing in the first place.
  const p = buildZernioPost({ ...BASE, draft: true });
  assert.equal(p.publishNow, false);
});

test('the video and caption survive the fallback', () => {
  // A fallback that drops the media would "succeed" and post nothing.
  const p = buildZernioPost({ ...BASE, draft: true });
  assert.equal(p.mediaItems[0].url, BASE.videoUrl);
  assert.equal(p.content, BASE.caption);
  assert.equal(p.platforms[0].accountId, BASE.accountId);
});

test("Zernio's capacity wording is recognised", () => {
  assert.equal(isTikTokCapacityError(
    'Tiktok: TikTok direct posting is at capacity right now. Use tiktokSettings.draft: true to deliver via Creator Inbox, or try again in a few hours as capacity frees up.',
  ), true);
});

test('an unrelated failure is NOT treated as a capacity error', () => {
  // Retrying an auth or media failure as a draft would hide the real cause.
  assert.equal(isTikTokCapacityError('401 Unauthorized'), false);
  assert.equal(isTikTokCapacityError('video too long'), false);
  assert.equal(isTikTokCapacityError(''), false);
});
