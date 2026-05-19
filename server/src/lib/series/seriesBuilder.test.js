/**
 * Unit tests for seriesBuilder.js.
 * Run with: node --test server/src/lib/series/seriesBuilder.test.js
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  clampPartsCount,
  planVerseRanges,
  buildSegmentCaption,
  buildSeriesPlan,
} from "./seriesBuilder.js";

describe("clampPartsCount", () => {
  test("respects floor (2)", () => {
    assert.equal(clampPartsCount(1, 30), 2);
    assert.equal(clampPartsCount(0, 30), 2);
    assert.equal(clampPartsCount(null, 30), 5); // default
  });

  test("respects ceiling (12)", () => {
    assert.equal(clampPartsCount(20, 30), 12);
    assert.equal(clampPartsCount(100, 30), 12);
  });

  test("cannot exceed verse count", () => {
    assert.equal(clampPartsCount(10, 3), 3);
    assert.equal(clampPartsCount(5, 4), 4);
  });
});

describe("planVerseRanges", () => {
  test("evenly splits when divisible", () => {
    const ranges = planVerseRanges(30, 3);
    assert.deepEqual(ranges, [
      { from: 1, to: 10 },
      { from: 11, to: 20 },
      { from: 21, to: 30 },
    ]);
  });

  test("distributes remainder to earlier parts", () => {
    const ranges = planVerseRanges(11, 3);
    assert.deepEqual(ranges, [
      { from: 1, to: 4 },
      { from: 5, to: 8 },
      { from: 9, to: 11 },
    ]);
    // 4 + 4 + 3 = 11
  });

  test("exhausts all verses (no orphan)", () => {
    for (const verses of [13, 23, 36, 50, 89, 176]) {
      for (const parts of [2, 3, 5, 7, 12]) {
        const ranges = planVerseRanges(verses, parts);
        assert.equal(ranges[0].from, 1);
        assert.equal(ranges[ranges.length - 1].to, verses);
        assert.equal(ranges.length, Math.min(parts, verses));
      }
    }
  });

  test("handles parts >= verses", () => {
    const ranges = planVerseRanges(3, 5);
    // Cannot make more parts than verses — clamps to 3 parts of 1 verse each.
    assert.equal(ranges.length, 3);
    assert.deepEqual(ranges, [
      { from: 1, to: 1 },
      { from: 2, to: 2 },
      { from: 3, to: 3 },
    ]);
  });
});

describe("buildSegmentCaption", () => {
  const baseArgs = {
    partNumber: 1,
    totalParts: 5,
    reference: "John 3:1-7",
    verses: [
      { book: "John", chapter: 3, verse: 1, text: "There was a man of the Pharisees named Nicodemus." },
      { book: "John", chapter: 3, verse: 2, text: "He came to Jesus by night." },
    ],
    hook: "There was a man of the Pharisees",
    youVersionUrl: "https://www.bible.com/bible/1/JHN.3.1-7.KJV",
    isLast: false,
  };

  test("includes part-of-series header", () => {
    const caption = buildSegmentCaption(baseArgs);
    assert.match(caption, /Part 1 of 5/);
  });

  test("includes verse text body", () => {
    const caption = buildSegmentCaption(baseArgs);
    assert.match(caption, /Nicodemus/);
    assert.match(caption, /by night/);
  });

  test("includes reference and YouVersion link", () => {
    const caption = buildSegmentCaption(baseArgs);
    assert.match(caption, /John 3:1-7/);
    assert.match(caption, /bible\.com\/bible\/1\/JHN/);
  });

  test("uses cliffhanger for non-last segments", () => {
    const caption = buildSegmentCaption(baseArgs);
    assert.match(caption, /Part 2 drops next/);
  });

  test("uses closing line for last segment", () => {
    const caption = buildSegmentCaption({ ...baseArgs, partNumber: 5, isLast: true });
    assert.doesNotMatch(caption, /drops next/);
    assert.match(caption, /end of the series/i);
  });

  test("stays under caption length limit when verse text is huge", () => {
    const longVerse = "Lorem ipsum dolor sit amet ".repeat(500);
    const caption = buildSegmentCaption({
      ...baseArgs,
      verses: [{ book: "John", chapter: 3, verse: 1, text: longVerse }],
    });
    assert.ok(caption.length <= 2000, `caption length was ${caption.length}`);
    assert.match(caption, /Part 1 of 5/);
    assert.match(caption, /bible\.com/);
  });
});

describe("buildSeriesPlan", () => {
  const stubVerse = (n, text) => ({ book: "John", chapter: 3, verse: n, text });

  test("returns one segment per requested part", async () => {
    const fetchVerses = async (range) => {
      const match = range.match(/(\d+)(?:-(\d+))?$/);
      const from = Number(match[1]);
      const to = Number(match[2] || match[1]);
      return Array.from({ length: to - from + 1 }, (_, i) => stubVerse(from + i, `Verse ${from + i} text.`));
    };
    const plan = await buildSeriesPlan({
      chapterReference: "John 3",
      parts: 4,
      translation: "kjv",
      fetchVerses,
    });
    assert.equal(plan.book, "John");
    assert.equal(plan.chapter, 3);
    assert.equal(plan.totalParts, 4);
    assert.equal(plan.segments.length, 4);
    // Part numbers are sequential starting at 1.
    assert.deepEqual(plan.segments.map((s) => s.partNumber), [1, 2, 3, 4]);
    // Verse ranges exhaust the chapter (John 3 = 36 verses).
    assert.equal(plan.segments[0].verseFrom, 1);
    assert.equal(plan.segments[plan.segments.length - 1].verseTo, 36);
  });

  test("rejects single-verse references", async () => {
    const fetchVerses = async () => [stubVerse(16, "anything")];
    await assert.rejects(
      () => buildSeriesPlan({ chapterReference: "John 3:16", parts: 4, translation: "kjv", fetchVerses }),
      /requires a chapter reference/i,
    );
  });

  test("rejects unparseable references", async () => {
    const fetchVerses = async () => [];
    await assert.rejects(
      () => buildSeriesPlan({ chapterReference: "Hogwarts 1", parts: 4, translation: "kjv", fetchVerses }),
      /Could not parse/i,
    );
  });

  test("each segment has a YouVersion URL", async () => {
    const fetchVerses = async (range) => {
      const match = range.match(/(\d+)(?:-(\d+))?$/);
      const from = Number(match[1]);
      const to = Number(match[2] || match[1]);
      return Array.from({ length: to - from + 1 }, (_, i) => stubVerse(from + i, `text ${from + i}`));
    };
    const plan = await buildSeriesPlan({
      chapterReference: "John 3",
      parts: 3,
      translation: "niv",
      fetchVerses,
    });
    for (const seg of plan.segments) {
      assert.match(seg.youVersionUrl, /bible\.com\/bible\/111\/JHN/);
      assert.match(seg.youVersionUrl, /\.NIV$/);
    }
  });

  test("produces unique seriesId", async () => {
    const fetchVerses = async () => [stubVerse(1, "t")];
    const a = await buildSeriesPlan({ chapterReference: "Jude 1", parts: 2, translation: "kjv", fetchVerses });
    const b = await buildSeriesPlan({ chapterReference: "Jude 1", parts: 2, translation: "kjv", fetchVerses });
    assert.notEqual(a.seriesId, b.seriesId);
  });
});
