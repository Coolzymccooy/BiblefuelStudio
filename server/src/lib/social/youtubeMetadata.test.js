import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateYoutubeMetadata, buildYoutubeDescription, formatChapterTimestamp } from "./youtubeMetadata.js";

describe("formatChapterTimestamp", () => {
  test("formats under an hour as MM:SS", () => {
    assert.equal(formatChapterTimestamp(0), "00:00");
    assert.equal(formatChapterTimestamp(65_000), "01:05");
  });
  test("formats an hour or more as H:MM:SS", () => {
    assert.equal(formatChapterTimestamp(3_725_000), "1:02:05");
  });
});

describe("buildYoutubeDescription", () => {
  test("emits chapters only when there are at least three, starting at 00:00", () => {
    const out = buildYoutubeDescription({
      summary: "A calm hour of Psalms.",
      chapters: [{ startMs: 0, title: "Welcome" }, { startMs: 90_000, title: "Psalm 23" }, { startMs: 600_000, title: "Psalm 91" }],
      links: ["https://biblefuel.tiwaton.co.uk"],
      hashtags: ["sleep", "psalms"],
    });
    assert.match(out, /^A calm hour of Psalms\./);
    assert.match(out, /\n00:00 Welcome\n01:30 Psalm 23\n10:00 Psalm 91/);
    assert.match(out, /https:\/\/biblefuel\.tiwaton\.co\.uk/);
    assert.match(out, /#sleep #psalms/);
  });
  test("drops the chapter block when fewer than three chapters", () => {
    const out = buildYoutubeDescription({ summary: "x", chapters: [{ startMs: 0, title: "Only" }], links: [], hashtags: [] });
    assert.doesNotMatch(out, /00:00/);
  });
  test("forces the first chapter to 00:00 when the first section starts late", () => {
    const out = buildYoutubeDescription({
      summary: "x",
      chapters: [{ startMs: 1_200, title: "A" }, { startMs: 60_000, title: "B" }, { startMs: 120_000, title: "C" }],
      links: [], hashtags: [],
    });
    assert.match(out, /00:00 A/);
  });
  test("never exceeds 5000 characters", () => {
    const out = buildYoutubeDescription({ summary: "y".repeat(6000), chapters: [], links: [], hashtags: [] });
    assert.ok(out.length <= 5000);
  });
});

describe("validateYoutubeMetadata", () => {
  const now = Date.parse("2026-09-21T10:00:00Z");
  test("accepts a minimal payload and applies defaults", () => {
    const r = validateYoutubeMetadata({ title: "Psalms for sleep" }, { now });
    assert.equal(r.ok, true);
    assert.equal(r.value.categoryId, "22");
    assert.equal(r.value.privacyStatus, "private");
    assert.deepEqual(r.value.tags, []);
    assert.equal(r.value.forcedPrivate, false);
  });
  test("rejects a title over 100 characters by name", () => {
    const r = validateYoutubeMetadata({ title: "t".repeat(101) }, { now });
    assert.equal(r.ok, false);
    assert.match(r.error, /title.*100/i);
  });
  test("rejects an empty title", () => {
    const r = validateYoutubeMetadata({ title: "   " }, { now });
    assert.equal(r.ok, false);
    assert.match(r.error, /title/i);
  });
  test("rejects tags over 500 characters total", () => {
    const r = validateYoutubeMetadata({ title: "ok", tags: Array.from({ length: 30 }, (_, i) => "tag".repeat(6) + i) }, { now });
    assert.equal(r.ok, false);
    assert.match(r.error, /tags.*500/i);
  });
  test("publishAt in the past is rejected", () => {
    const r = validateYoutubeMetadata({ title: "ok", publishAt: "2026-09-20T10:00:00Z" }, { now });
    assert.equal(r.ok, false);
    assert.match(r.error, /publishAt.*future/i);
  });
  test("publishAt in the future forces private and flags it", () => {
    const r = validateYoutubeMetadata({ title: "ok", publishAt: "2026-09-22T10:00:00Z", privacyStatus: "public" }, { now });
    assert.equal(r.ok, true);
    assert.equal(r.value.privacyStatus, "private");
    assert.equal(r.value.forcedPrivate, true);
    assert.equal(r.value.publishAt, "2026-09-22T10:00:00.000Z");
  });
  test("unknown privacy falls back to private", () => {
    const r = validateYoutubeMetadata({ title: "ok", privacyStatus: "friends" }, { now });
    assert.equal(r.value.privacyStatus, "private");
  });
});
