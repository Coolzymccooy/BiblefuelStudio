import { test } from "node:test";
import assert from "node:assert/strict";
import { brandingEvents } from "./brandingAss.js";
import { planBranding, bandGeometry } from "./brandingPlan.js";
import { resolveLook, FALLBACK_FONT } from "../kinetic/looks.js";
import { widthAt, covers } from "../kinetic/text.js";

const look = resolveLook("studio-gospel-gold");
const LOGO = { width: 400, height: 100 };
const SIZES = {
  tall: { w: 1080, h: 1920 }, wide: { w: 1920, h: 1080 },
  smallTall: { w: 720, h: 1280 }, smallWide: { w: 1280, h: 720 }, square: { w: 720, h: 720 },
};

const baseArgs = {
  durationSec: 200, audibleEnd: 190, captionsEnd: 180, hideWindows: [[30, 40]],
  options: { logo: true, intro: true, endCard: true }, hasLogo: true, artist: "Sthill Waters", shortsTrim: false,
};

function build({ size = "tall", logo = LOGO, artist = "Sthill Waters", title = "Grace Abounds", plan: planOver = {} } = {}) {
  const { w, h } = SIZES[size];
  const plan = planBranding({ ...baseArgs, artist, hasLogo: Boolean(logo), ...planOver });
  const geometry = bandGeometry({ w, h, logo });
  const events = brandingEvents({ plan, geometry, look, title, artist, w, h });
  return { plan, geometry, events, w, h };
}

/** Parses a Dialogue line into its layer, times and the text after the style fields. */
function parse(line) {
  const m = /^Dialogue: (\d+),([\d:.]+),([\d:.]+),Kinetic,,0,0,0,,(.*)$/su.exec(line);
  assert.ok(m, `not a Kinetic dialogue line: ${line}`);
  const tagMatch = /^\{([^}]*)\}(.*)$/su.exec(m[4]);
  return { layer: Number(m[1]), start: m[2], end: m[3], tags: tagMatch ? tagMatch[1] : "", text: tagMatch ? tagMatch[2] : m[4] };
}

const toTime = (sec) => {
  const cs = Math.round(sec * 100);
  const s = Math.floor(cs / 100);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

const num = (tags, re) => Number(re.exec(tags)[1]);
const family = (tags) => /\\fn([^\\}]+)/u.exec(tags)[1];
const nameLines = (events) => events.map(parse).filter((e) => e.layer === 20 && e.tags.includes("\\an4") && !e.text.includes("\u266a"));
const introLines = (events) => events.map(parse).filter((e) => e.text.includes("\u266a"));

test("every event is a Dialogue line on style Kinetic", () => {
  const { events } = build();
  assert.ok(events.length > 0);
  for (const line of events) {
    assert.match(line, /^Dialogue: \d+,\d:\d\d:\d\d\.\d\d,\d:\d\d:\d\d\.\d\d,Kinetic,,0,0,0,,/u);
  }
});

test("name line: one event per wordmark piece with exact times, \\an4 and the gold colour", () => {
  const { plan, geometry, events } = build();
  const names = nameLines(events);
  assert.ok(plan.wordmark.length >= 2, "fixture needs a hide window to split the wordmark");
  assert.equal(names.length, plan.wordmark.length);
  names.forEach((e, i) => {
    assert.equal(e.start, toTime(plan.wordmark[i][0]));
    assert.equal(e.end, toTime(plan.wordmark[i][1]));
    assert.equal(e.layer, 20);
    assert.equal(e.text, "Sthill Waters");
    assert.ok(e.tags.includes("\\an4"));
    assert.ok(e.tags.includes("\\c&H7AC4E6&"));
    assert.ok(e.tags.includes("\\fad(250,250)"));
    assert.ok(e.tags.includes(`\\pos(${geometry.text.x},${geometry.text.y})`));
  });
});

test("name line uses the look's body font", () => {
  const { events } = build();
  assert.equal(family(nameLines(events)[0].tags), look.body.family);
});

test("no artist means no name line and no 'song by'", () => {
  const { events } = build({ artist: "" });
  assert.equal(nameLines(events).length, 0);
  assert.ok(introLines(events).length > 0);
  for (const e of introLines(events)) assert.ok(!e.text.includes("song by"));
  assert.ok(introLines(events).every((e) => e.text === "\u266a Grace Abounds"));
});

