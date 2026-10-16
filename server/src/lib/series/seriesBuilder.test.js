/**
 * Unit tests for seriesBuilder.js.
 * Run with: node --test server/src/lib/series/seriesBuilder.test.js
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  endsSentence,
  groupSentences,
  packParts,
  charBudgetFor,
  spokenSeconds,
  buildSegmentCaption,
  buildSeriesPlan,
  SeriesPlanError,
  buildPartScript,
} from "./seriesBuilder.js";

// 1 John 2:1-4 (KJV), exactly as the verse service returns it. Verse 1 ends
// with a colon: its sentence carries on into verse 2.
const FIRST_JOHN_2 = [
  { book: "1 John", chapter: 2, verse: 1, text: "My little children, these things write I unto you, that ye sin not. And if any man sin, we have an advocate with the Father, Jesus Christ the righteous:" },
  { book: "1 John", chapter: 2, verse: 2, text: "And he is the propitiation for our sins: and not for ours only, but also for\nthe sins of the whole world." },
  { book: "1 John", chapter: 2, verse: 3, text: "And hereby we do know that we know him, if we keep his commandments." },
  { book: "1 John", chapter: 2, verse: 4, text: "He that saith, I know him, and keepeth not his commandments, is a liar, and the truth is not in him." },
];

const verseNumbers = (parts) => parts.map((p) => p.map((v) => v.verse));

/** A verse service stub: answers any "Book C:a-b" range with numbered verses. */
function stubFetcher(textFor = (n) => `Verse ${n} text.`, seen = []) {
  return async (range) => {
    seen.push(range);
    const match = range.match(/(\d+)(?:-(\d+))?$/);
    const from = Number(match[1]);
    const to = Number(match[2] || match[1]);
    return Array.from({ length: to - from + 1 }, (_, i) => ({ book: "John", chapter: 3, verse: from + i, text: textFor(from + i) }));
  };
}

describe("endsSentence", () => {
  test("a full stop, question or exclamation ends a sentence", () => {
    assert.equal(endsSentence("Jesus wept."), true);
    assert.equal(endsSentence("Who is he?"), true);
    assert.equal(endsSentence("Praise the Lord!"), true);
  });
  test("a closing quote or bracket after the stop still ends it", () => {
    assert.equal(endsSentence("He said, Follow me.”"), true);
    assert.equal(endsSentence("(for he was rich.)"), true);
    assert.equal(endsSentence("It is finished.'  "), true);
  });
  test("a colon, semicolon, comma or plain word does not", () => {
    assert.equal(endsSentence("Jesus Christ the righteous:"), false);
    assert.equal(endsSentence("and the earth;"), false);
    assert.equal(endsSentence("In the beginning,"), false);
    assert.equal(endsSentence("And God said"), false);
  });
});

describe("groupSentences", () => {
  test("keeps a verse with the next one when its sentence carries on", () => {
    assert.deepEqual(verseNumbers(groupSentences(FIRST_JOHN_2, 1000)), [[1, 2], [3], [4]]);
  });
  test("a passage that never ends a sentence still closes at the length limit", () => {
    const verses = [1, 2, 3, 4].map((n) => ({ verse: n, text: "x".repeat(50) + "," }));
    assert.deepEqual(verseNumbers(groupSentences(verses, 100)), [[1, 2], [3, 4]]);
  });
});

