import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { STYLE_ANCHORS, anchorFor, listStyles, CHARACTER_ANCHORS, characterAnchorFor, detectCharacters, composeScenePrompt, sceneMatchText } from "./styleAnchors.js";

describe("styleAnchors", () => {
  test("has the 4 v1 styles and the music video style", () => {
    assert.deepEqual(
      listStyles().sort(),
      ["ancient-scripture", "cinematic-bible", "heavenly-atmosphere", "modern-devotional", "music-video"],
    );
  });

  test("the music video anchor has no frame shape in it, so it suits any aspect", () => {
    assert.equal(
      anchorFor("music-video"),
      "cinematic music video still, natural film grain, motivated practical light, shallow depth of field, no text, no watermark",
    );
    assert.doesNotMatch(anchorFor("music-video"), /9:16|16:9|vertical|portrait|landscape/i);
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

describe('sceneMatchText', () => {
  // The library matches pictures by meaning. The style and cast text every
  // scene shares made unrelated scenes look alike (an apostle at a desk and a
  // modern man in a gold chain went from 0.16 to 0.53 cosine with the anchor).
  test('keeps only the scene\'s own description', () => {
    const p = composeScenePrompt('an apostle writing by lamplight', { style: 'cinematic-bible', characters: ['paul'] });
    assert.equal(sceneMatchText(p), 'an apostle writing by lamplight');
  });
  test('works for every style, and leaves a prompt without anchors alone', () => {
    for (const style of listStyles()) {
      assert.equal(sceneMatchText(composeScenePrompt('still waters', { style })), 'still waters');
    }
    assert.equal(sceneMatchText('a lamp on a table'), 'a lamp on a table');
  });
  test('a prompt that is only anchors falls back to the whole prompt rather than nothing', () => {
    const p = anchorFor('cinematic-bible');
    assert.equal(sceneMatchText(p), p);
  });
});
