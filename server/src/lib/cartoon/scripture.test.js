import { test } from "node:test";
import assert from "node:assert/strict";
import { unquotedJesusLines } from "./scripture.js";
import { parseCartoonScript } from "./parse.js";

const VERSE = "And God said, Let there be light: and there was light.";

function script(speaker, text) {
  return parseCartoonScript(`# T\nVerse: Genesis 1:3\n\nCast:\n- ${speaker}: someone. Voice: calm.\n- Mia: a girl. Voice: bright.\n\nScene: A hill, wide\n${speaker}: "${text}"\nMia: "God loves me, and the Lord is kind."\n`);
}

test("The Lord with invented words is caught", () => {
  const found = unquotedJesusLines(script("The Lord", "I will always carry you home."), VERSE);
  assert.deepEqual(found.map((line) => line.text), ["I will always carry you home."]);
});

test("Lord Jesus quoting the verse passes", () => {
  assert.deepEqual(unquotedJesusLines(script("Lord Jesus", "Let there be light"), VERSE), []);
});

test("every divine name is held to the verse", () => {
  for (const name of ["Jesus", "Jesus Christ", "Christ", "God", "Yeshua", "Saviour", "Savior", "Messiah", "the lord"]) {
    const found = unquotedJesusLines(script(name, "Invented words."), VERSE);
    assert.equal(found.length, 1, name);
  }
});

test("a non-divine speaker whose line mentions God is not affected", () => {
  const parsed = script("Eli", "God made the stars and the Lord hears me.");
  assert.deepEqual(unquotedJesusLines(parsed, ""), []);
});

test("a name that only contains a divine word inside a longer word is not divine", () => {
  assert.deepEqual(unquotedJesusLines(script("Godfrey", "Invented words."), VERSE), []);
});

test("with no verse text every divine line is unquoted", () => {
  assert.equal(unquotedJesusLines(script("God", "Let there be light"), "").length, 1);
});