test("intro credit: one event per intro piece, with the note and 'song by'", () => {
  const { plan, events } = build();
  const intros = introLines(events);
  assert.equal(intros.length, plan.intro.length);
  intros.forEach((e, i) => {
    assert.equal(e.start, toTime(plan.intro[i][0]));
    assert.equal(e.end, toTime(plan.intro[i][1]));
    assert.equal(e.layer, 20);
    assert.equal(e.text, "\u266a Grace Abounds \u2014 song by Sthill Waters");
  });
});

test("the intro credit falls back to a font that has the note, for the whole line", () => {
  const { events } = build();
  const tags = introLines(events)[0].tags;
  assert.equal(family(tags), FALLBACK_FONT.family);
});

test("name line and intro credit are never on screen at once", () => {
  const { plan } = build();
  for (const [a, b] of plan.wordmark) {
    for (const [c, d] of plan.intro) assert.ok(b <= c || d <= a);
  }
});

test("a very long title stays inside 0.88 of the frame width", () => {
  for (const size of ["tall", "wide"]) {
    const title = "Bless the Lord O my soul and all that is within me ".repeat(3).slice(0, 140);
    const { events, geometry, w } = build({ size, title });
    const e = introLines(events)[0];
    const fs = num(e.tags, /\\fs(\d+)/u);
    const file = [look.body, FALLBACK_FONT].find((f) => f.family === family(e.tags)).file;
    assert.ok(geometry.text.x + widthAt(file, e.text, fs) <= 0.88 * w, `${size}: ${e.text}`);
    assert.ok(fs >= 14);
    assert.ok(e.text.includes("song by Sthill Waters"), "the artist survives the fit");
  }
});

test("a title too long even at the smallest size is cut with an ellipsis and still fits", () => {
  const title = "Bless the Lord O my soul and all that is within me ".repeat(12);
  const { events, geometry, w } = build({ title });
  const e = introLines(events)[0];
  const fs = num(e.tags, /\\fs(\d+)/u);
  const file = [look.body, FALLBACK_FONT].find((f) => f.family === family(e.tags)).file;
  assert.equal(fs, 14);
  assert.match(e.text, /\S\u2026 \u2014 song by Sthill Waters$/u);
  assert.ok(geometry.text.x + widthAt(file, e.text, fs) <= 0.88 * w);
});

/** Every text line's ink (its width plus the outline on both sides) must sit inside its limit. */
function assertInside(events, w, geometry, label) {
  for (const e of events.map(parse).filter((x) => !x.tags.includes("\\p1"))) {
    const file = [look.body, FALLBACK_FONT].find((f) => f.family === family(e.tags)).file;
    const bord = num(e.tags, /\\bord(\d+)/u);
    const ink = widthAt(file, e.text, num(e.tags, /\\fs(\d+)/u)) + 2 * bord;
    if (e.layer === 20) {
      assert.ok(geometry.text.x + ink <= 0.88 * w, `${label}: ${e.text} (${ink})`);
    } else {
      assert.ok(ink <= 0.84 * w, `${label}: ${e.text} (${ink})`);
    }
  }
}

test("a 100-character artist is cut with an ellipsis and every line fits", () => {
  const artist = "Obaloluwa Adebayo-Okonkwo ".repeat(4).slice(0, 100);
  assert.equal(artist.length, 100);
  for (const size of ["smallTall", "tall", "smallWide", "wide", "square"]) {
    const { events, geometry, w } = build({ size, artist });
    assertInside(events, w, geometry, size);
  }
  {
    const { events } = build({ size: "smallTall", artist });
    const lines = events.map(parse).filter((x) => x.text);
    assert.ok(lines.some((x) => x.layer === 20 && x.tags.includes("\\an4") && !x.text.includes("♪") && x.text.endsWith("…")), "name line is cut");
    assert.ok(lines.some((x) => x.text.includes("♪") && x.text.endsWith("…")), "credit is cut at the artist");
  }
});

test("the outline stays inside the limit at every aspect", () => {
  const title = "Bless the Lord O my soul and all that is within me ".repeat(3);
  for (const size of ["smallTall", "smallWide", "square"]) {
    const { events, geometry, w } = build({ size, title });
    assertInside(events, w, geometry, size);
  }
});

test("the artist is cut only after the title is down to an ellipsis", () => {
  const { events } = build({ size: "smallTall", artist: "Obaloluwa Adebayo-Okonkwo ".repeat(4).slice(0, 100) });
  const text = introLines(events)[0].text;
  assert.ok(text.startsWith("♪ … — song by Obaloluwa"), text);
  assert.ok(text.endsWith("…"));
});

