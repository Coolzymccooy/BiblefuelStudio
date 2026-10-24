import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cartoonFromScript } from "./model.js";
import {
  buildCartoonRenderData, filmTimeline, duckWindows, verseText, playedSec, DUCK_PAD_SEC, MAX_VERSE_CHARS,
} from "./renderData.js";
import { bedVolume, captionPages, duckAmount, BED_BASE, BED_DUCK, PAGE_MAX_WORDS } from "./filmCurves.js";
import { VERSE_CARD_SEC, END_CARD_SEC, MAX_FILM_SEC } from "./plan.js";

const SCRIPT = `# The Lost Lamb
Verse: Luke 15:4
Style: 3D family film

Cast:
- Eli: a shepherd boy about eight, curly dark hair. Voice: bright and eager.
- Pip: a small fluffy white lamb with one black ear. Voice: tiny and soft.

Scene: A rocky hillside at dusk
Eli: "Pip? Pip, where are you?"
Pip: "I'm stuck, Eli!"

Scene: Behind the rock, close-up
(Eli lifts Pip free of the thorns.)
Eli: "I came for you."
`;

const VERSE = "What man of you, having an hundred sheep, if he lose one of them, doth not leave the ninety and nine?";

/** The Lost Lamb with every shot filmed: sh1 Eli, sh2 Pip, sh3 silent (new scene), sh4 Eli. */
function filmed({ durations = [4.3, 6, 4, 3.9], windows } = {}) {
  const p = cartoonFromScript(SCRIPT);
  const w = windows || [[{ from: 0.3, to: 1.2 }, { from: 1.6, to: 2.8 }], [{ from: 0.6, to: 2.1 }], [], [{ from: 0.5, to: 1.9 }]];
  return {
    id: "c0ffee00-0000-4000-8000-000000000000",
    ...p,
    meta: { ...p.meta, verse: { reference: "Luke 15:4", text: VERSE } },
    endCard: { text: "He came looking for you." },
    shots: p.shots.map((s, i) => ({
      ...s,
      clip: { status: "done", libraryId: `lib-${i}`, durationSec: durations[i], windows: w[i], speech: null, stale: false },
    })),
  };
}

const assets = (p, { bed = "bed.wav" } = {}) => ({
  url: (n) => `http://127.0.0.1:9/${n}`,
  names: {
    clips: Object.fromEntries(p.shots.map((s) => [s.id, `clip-${s.id}.mp4`])),
    bed,
    fonts: { sans: "sans.ttf", serif: "serif.ttf", serifItalic: "serif-italic.ttf" },
  },
});

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