describe("packParts", () => {
  const budget22 = charBudgetFor(22);

  test("auto fits whole sentences into the video length: 1 John 2:1-4 makes two videos", () => {
    assert.deepEqual(verseNumbers(packParts(FIRST_JOHN_2, { versesPerPart: "auto", budgetChars: budget22 })), [[1, 2], [3, 4]]);
  });
  test("one verse per video still never splits a sentence", () => {
    assert.deepEqual(verseNumbers(packParts(FIRST_JOHN_2, { versesPerPart: 1, budgetChars: budget22 })), [[1, 2], [3], [4]]);
  });
  test("two verses per video", () => {
    assert.deepEqual(verseNumbers(packParts(FIRST_JOHN_2, { versesPerPart: 2, budgetChars: budget22 })), [[1, 2], [3, 4]]);
  });
  test("one video holds the whole passage", () => {
    assert.deepEqual(verseNumbers(packParts(FIRST_JOHN_2, { versesPerPart: "one", budgetChars: budget22 })), [[1, 2, 3, 4]]);
  });
  test("every verse lands in exactly one part, in order", () => {
    const verses = Array.from({ length: 23 }, (_, i) => ({ verse: i + 1, text: `${"word ".repeat(5 + (i % 7))}${i % 3 === 0 ? ";" : "."}` }));
    for (const versesPerPart of ["auto", "one", 1, 2, 3]) {
      const flat = packParts(verses, { versesPerPart, budgetChars: 120 }).flat().map((v) => v.verse);
      assert.deepEqual(flat, verses.map((v) => v.verse), `mode ${versesPerPart}`);
    }
  });
  test("no verses, no parts", () => {
    assert.deepEqual(packParts([], { versesPerPart: "auto", budgetChars: 280 }), []);
  });
});

