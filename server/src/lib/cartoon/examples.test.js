import { test } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES, PLACEHOLDER } from "./examples.js";
import { normaliseForQuote, unquotedJesusLines } from "./scripture.js";
import { parseCartoonScript } from "./parse.js";
import { planShots, checkFilm } from "./plan.js";
import { styleId } from "./styles.js";

// KJV John 6:9-10, the text the scripture rule is checked against.
const JOHN_6_9_10 = "There is a lad here, which hath five barley loaves, and two small fishes: but what are they among so many? "
  + "And Jesus said, Make the men sit down. Now there was much grass in the place. So the men sat down, in number about five thousand.";

const EXPECTED = {
  "lost-lamb": { verse: "Luke 15:4", style: "family3d" },
  "david-giant": { verse: "1 Samuel 17:45", style: "family3d" },
  jonah: { verse: "Jonah 2:10", style: "clay" },
  "loaves-fishes": { verse: "John 6:9-10", style: "family3d" },
  ruth: { verse: "Ruth 1:16", style: "storybook" },
};

function measure(example) {
  const parsed = parseCartoonScript(example.markdown);
  const shots = planShots(parsed);
  return { parsed, shots, check: checkFilm(shots, parsed.scenes) };
}

function spokenLines(parsed) {
  return parsed.scenes.flatMap((scene) => scene.beats.filter((beat) => beat.kind === "line"));
}

function words(text) {
  return text.trim().split(/\s+/).length;
}

test("the five examples have the agreed ids, verses and styles", () => {
  assert.deepEqual(EXAMPLES.map((e) => e.id), Object.keys(EXPECTED));
  for (const example of EXAMPLES) {
    const { parsed } = measure(example);
    assert.equal(example.verse, EXPECTED[example.id].verse, example.id);
    assert.equal(parsed.verse, example.verse, example.id);
    assert.equal(parsed.title, example.title, example.id);
    assert.equal(styleId(parsed.style), EXPECTED[example.id].style, example.id);
    assert.ok(Object.isFrozen(example), example.id);
  }
  assert.ok(Object.isFrozen(EXAMPLES));
});

test("PLACEHOLDER is the first example's script", () => {
  assert.equal(PLACEHOLDER, EXAMPLES[0].markdown);
});

