// server/src/lib/lyricVideo/sheetParser.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSheet, sectionKind, splitLongLine, needsSoftFont } from "./sheetParser.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "my-time-no-late");
const sheet = fs.readFileSync(path.join(FIX, "sheet.txt"), "utf8");

describe("sectionKind", () => {
  test("maps headings to kinds", () => {
    assert.equal(sectionKind("INTRO"), "intro");
    assert.equal(sectionKind("VERSE 2"), "verse");
    assert.equal(sectionKind("PRE-CHORUS"), "pre");
    assert.equal(sectionKind("CHORUS"), "chorus");
    assert.equal(sectionKind("Hook"), "chorus");
    assert.equal(sectionKind("FINAL CHORUS"), "final");
    assert.equal(sectionKind("BRIDGE"), "bridge");
    assert.equal(sectionKind("OUTRO"), "outro");
    assert.equal(sectionKind("Spoken word"), "other");
  });
});

describe("parseSheet on the reference sheet", () => {
  const out = parseSheet(sheet);
  test("finds the eight sections in order", () => {
    assert.deepEqual(out.sections.map((s) => s.kind), ["intro", "verse", "pre", "chorus", "verse", "bridge", "final", "outro"]);
    assert.equal(out.sections[3].label, "CHORUS");
  });
  test("skips the preamble and the stage notes", () => {
    assert.ok(out.skipped.some((s) => s.startsWith("Here is the kinetic")));
    assert.ok(out.skipped.includes("(Talking drum, soft guitar, male vocal)"));
    assert.ok(out.skipped.includes("(Female harmonies enter)"));
    assert.ok(out.skipped.includes("(Instrumental groove with crowd chants)"));
    assert.ok(!out.lines.some((l) => /Talking drum/.test(l.text)));
  });
  test("strips emoji and keeps Yoruba marks exactly", () => {
    assert.ok(out.lines.every((l) => !/[🎵💬🔥✨💃🎉]/u.test(l.text)));
    assert.ok(out.lines.some((l) => l.text.includes("Ọmọ mi")));
    assert.ok(out.lines.some((l) => l.text.normalize("NFC").includes("Oluwa, mo dúpẹ́")));
  });
  test("chorus responses become response lines after their call", () => {
    const chorus = out.sections.find((s) => s.kind === "chorus");
    const inChorus = out.lines.filter((l) => l.sectionId === chorus.id);
    assert.equal(inChorus[0].text, "Who talk say I no go shine?");
    assert.deepEqual([inChorus[1].kind, inChorus[1].text], ["response", "(WHO TALK SAY?!)"]);
  });
  test("an inline response is split off its call", () => {
    const final = out.sections.find((s) => s.kind === "final");
    const fl = out.lines.filter((l) => l.sectionId === final.id);
    assert.deepEqual(fl.slice(0, 4).map((l) => [l.kind, l.text]), [
      ["lead", "WHO TALK SAY?!"], ["response", "(WHO TALK SAY?!)"],
      ["lead", "MY TIME NO LATE!"], ["response", "(NO DEY LATE!)"],
    ]);
  });
  test("bridge lines and lines with ẹ/ọ are soft", () => {
    const bridge = out.sections.find((s) => s.kind === "bridge");
    assert.ok(out.lines.filter((l) => l.sectionId === bridge.id).every((l) => l.kind === "soft"));
    assert.equal(out.lines.find((l) => l.text.includes("Ọmọ")).kind, "soft");
  });
  test("long lines split at the comma nearest the middle", () => {
    assert.ok(out.lines.some((l) => l.text === "Abeg, no tell me make I keep quiet!"));
    assert.ok(out.lines.some((l) => l.text === "Some dey buy house," ) && out.lines.some((l) => l.text === "some dey buy car,"));
  });
});

describe("parseSheet edge cases", () => {
  test("no headings: one 'other' section with every line", () => {
    const out = parseSheet("Line one here\nLine two here\n\nLine three");
    assert.equal(out.sections.length, 1);
    assert.equal(out.sections[0].kind, "other");
    assert.deepEqual(out.lines.map((l) => l.text), ["Line one here", "Line two here", "Line three"]);
  });
  test("verse heading with a colon", () => {
    const out = parseSheet("VERSE 1:\nHello there\nCHORUS:\nSing it");
    assert.deepEqual(out.sections.map((s) => s.kind), ["verse", "chorus"]);
  });
  test("a bracketed note between sung lines in a verse is skipped, not a response", () => {
    const out = parseSheet("[VERSE 1]\nFirst sung line\n(Female harmonies enter)\nSecond sung line");
    assert.deepEqual(out.lines.map((l) => [l.kind, l.text]), [["lead", "First sung line"], ["lead", "Second sung line"]]);
    assert.ok(out.skipped.includes("(Female harmonies enter)"));
  });
  test("the same bracketed line in a chorus is a response", () => {
    const out = parseSheet("[CHORUS]\nWho talk say\n(WHO TALK SAY?!)\nSecond sung line");
    assert.deepEqual(out.lines.map((l) => l.kind), ["lead", "response", "lead"]);
    assert.deepEqual(out.skipped, []);
  });
  test("a bracketed line in a final chorus is a response", () => {
    const out = parseSheet("[FINAL CHORUS]\nMy time no late\n(NO DEY LATE!)");
    assert.deepEqual(out.lines.map((l) => l.kind), ["lead", "response"]);
  });
  test("a bracketed line with no heading, after a sung line, is a response", () => {
    const out = parseSheet("Who talk say\n(WHO TALK SAY?!)");
    assert.deepEqual(out.lines.map((l) => l.kind), ["lead", "response"]);
  });
  test("emoji-prefixed headings are still headings", () => {
    const out = parseSheet("🎤 [CHORUS]\nSing it\n🔥 **FINAL CHORUS**\nLoud now\n🎵 VERSE 1:\nSoft start");
    assert.deepEqual(out.sections.map((s) => s.kind), ["chorus", "final", "verse"]);
    assert.deepEqual(out.lines.map((l) => l.text), ["Sing it", "Loud now", "Soft start"]);
  });
  test("empty input gives no lines", () => {
    assert.deepEqual(parseSheet("   \n  ").lines, []);
  });
});

describe("splitLongLine", () => {
  test("keeps short lines", () => {
    assert.deepEqual(splitLongLine("My time no late"), ["My time no late"]);
  });
  test("splits at the comma nearest the middle", () => {
    assert.deepEqual(splitLongLine("Me I still dey hustle, but I know who I are."), ["Me I still dey hustle,", "but I know who I are."]);
  });
  test("never leaves a one-word orphan", () => {
    assert.deepEqual(splitLongLine("Abeg, no tell me make I keep quiet!"), ["Abeg, no tell me make I keep quiet!"]);
  });
  test("a long line without punctuation stays whole", () => {
    assert.deepEqual(splitLongLine("Pocket nearly empty but my dreams dey there."), ["Pocket nearly empty but my dreams dey there."]);
  });
});

describe("needsSoftFont", () => {
  test("detects Yoruba under-dots and combining marks", () => {
    assert.equal(needsSoftFont("Ọmọ mi"), true);
    assert.equal(needsSoftFont("mo dúpẹ́"), true);
    assert.equal(needsSoftFont("believe again"), false);
  });
});
