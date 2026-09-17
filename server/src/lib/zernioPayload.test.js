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

test('the normal post publishes immediately and does not ask for a draft', () => {
  const p = buildZernioPost(BASE);
  assert.equal(p.publishNow, true);
  // Sending draft:false is NOT the same as omitting it: `draft` must be absent
  // on the happy path so Zernio direct-posts rather than using Creator Inbox.
  assert.equal('draft' in p.tiktokSettings, false);
});

test('the draft fallback asks for Creator Inbox delivery', () => {
  const p = buildZernioPost({ ...BASE, draft: true });
  assert.equal(p.tiktokSettings.draft, true);
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

// ---------------------------------------------------------------------------
// TikTok's REQUIRED settings (added 2026-09-17).
//
// Zernio's TikTok page lists these as required on every post: privacy_level,
// allow_comment, allow_duet, allow_stitch, and the two legal confirmations
// content_preview_confirmed / express_consent_given ("Required, must be true.
// Legal requirement from TikTok"). The original payload sent none of them.
// ---------------------------------------------------------------------------

test('a direct post carries the settings TikTok requires', () => {
  const s = buildZernioPost(BASE).tiktokSettings;
  assert.equal(s.content_preview_confirmed, true);
  assert.equal(s.express_consent_given, true);
  assert.equal(s.privacy_level, 'PUBLIC_TO_EVERYONE');
  assert.equal(typeof s.allow_comment, 'boolean');
  assert.equal(typeof s.allow_duet, 'boolean');
  assert.equal(typeof s.allow_stitch, 'boolean');
});

test('the draft fallback still asks for Creator Inbox delivery', () => {
  const s = buildZernioPost({ ...BASE, draft: true }).tiktokSettings;
  assert.equal(s.draft, true);
  // The legal confirmations are required on drafts too.
  assert.equal(s.content_preview_confirmed, true);
  assert.equal(s.express_consent_given, true);
});

test('a draft is still not asked to publish now', () => {
  assert.equal(buildZernioPost({ ...BASE, draft: true }).publishNow, false);
});

test('privacy level can be overridden', () => {
  const s = buildZernioPost({ ...BASE, privacyLevel: 'SELF_ONLY' }).tiktokSettings;
  assert.equal(s.privacy_level, 'SELF_ONLY');
});
