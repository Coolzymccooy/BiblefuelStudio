import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { chooseEffects, titleLineIndexes } from "./policy.js";

const S = (id, kind) => ({ id, kind, label: kind.toUpperCase() });

/** A line builder with its own clock, so no test depends on another's. */
function lineMaker() {
  let t = 0;
  return (sectionId, text, kind = "lead") => {
    const n = text.split(" ").length;
    const line = {
      id: `l${t}`, sectionId, kind, text, start: t, end: t + n * 0.4, effect: "auto",
      words: text.split(" ").map((w, i) => ({ text: w, start: t + i * 0.4, end: t + i * 0.4 + 0.4 })),
    };
    t += n * 0.4 + 1;
    return line;
  };
}

describe("chooseEffects", () => {
  const L = lineMaker();
  const sections = [S("s1", "intro"), S("s2", "verse"), S("s3", "chorus"), S("s4", "outro")];
  const lines = [
    L("s1", "Eh-yeah, eh-yeah!"), L("s1", "Dem say make I calm down..."), L("s1", "Oya!"),
    L("s2", "I remember days wey the road no clear,"), L("s2", "Pocket nearly empty but my dreams dey there."),
    L("s2", "My mama say \"Ọmọ mi\""),
    L("s3", "Who talk say I no go shine?"), L("s3", "(WHO TALK SAY?!)", "response"),
    L("s3", "My time no late!"), L("s3", "Na grace carry me,"),
    L("s4", "Who talk say?"), L("s4", "Nobody fit stop wetin God don start!"), L("s4", "Eh-yeah!"),
  ];
  const fx = chooseEffects({ lines, sections, title: "My Time No Late" });
  test("intro opens on a title card and slams a short shout", () => {
    assert.equal(fx[0], "title");
    assert.equal(fx[2], "slam");
  });
  test("verses alternate stack and pop; a quotation is a quote", () => {
    assert.deepEqual(fx.slice(3, 5), ["stack", "pop"]);
    assert.equal(fx[5], "quote");
  });
  test("the chorus frames its title line and the response pops", () => {
    assert.equal(fx[8], "frame");
    assert.equal(fx[7], "pop");
  });
  test("a long chorus line is never a slam", () => {
    assert.notEqual(fx[6], "slam");
  });
  test("outro: curve first, slam last", () => {
    assert.equal(fx[10], "curve");
    assert.equal(fx[12], "slam");
  });
  test("a line's own choice wins", () => {
    const own = lines.map((l, i) => (i === 3 ? { ...l, effect: "curve" } : l));
    assert.equal(chooseEffects({ lines: own, sections, title: "x" })[3], "curve");
  });
  test("two slams never land within 4 s of each other", () => {
    const M = lineMaker();
    const tight = [S("s1", "chorus")];
    const ls = [M("s1", "Oya dance!"), M("s1", "Dance dance!"), M("s1", "Celebrate!")].map((l, i) => ({ ...l, start: i, end: i + 0.5 }));
    const out = chooseEffects({ lines: ls, sections: tight, title: "zzz" });
    assert.equal(out.filter((e) => e === "slam").length, 1);
  });
  test("a title line too long for a frame is left to pop", () => {
    const M = lineMaker();
    const ls = [M("c", "My time no late, my time no late, my time no late!")];
    assert.deepEqual(chooseEffects({ lines: ls, sections: [S("c", "chorus")], title: "My time no late" }), ["pop"]);
  });
  test("a soft verse line is a quote", () => {
    const M = lineMaker();
    const ls = [M("v", "Plain words here"), M("v", "Days I could not see", "soft")];
    assert.deepEqual(chooseEffects({ lines: ls, sections: [S("v", "verse")], title: "zzz" }), ["stack", "quote"]);
  });
  test("a pre-chorus curves the short line nearest the middle, once", () => {
    const M = lineMaker();
    const ls = [M("p", "One two three four five six seven"), M("p", "Short one here"), M("p", "Another short one"),
      M("p", "Eight nine ten eleven twelve thirteen")];
    const out = chooseEffects({ lines: ls, sections: [S("p", "pre")], title: "zzz" });
    assert.equal(out.filter((e) => e === "curve").length, 1);
    assert.equal(out[1], "curve");
  });
});

describe("energy (R42)", () => {
  const L = lineMaker();
  const sections = [S("s1", "intro"), S("s2", "pre"), S("s3", "chorus"), S("s4", "outro")];
  const lines = [
    L("s1", "Eh-yeah, eh-yeah!"), L("s1", "Oya!"),
    L("s2", "Long line number one here today"), L("s2", "Short one here"), L("s2", "Another long line for the pre"),
    L("s3", "My time no late!"), L("s3", "Who talk say?"), L("s3", "My time no late!"),
    L("s4", "Who talk say?"), L("s4", "Eh-yeah!"),
  ];
  const BIG = ["slam", "frame", "curve"];
  test("calm draws no slams, frames or curves; they step down to pop and stack", () => {
    const wild = chooseEffects({ lines, sections, title: "My Time No Late" });
    const calm = chooseEffects({ lines, sections, title: "My Time No Late", energy: "calm" });
    assert.ok(BIG.every((fx) => wild.includes(fx)), `the wild plan has all three: ${wild}`);
    assert.deepEqual(calm.filter((fx) => BIG.includes(fx)), [], `calm: ${calm}`);
    calm.forEach((fx, i) => {
      if (wild[i] === "slam") assert.equal(fx, "pop", `line ${i}`);
      else if (wild[i] === "frame" || wild[i] === "curve") assert.equal(fx, "stack", `line ${i}`);
      else assert.equal(fx, wild[i], `line ${i} is unchanged`);
    });
  });
  test("lively and wild, and no energy at all, are unchanged", () => {
    const plain = chooseEffects({ lines, sections, title: "My Time No Late" });
    for (const energy of ["lively", "wild", undefined]) {
      assert.deepEqual(chooseEffects({ lines, sections, title: "My Time No Late", energy }), plain, String(energy));
    }
  });
  test("a line's own choice is still the user's call on calm", () => {
    const own = lines.map((l, i) => (i === 0 ? { ...l, effect: "slam" } : l));
    assert.equal(chooseEffects({ lines: own, sections, title: "x", energy: "calm" })[0], "slam");
  });
});

describe("titleLineIndexes", () => {
  test("by the song title, else the most repeated chorus line", () => {
    const sections = [S("c", "chorus")];
    const lines = [{ sectionId: "c", text: "Na grace carry me" }, { sectionId: "c", text: "Who talk say?" }, { sectionId: "c", text: "Who talk say?" }];
    assert.deepEqual([...titleLineIndexes(lines, "Not In Lyrics", sections)], [1, 2]);
    assert.deepEqual([...titleLineIndexes(lines, "Na grace", sections)], [0]);
  });
});
