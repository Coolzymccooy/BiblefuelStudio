import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { STYLE_ANCHORS, anchorFor, listStyles, CHARACTER_ANCHORS, characterAnchorFor, detectCharacters, composeScenePrompt } from "./styleAnchors.js";

describe("styleAnchors", () => {
  test("has the 4 v1 styles", () => {
    assert.deepEqual(
      listStyles().sort(),
      ["ancient-scripture", "cinematic-bible", "heavenly-atmosphere", "modern-devotional"],
    );
  });

  test("anchorFor returns the style's suffix", () => {
    assert.ok(anchorFor("cinematic-bible").includes("cinematic"));
  });

  test("anchorFor falls back to cinematic-bible for an unknown style", () => {
    assert.equal(anchorFor("nonsense"), STYLE_ANCHORS["cinematic-bible"]);
  });
});

describe('character anchors', () => {
  test('returns a description for a known character', () => {
    assert.match(characterAnchorFor('jesus'), /olive-brown/);
  });

  test('is case-insensitive and trims', () => {
    assert.equal(characterAnchorFor('  JESUS '), characterAnchorFor('jesus'));
  });

  test('returns empty string for unknown keys rather than throwing', () => {
    assert.equal(characterAnchorFor('gandalf'), '');
    assert.equal(characterAnchorFor(undefined), '');
  });

  test('descriptions cover stable visible traits a model can hold steady', () => {
    for (const [key, desc] of Object.entries(CHARACTER_ANCHORS)) {
      assert.ok(desc.length > 30, `${key} description is too thin to anchor anything`);
    }
  });
});

describe('detectCharacters', () => {
  test('finds a character named in the narration', () => {
    assert.deepEqual(detectCharacters('Then Jesus wept.'), ['jesus']);
  });

  test('finds several characters in one scene', () => {
    const found = detectCharacters('Peter and Paul travelled together.');
    assert.ok(found.includes('peter'));
    assert.ok(found.includes('paul'));
  });

  test('matches whole words only', () => {
    assert.deepEqual(detectCharacters('the davidic line of kings'), [],
      'must not fire on a substring');
  });

  test('does NOT guess between ambiguous variants of the same person', () => {
    assert.deepEqual(detectCharacters('David faced the giant'), [],
      'david_young vs david_king is the caller’s decision');
  });

  test('handles empty and nullish input', () => {
    assert.deepEqual(detectCharacters(''), []);
    assert.deepEqual(detectCharacters(null), []);
  });
});

describe('composeScenePrompt', () => {
  test('orders subject, then characters, then style', () => {
    const p = composeScenePrompt('a hillside at dawn', { style: 'cinematic-bible', characters: ['jesus'] });
    assert.ok(p.indexOf('hillside') < p.indexOf('olive-brown'), 'subject leads');
    assert.ok(p.indexOf('olive-brown') < p.indexOf('cinematic biblical'), 'style closes');
  });

  test('always appends a style anchor even with no characters', () => {
    assert.match(composeScenePrompt('an empty tomb'), /no watermark/);
  });

  test('ignores unknown character keys', () => {
    const p = composeScenePrompt('a scene', { characters: ['nobody'] });
    assert.match(p, /a scene/);
  });

  test('does not duplicate a repeated character', () => {
    const p = composeScenePrompt('a scene', { characters: ['jesus', 'jesus'] });
    const first = p.indexOf('olive-brown Middle Eastern skin');
    assert.equal(p.indexOf('olive-brown Middle Eastern skin', first + 1), -1);
  });
});
