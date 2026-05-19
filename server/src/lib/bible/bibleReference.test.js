/**
 * Unit tests for bibleReference.js.
 * Run with: node --test server/src/lib/bible/bibleReference.test.js
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeReference,
  resolveBook,
  getChapterVerseCount,
  buildApiBiblePassageId,
  BIBLE_BOOKS,
} from "./bibleReference.js";

describe("BIBLE_BOOKS", () => {
  test("has all 66 canonical books", () => {
    assert.equal(BIBLE_BOOKS.length, 66);
  });

  test("every book has usfm + chapters", () => {
    for (const book of BIBLE_BOOKS) {
      assert.ok(book.name && book.usfm && book.chapters > 0, `bad book: ${JSON.stringify(book)}`);
      assert.match(book.usfm, /^[A-Z0-9]{3}$/, `usfm must be 3 chars: ${book.usfm}`);
    }
  });
});

describe("resolveBook", () => {
  test("matches canonical name (case-insensitive)", () => {
    assert.equal(resolveBook("John")?.name, "John");
    assert.equal(resolveBook("john")?.name, "John");
    assert.equal(resolveBook("JOHN")?.name, "John");
  });

  test("matches abbreviations", () => {
    assert.equal(resolveBook("Jn")?.name, "John");
    assert.equal(resolveBook("Gen")?.name, "Genesis");
    assert.equal(resolveBook("Rev")?.name, "Revelation");
    assert.equal(resolveBook("Ps")?.name, "Psalms");
    assert.equal(resolveBook("Psalm")?.name, "Psalms");
  });

  test("matches numbered books", () => {
    assert.equal(resolveBook("1 Cor")?.name, "1 Corinthians");
    assert.equal(resolveBook("1cor")?.name, "1 Corinthians");
    assert.equal(resolveBook("2 john")?.name, "2 John");
  });

  test("returns null for unknown input", () => {
    assert.equal(resolveBook("Hogwarts"), null);
    assert.equal(resolveBook(""), null);
    assert.equal(resolveBook(null), null);
    assert.equal(resolveBook(undefined), null);
  });
});

describe("normalizeReference", () => {
  test("parses 'John 3:16' to a verse reference", () => {
    const r = normalizeReference("John 3:16");
    assert.equal(r?.canonical, "John 3:16");
    assert.equal(r?.book.name, "John");
    assert.equal(r?.chapter, 3);
    assert.equal(r?.verseFrom, 16);
    assert.equal(r?.verseTo, 16);
  });

  test("parses 'John 3:16-17' to a verse range", () => {
    const r = normalizeReference("John 3:16-17");
    assert.equal(r?.canonical, "John 3:16-17");
    assert.equal(r?.verseFrom, 16);
    assert.equal(r?.verseTo, 17);
  });

  test("parses 'John 3' as whole-chapter (verseFrom null)", () => {
    const r = normalizeReference("John 3");
    assert.equal(r?.canonical, "John 3");
    assert.equal(r?.chapter, 3);
    assert.equal(r?.verseFrom, null);
    assert.equal(r?.verseTo, null);
  });

  test("accepts abbreviations", () => {
    assert.equal(normalizeReference("Jn 3:16")?.canonical, "John 3:16");
    assert.equal(normalizeReference("1 Cor 13:4-7")?.canonical, "1 Corinthians 13:4-7");
    assert.equal(normalizeReference("Ps 23")?.canonical, "Psalms 23");
  });

  test("normalizes en-dash and odd whitespace", () => {
    assert.equal(normalizeReference("John 3 : 16 – 17")?.canonical, "John 3:16-17");
    assert.equal(normalizeReference("  John   3:16  ")?.canonical, "John 3:16");
  });

  test("rejects malformed input", () => {
    assert.equal(normalizeReference(""), null);
    assert.equal(normalizeReference("not a verse"), null);
    assert.equal(normalizeReference("John"), null);
    assert.equal(normalizeReference("John 3:"), null);
  });

  test("rejects out-of-range chapters", () => {
    assert.equal(normalizeReference("John 99"), null);
    assert.equal(normalizeReference("John 0"), null);
  });

  test("rejects out-of-range verses", () => {
    // John 3 has 36 verses.
    assert.equal(normalizeReference("John 3:99"), null);
    assert.equal(normalizeReference("John 3:0"), null);
  });

  test("rejects reversed ranges", () => {
    assert.equal(normalizeReference("John 3:17-16"), null);
  });
});

describe("getChapterVerseCount", () => {
  test("returns known counts", () => {
    assert.equal(getChapterVerseCount("John", 3), 36);
    assert.equal(getChapterVerseCount("Psalms", 119), 176);
    assert.equal(getChapterVerseCount("Genesis", 1), 31);
  });

  test("clamps out-of-range chapter to last available", () => {
    // John has 21 chapters; chapter 99 falls back to last index.
    assert.ok(getChapterVerseCount("John", 99) > 0);
  });

  test("returns sane fallback for unknown book", () => {
    assert.equal(getChapterVerseCount("Hogwarts", 1), 30);
  });
});

describe("buildApiBiblePassageId", () => {
  test("encodes single verse", () => {
    const ref = normalizeReference("John 3:16");
    assert.equal(buildApiBiblePassageId(ref), "JHN.3.16");
  });

  test("encodes verse range", () => {
    const ref = normalizeReference("John 3:16-17");
    assert.equal(buildApiBiblePassageId(ref), "JHN.3.16-JHN.3.17");
  });

  test("encodes whole chapter", () => {
    const ref = normalizeReference("John 3");
    assert.equal(buildApiBiblePassageId(ref), "JHN.3");
  });

  test("encodes numbered book correctly", () => {
    const ref = normalizeReference("1 Corinthians 13:4-7");
    assert.equal(buildApiBiblePassageId(ref), "1CO.13.4-1CO.13.7");
  });
});