describe("timing", () => {
  test("22 seconds is about 280 characters, the length a short has always spoken", () => {
    assert.equal(charBudgetFor(22), 280);
  });
  test("spoken seconds counts the part intro and the closing line", () => {
    assert.ok(spokenSeconds(280) >= 22 && spokenSeconds(280) <= 26);
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
  test("1 John 2:1-4 on Auto at 22 seconds: two videos, verses 1-2 and 3-4", async () => {
    const plan = await buildSeriesPlan({
      chapterReference: "1 John 2:1-4",
      translation: "kjv",
      fetchVerses: async () => FIRST_JOHN_2,
    });
    assert.equal(plan.totalParts, 2);
    assert.deepEqual(plan.segments.map((s) => s.reference), ["1 John 2:1-2", "1 John 2:3-4"]);
    assert.deepEqual(plan.segments.map((s) => s.verses.length), [2, 2]);
    assert.equal(plan.versesPerPart, "auto");
    assert.equal(plan.targetSeconds, 22);
    for (const seg of plan.segments) assert.ok(seg.seconds > 0 && seg.seconds <= 26, `part ${seg.partNumber} runs ${seg.seconds}s`);
  });

  test("a passage that fits makes one video", async () => {
    const plan = await buildSeriesPlan({
      chapterReference: "1 John 2:3-4",
      translation: "kjv",
      fetchVerses: async () => FIRST_JOHN_2.slice(2),
    });
    assert.equal(plan.totalParts, 1);
    assert.equal(plan.segments[0].reference, "1 John 2:3-4");
  });

  test("fetches the passage once and stays inside the verses asked for", async () => {
    const seen = [];
    const plan = await buildSeriesPlan({
      chapterReference: "John 3:5-12",
      versesPerPart: 2,
      translation: "kjv",
      fetchVerses: stubFetcher(undefined, seen),
    });
    assert.deepEqual(seen, ["John 3:5-12"]);
    assert.equal(plan.chapterReference, "John 3:5-12");
    assert.equal(plan.segments[0].verseFrom, 5);
    assert.equal(plan.segments.at(-1).verseTo, 12);
    assert.equal(plan.totalParts, 4);
  });

  test("a whole chapter that needs more than 12 videos at your length gets 12 slightly longer ones", async () => {
    // 36 verses of ~150 characters: about 20 videos at 22 seconds.
    const plan = await buildSeriesPlan({
      chapterReference: "John 3",
      translation: "kjv",
      durationSec: 22,
      maxRenderSeconds: 180,
      fetchVerses: stubFetcher((n) => `${"and the word ".repeat(11)}verse ${n}.`),
    });
    assert.ok(plan.totalParts <= 12, `made ${plan.totalParts} videos`);
    assert.equal(plan.stretched, true);
    assert.equal(plan.segments[0].verseFrom, 1);
    assert.equal(plan.segments.at(-1).verseTo, 36);
    assert.equal(plan.totalParts, plan.segments.length);
  });

  test("a verses-per-video choice that needs more than 12 videos is refused with a reason", async () => {
    await assert.rejects(
      () => buildSeriesPlan({ chapterReference: "John 3", versesPerPart: 1, translation: "kjv", fetchVerses: stubFetcher() }),
      (err) => err instanceof SeriesPlanError && err.code === "TOO_MANY_PARTS" && /36 videos/.test(err.message) && /12/.test(err.message),
    );
  });

  test("a part is kept a little short of the render limit, so a slow voice is never cut off", async () => {
    // 330 characters is about 29 s with the intro: under 30, but inside the margin.
    await assert.rejects(
      () => buildSeriesPlan({
        chapterReference: "John 3:1",
        translation: "kjv",
        maxRenderSeconds: 30,
        fetchVerses: async () => [{ book: "John", chapter: 3, verse: 1, text: `${"a".repeat(329)}.` }],
      }),
      (err) => err instanceof SeriesPlanError && err.code === "PART_TOO_LONG",
    );
  });

  test("one verse too long for any video says so, rather than asking for fewer verses", async () => {
    await assert.rejects(
      () => buildSeriesPlan({
        chapterReference: "Esther 8:9",
        translation: "kjv",
        maxRenderSeconds: 30,
        fetchVerses: async () => [{ book: "Esther", chapter: 8, verse: 9, text: `${"word ".repeat(100)}.` }],
      }),
      (err) => err instanceof SeriesPlanError && err.code === "PART_TOO_LONG" && /Esther 8:9 alone/.test(err.message) && !/fewer verses/.test(err.message),
    );
  });

  test("a verses-per-video choice keeps a long sentence whole rather than breaking it at the video length", async () => {
    // Four verses, one sentence, ~480 characters: longer than 22 s, inside the render limit.
    const verses = [1, 2, 3, 4].map((n) => ({ book: "John", chapter: 3, verse: n, text: `${"blessed be the Lord ".repeat(6)}${n === 4 ? "." : ","}` }));
    const plan = await buildSeriesPlan({ chapterReference: "John 3:1-4", versesPerPart: 1, translation: "kjv", maxRenderSeconds: 180, fetchVerses: async () => verses });
    assert.equal(plan.totalParts, 1);
    assert.equal(plan.segments[0].reference, "John 3:1-4");
  });

  test("Auto keeps a long sentence whole too, when a video can hold it", async () => {
    const verses = [1, 2, 3, 4].map((n) => ({ book: "John", chapter: 3, verse: n, text: `${"blessed be the Lord ".repeat(6)}${n === 4 ? "." : ","}` }));
    const plan = await buildSeriesPlan({ chapterReference: "John 3:1-4", translation: "kjv", maxRenderSeconds: 180, fetchVerses: async () => verses });
    assert.equal(plan.totalParts, 1);
  });

  test("Auto aims no longer than the server can render, splitting rather than refusing", async () => {
    // 60 s asked for on a 30 s server: about 760 characters per part would fail.
    const plan = await buildSeriesPlan({
      chapterReference: "John 3:1-8",
      translation: "kjv",
      durationSec: 60,
      maxRenderSeconds: 30,
      fetchVerses: stubFetcher((n) => `${"and the word ".repeat(7)}verse ${n}.`),
    });
    assert.ok(plan.totalParts > 1);
    for (const seg of plan.segments) assert.ok(seg.seconds <= 27, `part ${seg.partNumber} runs ${seg.seconds}s`);
  });

  test("verses the service returns outside the range asked for are left out", async () => {
    const plan = await buildSeriesPlan({
      chapterReference: "John 3:2-3",
      translation: "kjv",
      fetchVerses: async () => [1, 2, 3, 4].map((n) => ({ book: "John", chapter: 3, verse: n, text: `Verse ${n}.` })),
    });
    assert.equal(plan.segments[0].reference, "John 3:2-3");
    assert.deepEqual(plan.segments.flatMap((s) => s.verses.map((v) => v.verse)), [2, 3]);
  });

  test("one video longer than a render allows is refused with a reason", async () => {
    await assert.rejects(
      () => buildSeriesPlan({
        chapterReference: "John 3",
        versesPerPart: "one",
        translation: "kjv",
        maxRenderSeconds: 30,
        fetchVerses: stubFetcher((n) => `${"and the word ".repeat(11)}verse ${n}.`),
      }),
      (err) => err instanceof SeriesPlanError && err.code === "PART_TOO_LONG" && /30 s/.test(err.message),
    );
  });

  test("totalParts always equals the number of segments and part numbers run from 1", async () => {
    const plan = await buildSeriesPlan({ chapterReference: "John 3:1-9", versesPerPart: 3, translation: "kjv", fetchVerses: stubFetcher() });
    assert.equal(plan.totalParts, plan.segments.length);
    assert.deepEqual(plan.segments.map((s) => s.partNumber), [1, 2, 3]);
    for (const seg of plan.segments) assert.equal(seg.totalParts, 3);
  });

  test("a single verse is a one-part series", async () => {
    const plan = await buildSeriesPlan({
      chapterReference: "John 3:16",
      translation: "kjv",
      fetchVerses: async () => [{ book: "John", chapter: 3, verse: 16, text: "For God so loved the world." }],
    });
    assert.equal(plan.totalParts, 1);
    assert.equal(plan.segments[0].reference, "John 3:16");
    assert.equal(plan.chapterReference, "John 3:16");
  });

  test("rejects unparseable references", async () => {
    await assert.rejects(
      () => buildSeriesPlan({ chapterReference: "Hogwarts 1", translation: "kjv", fetchVerses: async () => [] }),
      /Could not parse/i,
    );
  });

  test("each segment has a YouVersion URL for its own verses", async () => {
    const plan = await buildSeriesPlan({ chapterReference: "John 3:1-6", versesPerPart: 3, translation: "niv", fetchVerses: stubFetcher() });
    assert.match(plan.segments[0].youVersionUrl, /bible\.com\/bible\/111\/JHN\.3\.1-3\.NIV$/);
    assert.match(plan.segments[1].youVersionUrl, /JHN\.3\.4-6\.NIV$/);
  });

  test("produces unique seriesId", async () => {
    const fetchVerses = async () => [{ book: "Jude", chapter: 1, verse: 1, text: "t." }];
    const a = await buildSeriesPlan({ chapterReference: "Jude 1:1", translation: "kjv", fetchVerses });
    const b = await buildSeriesPlan({ chapterReference: "Jude 1:1", translation: "kjv", fetchVerses });
    assert.notEqual(a.seriesId, b.seriesId);
  });
});

describe("buildPartScript", () => {
  const segment = { partNumber: 1, totalParts: 2, reference: "1 John 2:1-2", verses: FIRST_JOHN_2.slice(0, 2) };

  test("opens with the part and reference, then reads every verse", () => {
    const script = buildPartScript(segment, 2000);
    assert.equal(script.hook, "Part 1 of 2 — 1 John 2:1-2");
    assert.match(script.verse, /^My little children/);
    assert.match(script.verse, /the sins of the whole world.$/);
  });

  test("says nothing after the verses: the YouVersion link belongs in the post caption, not the video", () => {
    const script = buildPartScript(segment, 2000);
    assert.equal(script.cta, "");
    assert.equal(script.reflection, "");
    assert.doesNotMatch(JSON.stringify(script), /YouVersion/);
  });
});