test("cutting keeps whole letters: a Yoruba accent never loses its letter", () => {
  const letter = "ọ́";
  const title = letter.repeat(300);
  // Different artist lengths move the cut point, so an odd and an even code point count both occur.
  for (const artist of ["", "A", "Ab", "Abc", "Abcd", "Abcde"]) {
    const { events } = build({ title, artist });
    const credit = introLines(events)[0].text;
    const before = credit.slice(0, credit.indexOf("…")).normalize("NFC");
    assert.ok(before.length > 3, "the fixture must keep some letters");
    assert.ok(before.endsWith(letter.normalize("NFC")), before.slice(-4));
    const clusters = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(before.slice(2)), (s) => s.segment);
    assert.ok(clusters.every((c) => c === letter.normalize("NFC")), "no lone combining mark");
  }
});

test("cutting a title never splits a surrogate pair", () => {
  const title = "\u2764\u{1F3B5}".repeat(400);
  const { events } = build({ title });
  assert.ok(introLines(events)[0].text.includes("…"), "the fixture must force a cut");
  for (const line of events) assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(line));
});

test("a short credit is not cut and keeps the preferred size", () => {
  const { events, geometry } = build({ title: "Hi", artist: "" });
  const e = introLines(events)[0];
  assert.ok(!e.text.includes("\u2026"));
  assert.equal(num(e.tags, /\\fs(\d+)/u), geometry.text.fs);
});

test("a credit that is a little too wide shrinks instead of being cut", () => {
  const { events, geometry } = build({ title: "Grace Abounds" });
  const e = introLines(events)[0];
  assert.ok(!e.text.includes("\u2026"));
  assert.ok(num(e.tags, /\\fs(\d+)/u) < geometry.text.fs);
});

test("end card: the dim covers the frame at alpha &H21& on layer 20", () => {
  const { plan, events, w, h } = build();
  const dim = events.map(parse).find((e) => e.tags.includes("\\p1"));
  assert.equal(dim.layer, 20);
  assert.equal(dim.start, toTime(plan.endCard.start));
  assert.equal(dim.end, toTime(plan.endCard.end));
  assert.ok(dim.tags.includes("\\1a&H21&"));
  assert.ok(dim.tags.includes("\\1c&H000000&"));
  assert.ok(dim.tags.includes("\\fad(400,0)"));
  assert.ok(dim.tags.includes("\\an7\\pos(0,0)"));
  assert.equal(dim.text, `m 0 0 l ${w} 0 ${w} ${h} 0 ${h}{\\p0}`);
});

test("end card: the title is centred on layer 21 in the look's colour; 'Song by' sits below it", () => {
  const { plan, events, w, h } = build({ size: "tall" });
  const lines = events.map(parse).filter((e) => e.layer === 21);
  const title = lines.find((e) => e.text === "Grace Abounds");
  const by = lines.find((e) => e.text === "Song by Sthill Waters");
  assert.ok(title && by);
  for (const e of lines) {
    assert.equal(e.start, toTime(plan.endCard.start));
    assert.equal(e.end, toTime(plan.endCard.end));
    assert.ok(e.tags.includes("\\an5"));
  }
  assert.ok(title.tags.includes(`\\pos(${Math.round(w / 2)},${Math.round(0.58 * h)})`));
  assert.ok(title.tags.includes("\\c&HD0EBF4&"), title.tags);
  assert.ok(title.tags.includes("\\bord3"));
  assert.ok(title.tags.includes("\\fad(500,0)"));
  assert.equal(num(title.tags, /\\fs(\d+)/u), Math.round(0.05 * h));
  assert.ok(by.tags.includes(`\\pos(${Math.round(w / 2)},${Math.round(0.58 * h + 0.07 * h)})`));
  assert.ok(by.tags.includes("\\c&H7AC4E6&"));
  assert.equal(num(by.tags, /\\fs(\d+)/u), Math.round(0.032 * h));
});