test("every blurb is one sentence in sentence case", () => {
  for (const example of EXAMPLES) {
    const blurb = example.blurb;
    assert.match(blurb, /^[A-Z][^.!?]*[.!?]$/, example.id);
    const rest = blurb.slice(1).split(/\s+/).filter((word) => /^[A-Z]/.test(word));
    // Only proper names may be capitalised after the first word.
    for (const word of rest) assert.match(word, /^(God|Jesus|Jonah|Ruth|Naomi|Naomi's|David)\b/, `${example.id}: ${word}`);
  }
});

test("every example parses with no ignored lines and fits 40 s", () => {
  for (const example of EXAMPLES) {
    const { parsed, shots, check } = measure(example);
    assert.deepEqual(parsed.ignored, [], example.id);
    assert.deepEqual(parsed.warnings, [], example.id);
    assert.ok(check.ok, `${example.id}: ${check.filmSec} s`);
    assert.ok(check.filmSec <= 38, `${example.id} leaves 2 s headroom: ${check.filmSec} s`);
    assert.ok(!check.tooMany, `${example.id}: ${shots.length} shots`);
    assert.deepEqual(check.tooLong, [], example.id);
  }
});

test("every example has 2-3 cast with a full look, a voice for each speaker, and 4-7 short lines", () => {
  for (const example of EXAMPLES) {
    const { parsed } = measure(example);
    assert.ok(parsed.cast.length >= 2 && parsed.cast.length <= 3, example.id);
    const lines = spokenLines(parsed);
    const speakers = new Set(lines.map((line) => line.speaker));
    for (const member of parsed.cast) {
      assert.ok(member.look.length >= 60, `${example.id}: ${member.name} has a full look`);
      if (speakers.has(member.name)) assert.ok(member.voice.length > 0, `${example.id}: ${member.name} has a voice`);
    }
    assert.ok(lines.length >= 4 && lines.length <= 7, `${example.id}: ${lines.length} lines`);
    for (const line of lines) assert.ok(words(line.text) <= 18, `${example.id}: "${line.text}"`);
    assert.ok(speakers.size >= 2, `${example.id}: at least two people speak`);
    assert.ok(parsed.scenes.length >= 2, `${example.id} changes scene at least once`);
  }
});

test("the fish in Jonah acts but never speaks", () => {
  const { parsed } = measure(EXAMPLES.find((e) => e.id === "jonah"));
  assert.ok(parsed.cast.some((m) => m.name === "Fish"));
  assert.ok(!spokenLines(parsed).some((line) => line.speaker === "Fish"));
});

test("no example names a notable biblical figure as an invented extra", () => {
  for (const example of EXAMPLES) {
    assert.ok(!/\bAbner\b/.test(example.markdown), example.id);
  }
});

test("examples cover at least 9 distinct characters", () => {
  const names = new Set(EXAMPLES.flatMap((example) => measure(example).parsed.cast.map((m) => m.name.toLowerCase())));
  assert.ok(names.size >= 9, `${names.size} characters`);
});

test("Jesus appears only in loaves-fishes", () => {
  for (const example of EXAMPLES) {
    const { parsed } = measure(example);
    const inCast = parsed.cast.some((m) => /^jesus$/i.test(m.name));
    const speaks = spokenLines(parsed).some((line) => /^jesus$/i.test(line.speaker));
    assert.equal(inCast, example.id === "loaves-fishes", example.id);
    assert.equal(speaks, example.id === "loaves-fishes", example.id);
  }
});

test("Jesus speaks only scripture in the examples", () => {
  const example = EXAMPLES.find((e) => e.id === "loaves-fishes");
  const { parsed } = measure(example);
  assert.deepEqual(unquotedJesusLines(parsed, "Make the men sit down. Now there was much grass in the place."), []);
  assert.deepEqual(unquotedJesusLines(parsed, JOHN_6_9_10), []);
  const jesusLines = spokenLines(parsed).filter((line) => line.speaker === "Jesus");
  assert.deepEqual(jesusLines.map((line) => line.text), ["Make the men sit down."]);
});

test("an invented Jesus line is caught", () => {
  const parsed = parseCartoonScript([
    "# Test",
    "Scene: Hillside, wide",
    'Jesus: "Make the men sit down."',
    'JESUS: "Don\'t worry, little one, I will fix it."',
    'Andrew: "This is not scripture."',
    "Scene: Shore, close-up",
    'jesus: "Make the men sit"',
    'Jesus: "make the men sit do"',
  ].join("\n"));
  assert.deepEqual(unquotedJesusLines(parsed, JOHN_6_9_10), [
    { sceneId: "s1", text: "Don't worry, little one, I will fix it." },
    { sceneId: "s2", text: "make the men sit do" },
  ]);
});

test("with no verse text every Jesus line is unquoted", () => {
  const parsed = parseCartoonScript('Scene: Hill\nJesus: "Make the men sit down."');
  assert.deepEqual(unquotedJesusLines(parsed, ""), [{ sceneId: "s1", text: "Make the men sit down." }]);
  assert.deepEqual(unquotedJesusLines(parsed, undefined), [{ sceneId: "s1", text: "Make the men sit down." }]);
  assert.deepEqual(unquotedJesusLines(null, JOHN_6_9_10), []);
});

test("normaliseForQuote lowers case, straightens quotes and drops punctuation", () => {
  assert.equal(normaliseForQuote("  And Jesus said,  Make the MEN sit down.  "), "and jesus said make the men sit down");
  assert.equal(normaliseForQuote("It’s the LORD’s — ‘really’ “so”!"), "it's the lord's really so");
  assert.equal(normaliseForQuote("fishes: but\nwhat are they?"), "fishes but what are they");
  assert.equal(normaliseForQuote("'quoted' don't"), "quoted don't");
  assert.equal(normaliseForQuote(null), "");
  assert.equal(normaliseForQuote("..."), "");
});

test("a curly-quoted, differently punctuated Jesus line still counts as scripture", () => {
  const parsed = parseCartoonScript("Scene: Hill\nJesus: “make the men sit down!”");
  assert.deepEqual(unquotedJesusLines(parsed, JOHN_6_9_10), []);
});
