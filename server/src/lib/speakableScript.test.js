import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanSpeakableText,
  cleanCaptionLine,
  buildSpeakableLines,
} from "./speakableScript.js";

const RAW_SCRIPT = `"God gives the strongest battles to the strongest soldiers."

If you're carrying a burden that feels too heavy, don't assume God has forgotten you. Sometimes, the greatest battles become the greatest testimonies.

*"So God created mankind in His own image, in the image of God He created them."* — Genesis 1:27

#Faith #ChristianEncouragement`;

test("cleanSpeakableText strips markdown, quotes, and hashtag-only lines for TTS", () => {
  const cleaned = cleanSpeakableText(RAW_SCRIPT);

  assert.equal(cleaned.includes("*"), false);
  assert.equal(cleaned.includes("#Faith"), false);
  assert.equal(cleaned.includes("#ChristianEncouragement"), false);
  assert.equal(cleaned.includes('"God gives'), false);
  assert.match(cleaned, /^God gives the strongest battles/);
  assert.match(cleaned, /Genesis 1:27$/);
});

test("cleanCaptionLine removes social and markdown syntax from video overlay lines", () => {
  assert.equal(cleanCaptionLine('*"I can do all things"* — Philippians 4:13'), "I can do all things — Philippians 4:13");
  assert.equal(cleanCaptionLine('#Faith #Hope'), "");
  assert.equal(cleanCaptionLine('- Stand firm. Keep praying.'), "Stand firm. Keep praying.");
});

test("buildSpeakableLines converts a pasted long script into bounded clean caption lines", () => {
  const lines = buildSpeakableLines(RAW_SCRIPT, { maxLines: 6, maxChars: 72 });

  assert.ok(lines.length > 1);
  assert.ok(lines.length <= 6);
  assert.equal(lines.some((line) => /[#*]/.test(line)), false);
  assert.equal(lines.some((line) => /Faith/.test(line)), false);
  assert.ok(lines[0].startsWith("God gives"));
});
