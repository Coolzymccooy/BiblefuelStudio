import test from 'node:test';
import assert from 'node:assert/strict';
import { readTikTokOutcome } from './zernioStatus.js';

// WHY THIS FILE EXISTS
//
// The draft fallback shipped on 1 Sep and the very next post still failed.
// The fallback was gated on `!resp.ok`, but Zernio does not reject a
// capacity-blocked post at the HTTP layer. Its TikTok page says so outright:
//
//   "A publishNow: true post that TikTok rejects returns 207 with
//    post.status: 'failed' ... 207 is a 2xx status, so fetch(...).ok is true;
//    branch on the status code and on post.status."
//
// So every capacity failure since then returned ok:true to the caller: the job
// was marked DONE, the UI showed "Auto-Publish posted", and nothing reached
// TikTok. These tests pin the response shapes Zernio actually documents.

/** The real 207 body from the TikTok platform page. */
const CAPACITY_207 = {
  message: 'Post created but publishing failed',
  error: 'All platforms failed',
  post: {
    _id: '65f1c0a9e2b5af0012ab34cd',
    status: 'failed',
    platforms: [
      {
        platform: 'tiktok',
        status: 'failed',
        errorMessage:
          'TikTok direct posting is at capacity right now. Use tiktokSettings.draft: true to deliver via Creator Inbox, or try again in a few hours as capacity frees up.',
      },
    ],
  },
};

test('a 207 capacity failure is NOT treated as success', () => {
  // THE BUG: resp.ok is true on a 207, so the old code returned ok:true here.
  const out = readTikTokOutcome(207, CAPACITY_207);
  assert.equal(out.ok, false);
  assert.equal(out.atCapacity, true);
});

test('a 207 capacity failure names the remedy in its error', () => {
  const out = readTikTokOutcome(207, CAPACITY_207);
  assert.match(out.error, /at capacity/i);
});

test('a real 201 publish is success', () => {
  const out = readTikTokOutcome(201, {
    post: {
      _id: 'abc',
      status: 'published',
      platforms: [{ platform: 'tiktok', status: 'published', platformPostUrl: null }],
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.atCapacity, false);
});

test('a queued post is success — it has not failed', () => {
  // publishNow posts come back "published"; scheduled ones "scheduled". Neither
  // is a failure, and treating "scheduled" as one would break scheduled posts.
  const out = readTikTokOutcome(201, {
    post: { _id: 'abc', status: 'scheduled', platforms: [{ platform: 'tiktok', status: 'pending' }] },
  });
  assert.equal(out.ok, true);
});

test('an accepted draft is success', () => {
  // Zernio marks the entry published the moment TikTok accepts the upload.
  const out = readTikTokOutcome(201, {
    post: {
      _id: 'abc',
      status: 'published',
      platforms: [
        { platform: 'tiktok', status: 'published', platformSpecificData: { isDraft: true } },
      ],
    },
  });
  assert.equal(out.ok, true);
});

test('a non-capacity platform failure is a failure, but not a capacity one', () => {
  // Retrying THIS as a draft would hide the real cause, so atCapacity must be
  // false: a bad media URL fails the same way as a draft.
  const out = readTikTokOutcome(207, {
    post: {
      status: 'failed',
      platforms: [
        {
          platform: 'tiktok',
          status: 'failed',
          errorMessage: 'TikTok video upload failed: Your video URL returned an error (download failed)',
        },
      ],
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.atCapacity, false);
  assert.match(out.error, /download failed/);
});

test('a hard HTTP error is a failure', () => {
  const out = readTikTokOutcome(401, { error: 'Unauthorized' });
  assert.equal(out.ok, false);
  assert.equal(out.atCapacity, false);
});

test('a 409 duplicate is a failure and is NOT retried as a draft', () => {
  // Zernio 409s when the same content was posted in the last 24h. Sending it
  // again as a draft would just duplicate it into the Creator Inbox.
  const out = readTikTokOutcome(409, {
    error: 'This exact content is already scheduled, publishing, or was posted to this account within the last 24 hours.',
  });
  assert.equal(out.ok, false);
  assert.equal(out.atCapacity, false);
});

test('a "partial" post with a failed tiktok entry is a failure', () => {
  // status:"partial" means some platform rejected it. We only post to TikTok,
  // so a failed tiktok entry must not read as success.
  const out = readTikTokOutcome(207, {
    post: {
      status: 'partial',
      platforms: [
        {
          platform: 'tiktok',
          status: 'failed',
          errorMessage: 'TikTok direct posting is at capacity right now.',
        },
      ],
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.atCapacity, true);
});

test('capacity is detected from the top-level error too', () => {
  // Defensive: if Zernio ever reports it outside platforms[].errorMessage we
  // must still fall back rather than silently lose the video.
  const out = readTikTokOutcome(207, {
    error: 'TikTok direct posting is at capacity right now.',
    post: { status: 'failed', platforms: [] },
  });
  assert.equal(out.ok, false);
  assert.equal(out.atCapacity, true);
});

test('an unparseable body on a 2xx is not blindly trusted', () => {
  // If we cannot read the body we must not claim the post published.
  const out = readTikTokOutcome(200, null);
  assert.equal(out.ok, false);
});

test('a "partial" post whose tiktok entry PUBLISHED is success', () => {
  // status:"partial" means SOME platform failed. If the TikTok entry itself
  // published, the video is live and reporting failure would be a false
  // negative. The per-platform entry is the authority when it exists.
  const out = readTikTokOutcome(207, {
    post: {
      status: 'partial',
      platforms: [
        { platform: 'instagram', status: 'failed', errorMessage: 'ig broke' },
        { platform: 'tiktok', status: 'published' },
      ],
    },
  });
  assert.equal(out.ok, true);
});