describe("cartoon render data", () => {
  test("shots follow the verse card back to back and the film is ≤ 40 s", () => {
    const p = filmed();
    const data = buildCartoonRenderData(p, assets(p));
    assert.equal(data.fps, 30);
    assert.equal(data.width, 1080);
    assert.equal(data.height, 1920);
    assert.deepEqual(data.verse, { reference: "Luke 15:4", text: VERSE, from: 0, to: VERSE_CARD_SEC });
    assert.equal(data.shots[0].from, VERSE_CARD_SEC);
    for (let i = 1; i < data.shots.length; i += 1) assert.equal(data.shots[i].from, data.shots[i - 1].to);
    // Each clip plays to its measured length, capped at its planned seconds + 0.5.
    assert.ok(near(data.shots[0].trimTo, 4.3));
    assert.ok(near(data.shots[1].trimTo, p.shots[1].seconds + 0.5));
    assert.ok(near(data.shots[3].trimTo, 3.9));
    for (const s of data.shots) {
      assert.ok(near(s.to - s.from, s.trimTo, 1e-3));
      assert.ok(Number.isInteger(Math.round(s.from * 30)) && near(s.from * 30, Math.round(s.from * 30), 1e-6), "frame aligned");
    }
    assert.equal(data.shots[0].src, "http://127.0.0.1:9/clip-sh1.mp4");
    // Hard cuts inside a scene; a soft dissolve only where the scene changes.
    assert.deepEqual(data.shots.map((s) => s.dissolve), [false, false, true, false]);
    assert.ok(near(data.total, data.shots.at(-1).to + END_CARD_SEC));
    assert.ok(data.total <= MAX_FILM_SEC);
    assert.deepEqual(data.endCard, {
      from: data.total - END_CARD_SEC, to: data.total, reference: "Luke 15:4", text: "He came looking for you.", brand: "BibleFuel Studio",
    });
    assert.deepEqual(data.fonts, { sans: "http://127.0.0.1:9/sans.ttf", serif: "http://127.0.0.1:9/serif.ttf", serifItalic: "http://127.0.0.1:9/serif-italic.ttf" });
    assert.equal(filmTimeline(p).fits, true);
  });

  test("a clip with no measured length plays its planned seconds", () => {
    const p = filmed({ durations: [0, 4, 4, 4] });
    assert.equal(playedSec(p.shots[0]), p.shots[0].seconds);
  });

  test("the cap follows the length the clip was ordered at, not a later edit to the plan", () => {
    const shot = { seconds: 4, clip: { status: "done", seconds: 6, durationSec: 6.08 } };
    assert.ok(near(playedSec(shot), 6.067, 1e-3), String(playedSec(shot)));
  });

  test("captions use the script words, timed inside the speech windows", () => {
    const p = filmed();
    const data = buildCartoonRenderData(p, assets(p));
    assert.equal(data.captionsOn, true);
    // The silent shot has no caption.
    assert.deepEqual(data.captions.map((c) => c.shotId), ["sh1", "sh2", "sh4"]);
    const first = data.captions[0];
    assert.deepEqual(first.words.map((w) => w.text), ["Pip?", "Pip,", "where", "are", "you?"]);
    const from = data.shots[0].from;
    const inside = (w) => p.shots[0].clip.windows.some((win) => w.start >= from + win.from - 1e-3 && w.end <= from + win.to + 1e-3);
    assert.ok(first.words.every(inside), JSON.stringify(first.words));
    for (let i = 1; i < first.words.length; i += 1) assert.ok(first.words[i].start >= first.words[i - 1].end - 1e-3);
    // Both windows are used: the line is spread across the pause, not crammed into one.
    assert.ok(first.words.some((w) => w.start >= from + 1.6 - 1e-3));
    assert.ok(first.words.some((w) => w.end <= from + 1.2 + 1e-3));
    assert.equal(data.captions[2].words.map((w) => w.text).join(" "), "I came for you.");
  });

  test("a spoken shot with no speech windows spreads its words over the clip", () => {
    const p = filmed({ windows: [[], [], [], []] });
    const data = buildCartoonRenderData(p, assets(p));
    const c = data.captions[0];
    const shot = data.shots[0];
    assert.equal(c.words.length, 5);
    assert.ok(c.words[0].start >= shot.from && c.words.at(-1).end <= shot.to);
  });

  test("captions off is passed through", () => {
    const p = { ...filmed(), captions: { enabled: false } };
    assert.equal(buildCartoonRenderData(p, assets(p)).captionsOn, false);
  });

  test("the speaker's name shows only the first time", () => {
    const p = filmed();
    const data = buildCartoonRenderData(p, assets(p));
    assert.deepEqual(data.captions.map((c) => [c.speaker, c.showName]), [["Eli", true], ["Pip", true], ["Eli", false]]);
  });

  test("duck windows are speech windows in film time, padded", () => {
    const p = filmed();
    const tl = filmTimeline(p);
    const windows = duckWindows(p, tl);
    const s1 = tl.shots[0].from;
    assert.ok(near(windows[0].from, s1 + 0.3 - DUCK_PAD_SEC, 1e-3));
    assert.ok(near(windows[0].to, s1 + 1.2 + DUCK_PAD_SEC, 1e-3));
    assert.ok(near(windows[1].from, s1 + 1.6 - DUCK_PAD_SEC, 1e-3));
    const s4 = tl.shots[3].from;
    assert.ok(near(windows.at(-1).to, s4 + 1.9 + DUCK_PAD_SEC, 1e-3));
    for (let i = 1; i < windows.length; i += 1) assert.ok(windows[i].from > windows[i - 1].to, "merged when they touch");
    const data = buildCartoonRenderData(p, assets(p));
    assert.deepEqual(data.bed, { src: "http://127.0.0.1:9/bed.wav", base: BED_BASE, duck: BED_DUCK, windows });
  });

  test("a speech window past the trimmed end of a clip is cut to it", () => {
    const p = filmed({ durations: [10, 4, 4, 4], windows: [[{ from: 0.2, to: 9.5 }], [{ from: 1, to: 2 }], [], [{ from: 0.5, to: 1.9 }]] });
    const tl = filmTimeline(p);
    const windows = duckWindows(p, tl);
    assert.ok(windows[0].to <= tl.shots[0].to + DUCK_PAD_SEC + 1e-3);
  });

  test("no bed means bed: null", () => {
    const p = { ...filmed(), music: { bed: null } };
    assert.equal(buildCartoonRenderData(p, assets(p)).bed, null);
    const unstaged = filmed();
    assert.equal(buildCartoonRenderData(unstaged, assets(unstaged, { bed: null })).bed, null);
  });

  test("the verse card falls back to the reference, and a long verse is cut at a sentence", () => {
    const p = { ...filmed(), meta: { ...filmed().meta, verse: { reference: "Luke 15:4", text: "" } } };
    assert.deepEqual(buildCartoonRenderData(p, assets(p)).verse.text, "");
    const long = `${"Rejoice with me, for I have found my sheep which was lost. ".repeat(3)}And more words follow here without end`;
    const cut = verseText(long);
    assert.ok(cut.length <= MAX_VERSE_CHARS);
    assert.ok(/\.$/.test(cut), cut);
    const runOn = "word ".repeat(80).trim();
    const cutRunOn = verseText(runOn);
    assert.ok(cutRunOn.length <= MAX_VERSE_CHARS + 1 && cutRunOn.endsWith("…"), cutRunOn);
    assert.equal(verseText("  A  short   verse. "), "A short verse.");
  });

  test("a film over 40 s does not fit", () => {
    const p = filmed({ durations: [12, 12, 12, 12] });
    const tight = { ...p, shots: p.shots.map((s) => ({ ...s, seconds: 12 })) };
    const tl = filmTimeline(tight);
    assert.equal(tl.fits, false);
    assert.ok(tl.total > MAX_FILM_SEC);
  });

  test("the end card falls back to the title when it has no text", () => {
    const p = { ...filmed(), endCard: { text: "" } };
    assert.equal(buildCartoonRenderData(p, assets(p)).endCard.text, "The Lost Lamb");
  });
});

