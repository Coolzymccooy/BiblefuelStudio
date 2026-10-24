import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCartoonScript } from "./parse.js";
import {
  planShots, shotSeconds, checkFilm,
  WORDS_PER_SEC, BREATH_SEC, SILENT_SHOT_SEC, VERSE_CARD_SEC, END_CARD_SEC, MAX_FILM_SEC, MAX_SHOTS,
} from "./plan.js";

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

function plan(markdown) {
  return planShots(parseCartoonScript(markdown));
}

test("the length constants match the spec", () => {
  assert.equal(WORDS_PER_SEC, 2.5);
  assert.equal(BREATH_SEC, 1);
  assert.equal(SILENT_SHOT_SEC, 4);
  assert.equal(VERSE_CARD_SEC, 2.5);
  assert.equal(END_CARD_SEC, 3);
  assert.equal(MAX_FILM_SEC, 40);
  assert.equal(MAX_SHOTS, 8);
});

test("one line is one shot; an action joins the shot before it", () => {
  const shots = plan(`Scene: Hill, wide
Eli: "Pip? Where are you?"
(Pip bleats from behind a rock.)
(Eli turns.)
Pip: "I'm stuck!"
`);
  assert.equal(shots.length, 2);
  assert.deepEqual(shots.map((s) => s.id), ["sh1", "sh2"]);
  assert.equal(shots[0].speaker, "Eli");
  assert.equal(shots[0].line, "Pip? Where are you?");
  assert.equal(shots[0].action, "Pip bleats from behind a rock. Eli turns.");
  assert.equal(shots[0].sceneId, "s1");
  assert.equal(shots[0].note, "wide");
  assert.equal(shots[1].speaker, "Pip");
  assert.equal(shots[1].action, null);
});

test("an action that opens a scene is a 4 s silent shot", () => {
  const shots = plan(`Scene: Hill, wide
(Wind moves the grass.)
Eli: "Hello there"
`);
  assert.equal(shots.length, 2);
  assert.equal(shots[0].speaker, null);
  assert.equal(shots[0].line, null);
  assert.equal(shots[0].action, "Wind moves the grass.");
  assert.equal(shots[0].seconds, 4);
  assert.equal(shots[1].line, "Hello there");
});

test("an action does not join a shot from the previous scene", () => {
  const shots = plan(`Scene: A
Eli: "One"
Scene: B
(Rain falls.)
`);
  assert.equal(shots.length, 2);
  assert.equal(shots[0].action, null);
  assert.equal(shots[1].sceneId, "s2");
  assert.equal(shots[1].action, "Rain falls.");
});

test("shotSeconds: 10 words -> 5, 1 word -> 4, 30 words -> 12 and flagged tooLong", () => {
  assert.equal(shotSeconds(words(10)), 5);
  assert.equal(shotSeconds("hello"), 4);
  assert.equal(shotSeconds(words(30)), 12);
  assert.equal(shotSeconds(""), 4);

  const parsed = parseCartoonScript(`Scene: A\nEli: "${words(30)}"\nEli: "short one"\n`);
  const shots = planShots(parsed);
  const check = checkFilm(shots, parsed.scenes);
  assert.deepEqual(check.tooLong, [{ shotId: "sh1", words: 30 }]);
});

test("a 36 s story is over 40 s with cards and names the longest scene", () => {
  const scenes = [{ id: "s1", place: "Hill" }, { id: "s2", place: "Rock" }];
  const shot = (id, sceneId, seconds) => ({
    id, sceneId, speaker: "Eli", line: "x", action: null, note: "", seconds, firstFrame: "chain",
  });
  const shots = [shot("sh1", "s1", 8), shot("sh2", "s1", 4), shot("sh3", "s2", 12), shot("sh4", "s2", 12)];
  const check = checkFilm(shots, scenes);
  assert.equal(check.storySec, 36);
  assert.equal(check.filmSec, 41.5);
  assert.equal(check.ok, false);
  assert.equal(check.overBySec, 1.5);
  assert.deepEqual(check.trimScene, { id: "s2", place: "Rock" });
  assert.equal(check.tooMany, false);
});

test("a film within 40 s is ok and names no scene to trim", () => {
  const scenes = [{ id: "s1", place: "Hill" }];
  const shots = [{ id: "sh1", sceneId: "s1", speaker: "Eli", line: "x", action: null, note: "", seconds: 10, firstFrame: "fresh" }];
  const check = checkFilm(shots, scenes);
  assert.equal(check.filmSec, 15.5);
  assert.equal(check.ok, true);
  assert.equal(check.overBySec, 0);
  assert.equal(check.trimScene, null);
});

test("9 lines is tooMany", () => {
  const lines = Array.from({ length: 9 }, () => 'Eli: "Hi there"').join("\n");
  const parsed = parseCartoonScript(`Scene: A\n${lines}\n`);
  const shots = planShots(parsed);
  assert.equal(shots.length, 9);
  assert.equal(checkFilm(shots, parsed.scenes).tooMany, true);
  assert.equal(checkFilm(shots.slice(0, 8), parsed.scenes).tooMany, false);
});

test("first shot of each scene is fresh, the rest chain", () => {
  const shots = plan(`Scene: A
Eli: "One"
Eli: "Two"
Scene: B
Pip: "Three"
Pip: "Four"
`);
  assert.deepEqual(shots.map((s) => s.firstFrame), ["fresh", "chain", "fresh", "chain"]);
});