test("end card positions: no logo moves a tall title to 0.47h; wide uses 0.62h and 0.47h", () => {
  const yOf = (events, text) => num(parse(events.find((l) => l.endsWith(text))).tags, /\\pos\(\d+,(\d+)\)/u);
  const tallNoLogo = build({ size: "tall", logo: null });
  assert.equal(yOf(tallNoLogo.events, "}Grace Abounds"), Math.round(0.47 * tallNoLogo.h));
  const wideLogo = build({ size: "wide" });
  assert.equal(yOf(wideLogo.events, "}Grace Abounds"), Math.round(0.62 * wideLogo.h));
  const wideNone = build({ size: "wide", logo: null });
  assert.equal(yOf(wideNone.events, "}Grace Abounds"), Math.round(0.47 * wideNone.h));
  const e = parse(wideLogo.events.find((l) => l.endsWith("}Grace Abounds")));
  assert.equal(num(e.tags, /\\fs(\d+)/u), Math.round(0.065 * wideLogo.h));
});

test("end card without an artist has no 'Song by' line", () => {
  const { events } = build({ artist: "" });
  assert.ok(events.some((l) => l.endsWith("}Grace Abounds")));
  assert.ok(!events.some((l) => l.includes("Song by")));
});

test("end card title longer than the frame is cut to 0.84 of its width", () => {
  const title = "Hallelujah to the Lamb who sits upon the throne ".repeat(4);
  const { events, w } = build({ title });
  const e = parse(events.find((l) => l.startsWith("Dialogue: 21") && !l.includes("Song by")));
  const fs = num(e.tags, /\\fs(\d+)/u);
  const file = [look.body, FALLBACK_FONT].find((f) => f.family === family(e.tags)).file;
  assert.ok(widthAt(file, e.text, fs) <= 0.84 * w);
});

test("switching the end card off draws no dim", () => {
  const { events } = build({ plan: { options: { logo: true, intro: true, endCard: false } } });
  assert.ok(!events.some((l) => l.includes("\\p1")));
  assert.ok(!events.some((l) => l.startsWith("Dialogue: 21")));
});

test("ASS-special characters in the title cannot open an override block", () => {
  const title = "My {\\b1} Song \\ x";
  const { events } = build({ title, artist: "A{\\i1}B\\N" });
  for (const line of events) {
    const body = line.replace(/^Dialogue: [^,]*,[^,]*,[^,]*,Kinetic,,0,0,0,,/u, "");
    const blocks = body.match(/\{[^}]*\}/gu) || [];
    assert.ok(blocks.length <= 2, line);
    for (const b of blocks) assert.ok(/^\{\\(an\d|p0)/u.test(b), `stray block ${b} in ${line}`);
    const afterTags = body.replace(/\{[^}]*\}/gu, "");
    assert.ok(!/[{}\\]/u.test(afterTags), line);
  }
  assert.ok(introLines(events)[0].text.includes("My /b1 Song / x"));
});

test("a Yoruba title is drawn with a font that covers it", () => {
  const title = "\u1ECC l\u1ECD\u0301run \u1E63\u00E9 o";
  const { events } = build({ title });
  for (const e of events.map(parse).filter((x) => x.text && !x.tags.includes("\\p1"))) {
    const file = [look.body, FALLBACK_FONT].find((f) => f.family === family(e.tags)).file;
    assert.ok(covers(file, e.text), `${file} must cover ${e.text}`);
  }
});

test("an emoji title is drawn with a font that covers it", () => {
  const title = "Love \u2764 and joy \u2605";
  const { events } = build({ title });
  for (const e of events.map(parse).filter((x) => x.text && !x.tags.includes("\\p1"))) {
    const file = [look.body, FALLBACK_FONT].find((f) => f.family === family(e.tags)).file;
    assert.ok(covers(file, e.text), `${file} must cover ${e.text}`);
  }
});

test("branding keeps the user's capitalisation", () => {
  const upper = resolveLook("studio-lagos-night");
  assert.equal(upper.uppercase, true);
  const { w, h } = SIZES.tall;
  const plan = planBranding({ ...baseArgs, hideWindows: [] });
  const events = brandingEvents({ plan, geometry: bandGeometry({ w, h, logo: LOGO }), look: upper, title: "Grace Abounds", artist: "Sthill Waters", w, h });
  assert.ok(events.some((l) => l.endsWith("}Sthill Waters")));
  assert.ok(events.some((l) => l.endsWith("}Grace Abounds")));
});

test("an empty plan draws nothing", () => {
  const { w, h } = SIZES.tall;
  const plan = planBranding({ ...baseArgs, options: { logo: false, intro: false, endCard: false } });
  assert.deepEqual(brandingEvents({ plan, geometry: bandGeometry({ w, h, logo: null }), look, title: "T", artist: "A", w, h }), []);
});
