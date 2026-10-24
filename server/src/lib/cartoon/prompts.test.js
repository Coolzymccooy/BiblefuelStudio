import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLES } from "./styles.js";
import { NO_TEXT_LINE } from "../videoGen/providers/seedance.js";
import { portraitPrompt, clipPrompt, referencedCast } from "./prompts.js";

function member(name, look, extra = {}) {
  return { name, look, voice: "", portrait: `${name}.png`, approved: true, shelfId: null, ...extra };
}

function project(overrides = {}) {
  return {
    meta: { title: "Lost lamb", style: "family3d", aspect: "portrait" },
    cast: {
      Eli: member("Eli", "a young shepherd girl with braids and a blue headscarf", { voice: "a bright young voice" }),
      Pip: member("Pip", "a small white lamb with a bell"),
      Ruth: member("Ruth", "an old woman in a green shawl"),
    },
    scenes: [{ id: "s1", place: "a sunny hillside", note: "wide" }],
    shots: [
      { id: "sh1", sceneId: "s1", speaker: "Eli", line: "I've got you.", action: null, note: "wide", seconds: 4, firstFrame: "fresh", clip: null },
    ],
    ...overrides,
  };
}

test("names the one speaker and quotes the line exactly", () => {
  const p = project();
  const text = clipPrompt(p, p.shots[0]);
  assert.ok(text.includes('saying: "I\'ve got you."'));
  assert.ok(text.includes("Eli speaks in a bright young voice"));
  assert.ok(text.includes("a young shepherd girl with braids and a blue headscarf."));
  assert.ok(text.includes("Only Eli speaks; everyone else stays silent with their mouth closed."));
});

test("the line is inserted byte for byte, quotes and all", () => {
  const p = project();
  const line = 'He said "come" — now! 100% “me” $1 \\n';
  const text = clipPrompt(p, { ...p.shots[0], line });
  assert.ok(text.includes(`saying: "${line}"`));
});

test("a silent shot says no one speaks", () => {
  const p = project();
  const shot = { ...p.shots[0], speaker: null, line: null, action: "Pip trots over the hill." };
  const text = clipPrompt(p, shot);
  assert.ok(text.includes("No one speaks. Pip trots over the hill."));
  assert.ok(!/speaks in/.test(text));
});

test("a line with an action puts the speaker sentence first, then the action", () => {
  const p = project();
  const shot = { ...p.shots[0], action: "She lifts the lamb." };
  const text = clipPrompt(p, shot);
  assert.ok(text.indexOf("Only Eli speaks") < text.indexOf("She lifts the lamb."));
  assert.ok(!text.includes("No one speaks"));
});

test("every prompt carries the style, no background music and the no-text line", () => {
  const p = project();
  for (const style of Object.values(STYLES)) {
    const clip = clipPrompt({ ...p, meta: { ...p.meta, style: style.id } }, p.shots[0]);
    assert.ok(clip.startsWith(style.prompt), style.id);
    assert.ok(clip.endsWith(`No background music. ${NO_TEXT_LINE}`), style.id);
    const portrait = portraitPrompt(p.cast.Eli, style.id);
    assert.ok(portrait.startsWith(style.prompt), style.id);
    assert.ok(portrait.endsWith(NO_TEXT_LINE), style.id);
  }
});

test("an unknown style falls back to the default style", () => {
  assert.ok(portraitPrompt(member("Eli", "a girl"), "nonsense").startsWith(STYLES.family3d.prompt));
});

test("portraitPrompt uses the C0 wording", () => {
  const text = portraitPrompt(member("Eli", "a young shepherd girl."), "storybook");
  assert.equal(
    text,
    `${STYLES.storybook.prompt}. Character portrait of Eli, a young shepherd girl. `
      + `Three-quarter view, head and shoulders, plain soft warm background, friendly expression. ${NO_TEXT_LINE}`,
  );
});

test("portraitPrompt copes with an empty look", () => {
  const text = portraitPrompt(member("Eli", ""), "clay");
  assert.ok(text.includes("Character portrait of Eli. Three-quarter view"));
});

test("a fresh shot names each referenced character by picture number", () => {
  const p = project();
  const shot = { ...p.shots[0], action: "Pip bleats." };
  assert.deepEqual(referencedCast(p, shot), ["Eli", "Pip"]);
  const text = clipPrompt(p, shot);
  assert.ok(text.includes("Eli is the character in reference picture 1."));
  assert.ok(text.includes("Pip is the character in reference picture 2."));
});

test("a chained shot sends no reference pictures and carries no reference sentences", () => {
  const p = project();
  const shot = { ...p.shots[0], firstFrame: "chain" };
  assert.deepEqual(referencedCast(p, shot), []);
  assert.ok(!/reference picture/.test(clipPrompt(p, shot)));
});