describe("cartoon film curves", () => {
  const bed = { base: BED_BASE, duck: BED_DUCK, windows: [{ from: 10, to: 12 }] };
  const span = { inTo: 2.5, outFrom: 30, total: 33 };

  test("the bed fades in over the verse card and out under the end card", () => {
    assert.equal(bedVolume(bed, 0, span), 0);
    assert.ok(bedVolume(bed, 1.25, span) > 0 && bedVolume(bed, 1.25, span) < BED_BASE);
    assert.ok(near(bedVolume(bed, 5, span), BED_BASE));
    assert.ok(bedVolume(bed, 31.5, span) < BED_BASE);
    assert.ok(near(bedVolume(bed, 33, span), 0));
  });

  test("the bed ducks inside a speech window, eased over 0.2 s", () => {
    assert.ok(near(bedVolume(bed, 11, span), BED_DUCK));
    assert.ok(near(bedVolume(bed, 9.79, span), BED_BASE));
    const mid = bedVolume(bed, 9.9, span);
    assert.ok(mid < BED_BASE && mid > BED_DUCK);
    assert.ok(near(bedVolume(bed, 12.21, span), BED_BASE));
    assert.equal(duckAmount(5, bed.windows), 0);
  });

  test("caption pages break at pauses and at the word limit, never leaving one word alone", () => {
    const w = (text, start, end) => ({ text, start, end });
    const pages = captionPages([w("a", 0, 0.2), w("b", 0.2, 0.4), w("c", 1.2, 1.4), w("d", 1.4, 1.6)]);
    assert.deepEqual(pages.map((p) => p.map((x) => x.text)), [["a", "b"], ["c", "d"]]);
    const many = Array.from({ length: PAGE_MAX_WORDS + 1 }, (_, i) => w(`w${i}`, i * 0.2, i * 0.2 + 0.2));
    const paged = captionPages(many);
    assert.equal(paged.length, 1, "a single trailing word joins the page before it");
    const more = Array.from({ length: PAGE_MAX_WORDS + 3 }, (_, i) => w(`w${i}`, i * 0.2, i * 0.2 + 0.2));
    assert.deepEqual(captionPages(more).map((p) => p.length), [PAGE_MAX_WORDS, 3]);
  });
});
