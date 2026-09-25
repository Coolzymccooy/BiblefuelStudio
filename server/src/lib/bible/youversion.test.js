/**
 * Unit tests for youversion.js.
 * Run with: node --test server/src/lib/bible/youversion.test.js
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeReference } from "./bibleReference.js";
import {
  buildYouVersionUrl,
  resolveYouVersionTranslation,
  listYouVersionTranslations,
  YOUVERSION_TRANSLATIONS,
} from "./youversion.js";

describe("resolveYouVersionTranslation", () => {
  test("returns known translation for valid key", () => {
    assert.equal(resolveYouVersionTranslation("niv").code, "NIV");
    assert.equal(resolveYouVersionTranslation("kjv").code, "KJV");
    assert.equal(resolveYouVersionTranslation("ESV").code, "ESV"); // case-insensitive
  });

  test("falls back to KJV for unknown key", () => {
    assert.equal(resolveYouVersionTranslation("zzz").code, "KJV");
    assert.equal(resolveYouVersionTranslation("").code, "KJV");
    assert.equal(resolveYouVersionTranslation(null).code, "KJV");
    assert.equal(resolveYouVersionTranslation(undefined).code, "KJV");
  });
});

describe("buildYouVersionUrl", () => {
  test("builds verse URL with translation suffix", () => {
    const ref = normalizeReference("John 3:16");
    const url = buildYouVersionUrl(ref, "niv");
    assert.equal(url, "https://www.bible.com/bible/111/JHN.3.16.NIV");
  });

  test("builds verse-range URL", () => {
    const ref = normalizeReference("John 3:16-17");
    const url = buildYouVersionUrl(ref, "kjv");
    assert.equal(url, "https://www.bible.com/bible/1/JHN.3.16-17.KJV");
  });

  test("builds whole-chapter URL", () => {
    const ref = normalizeReference("John 3");
    const url = buildYouVersionUrl(ref, "niv");
    assert.equal(url, "https://www.bible.com/bible/111/JHN.3.NIV");
  });

  test("handles numbered book correctly", () => {
    const ref = normalizeReference("1 Corinthians 13:4-7");
    const url = buildYouVersionUrl(ref, "esv");
    assert.equal(url, "https://www.bible.com/bible/59/1CO.13.4-7.ESV");
  });

  test("defaults to KJV when translation is unknown", () => {
    const ref = normalizeReference("John 3:16");
    const url = buildYouVersionUrl(ref, "zzz");
    assert.match(url, /\.KJV$/);
  });

  test("returns empty string for null reference", () => {
    assert.equal(buildYouVersionUrl(null, "niv"), "");
  });
});

describe("listYouVersionTranslations", () => {
  test("returns all known translations", () => {
    const list = listYouVersionTranslations();
    assert.equal(list.length, Object.keys(YOUVERSION_TRANSLATIONS).length);
    for (const entry of list) {
      assert.ok(entry.key && entry.code && entry.label);
    }
  });
});