test("referencedCast: speaker first, then scene members in order of first appearance", () => {
  const p = project({
    scenes: [{ id: "s1", place: "Ruth's garden", note: "wide" }],
    shots: [
      { id: "sh1", sceneId: "s1", speaker: "Eli", line: "Hi.", action: "pip hops in", note: "wide", seconds: 4, firstFrame: "fresh", clip: null },
      { id: "sh2", sceneId: "s1", speaker: "Pip", line: "Baa.", action: null, note: "wide", seconds: 4, firstFrame: "chain", clip: null },
    ],
  });
  assert.deepEqual(referencedCast(p, p.shots[0]), ["Eli", "Ruth", "Pip"]);
});

test("referencedCast: a speaker in a later shot of the scene counts as in the scene", () => {
  const p = project({
    shots: [
      { id: "sh1", sceneId: "s1", speaker: "Eli", line: "Hi.", action: null, note: "", seconds: 4, firstFrame: "fresh", clip: null },
      { id: "sh2", sceneId: "s1", speaker: "Pip", line: "Baa.", action: null, note: "", seconds: 4, firstFrame: "chain", clip: null },
    ],
  });
  assert.deepEqual(referencedCast(p, p.shots[0]), ["Eli", "Pip"]);
});

test("referencedCast matches whole words only, case-insensitively", () => {
  const p = project({
    cast: { ...project().cast, Al: member("Al", "a tall man") },
    scenes: [{ id: "s1", place: "a hillside", note: "" }],
    shots: [{ id: "sh1", sceneId: "s1", speaker: "Eli", line: "Hi.", action: "A ripple of PIP's bell; an algae pond.", note: "", seconds: 4, firstFrame: "fresh", clip: null }],
  });
  assert.deepEqual(referencedCast(p, p.shots[0]), ["Eli", "Pip"]);
});

test("referencedCast skips unapproved characters and ones without a portrait", () => {
  const base = project();
  const p = project({
    cast: {
      ...base.cast,
      Pip: { ...base.cast.Pip, approved: false },
      Ruth: { ...base.cast.Ruth, portrait: null },
    },
    shots: [{ id: "sh1", sceneId: "s1", speaker: "Eli", line: "Hi.", action: "Pip and Ruth wave.", note: "", seconds: 4, firstFrame: "fresh", clip: null }],
  });
  assert.deepEqual(referencedCast(p, p.shots[0]), ["Eli"]);
});

test("referencedCast sends at most three pictures", () => {
  const base = project();
  const p = project({
    cast: { ...base.cast, Dan: member("Dan", "a boy") },
    shots: [{ id: "sh1", sceneId: "s1", speaker: "Eli", line: "Hi.", action: "Pip, Ruth and Dan wave.", note: "", seconds: 4, firstFrame: "fresh", clip: null }],
  });
  assert.deepEqual(referencedCast(p, p.shots[0]), ["Eli", "Pip", "Ruth"]);
  assert.ok(!/Dan is the character/.test(clipPrompt(p, p.shots[0])));
});

test("other cast in the scene appear by look only, never by name", () => {
  const p = project({
    shots: [{ id: "sh1", sceneId: "s1", speaker: "Eli", line: "Hi.", action: "Pip bleats.", note: "", seconds: 4, firstFrame: "chain", clip: null }],
  });
  const text = clipPrompt(p, p.shots[0]);
  assert.ok(text.includes("Also in the scene: a small white lamb with a bell."));
  assert.ok(!text.includes("Also in the scene: Pip"));
  assert.ok(!/Ruth|old woman/.test(text), "Ruth is not in the scene");
});

test("a missing scene or missing cast entry does not crash", () => {
  const p = project({ scenes: [] });
  const text = clipPrompt(p, { ...p.shots[0], speaker: "Nobody" });
  assert.ok(text.includes('Nobody speaks, saying: "I\'ve got you."'));
  assert.deepEqual(referencedCast(p, { ...p.shots[0], speaker: "Nobody" }), []);
});

test("no prompt or style label ever contains Pixar", () => {
  for (const style of Object.values(STYLES)) {
    assert.ok(!/pixar/i.test(style.label));
    assert.ok(!/pixar/i.test(portraitPrompt(member("Eli", "a girl"), style.id)));
  }
});

// Enabled in Task 5, once the examples exist to build every prompt from.
test("no prompt, style label or example ever contains Pixar (every example)", { todo: "enable when Task 5 examples exist" }, () => {
  assert.fail("not wired to the examples yet");
});
