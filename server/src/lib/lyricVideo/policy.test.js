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
  test("the chorus frames its title line and the response echoes", () => {
    assert.equal(fx[8], "frame");
    assert.equal(fx[7], "echo"); // §6.1: a response is an echo, not a pop
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
      else if (wild[i] === "title") assert.equal(fx, "pop", `line ${i}`); // §6.1: calm's pools are pop and stack, so a title card steps down to pop
      else assert.equal(fx, wild[i], `line ${i} is unchanged`);
    });
  });
  test("wild, and no energy at all, are unchanged", () => {
    const plain = chooseEffects({ lines, sections, title: "My Time No Late" });
    assert.deepEqual(chooseEffects({ lines, sections, title: "My Time No Late", energy: "wild" }), plain);
  });
  test("lively is the wild plan with the frame made a slam, and the slam gap kept", () => {
    // §6.1: lively's pools have no frame. The frame (line 5) becomes a slam, and that new slam
    // pushes the next one (line 6, "Who talk say?", under 4 s later) down to a stack.
    const wild = chooseEffects({ lines, sections, title: "My Time No Late" });
    const lively = chooseEffects({ lines, sections, title: "My Time No Late", energy: "lively" });
    assert.equal(wild[5], "frame");
    assert.equal(lively[5], "slam");
    assert.equal(wild[6], "slam");
    assert.equal(lively[6], "stack");
    lively.forEach((fx, i) => { if (i !== 5 && i !== 6) assert.equal(fx, wild[i], `line ${i} is unchanged`); });
  });
  test("a line's own choice is still the user's call on calm", () => {
    const own = lines.map((l, i) => (i === 0 ? { ...l, effect: "slam" } : l));
    assert.equal(chooseEffects({ lines: own, sections, title: "x", energy: "calm" })[0], "slam");
  });
});

describe("Phase 2 direction (§6.1, §6.2)", () => {
  const SECTIONS = [{ id: "s1", kind: "chorus" }, { id: "s2", kind: "verse" }];
  const mk = (id, sectionId, kind, text, start, effect = "auto") => ({ id, sectionId, kind, text, start, end: start + 1.5, effect });
  const song = [
    mk("l1", "s1", "lead", "Who talk say", 10),
    mk("l2", "s1", "response", "(WHO TALK SAY?!)", 11.7),
    mk("l3", "s1", "lead", "My time no late, my time no late", 14),
    mk("l4", "s2", "lead", "Everywhere you go", 40),
    mk("l5", "s2", "lead", "Everybody get pain", 42),
    mk("l6", "s2", "lead", "Some dey work double shift", 44),
  ];

  test("an Auto response becomes echo, in every energy", () => {
    for (const energy of ["calm", "lively", "wild"]) {
      assert.equal(chooseEffects({ lines: song, sections: SECTIONS, title: "My Time No Late", energy })[1], "echo");
    }
  });

  test("a call before an echo leaves the lower band", () => {
    // The verse alternation makes the second line pop; a chorus slam becomes pop on calm.
    const verse = [mk("a", "s2", "lead", "Everywhere you go", 5), mk("b", "s2", "lead", "Everybody get pain", 7), mk("c", "s2", "response", "(PAIN!)", 9)];
    const chorus = [mk("d", "s1", "lead", "Who talk say", 20), mk("e", "s1", "response", "(WHO TALK SAY?!)", 21.5)];
    for (const energy of ["calm", "lively", "wild"]) {
      for (let seed = 1; seed <= 5; seed++) {
        assert.ok(!["pop", "quote"].includes(chooseEffects({ lines: verse, sections: SECTIONS, title: "x", energy, seed })[1]), `${energy}/${seed}`);
        assert.ok(!["pop", "quote"].includes(chooseEffects({ lines: chorus, sections: SECTIONS, title: "x", energy, seed })[0]), `${energy}/${seed}`);
      }
    }
  });

  test("lively turns a frame into a slam only when the slam guards allow it", () => {
    const lines = [mk("a", "s1", "lead", "My time no late", 10), mk("b", "s1", "lead", "Go go", 11)];
    const out = chooseEffects({ lines, sections: SECTIONS, title: "My Time No Late", energy: "lively" });
    assert.equal(out[0], "slam"); // the title line would frame on wild
    assert.notEqual(out[1], "slam"); // within 4 s of that slam
  });

  test("lively has no frame; calm keeps only pop, stack and echo", () => {
    const lively = chooseEffects({ lines: song, sections: SECTIONS, title: "My Time No Late", energy: "lively" });
    assert.ok(!lively.includes("frame"));
    const calm = chooseEffects({ lines: song, sections: SECTIONS, title: "My Time No Late", energy: "calm" });
    assert.ok(calm.every((e) => ["pop", "stack", "echo"].includes(e)), calm.join());
  });

  test("seed 1 is today's output; another seed can start a section's alternation on pop", () => {
    const base = chooseEffects({ lines: song, sections: SECTIONS, title: "My Time No Late", energy: "wild" });
    assert.deepEqual(chooseEffects({ lines: song, sections: SECTIONS, title: "My Time No Late", energy: "wild", seed: 1 }), base);
    const verseStarts = new Set();
    for (let seed = 1; seed <= 20; seed++) verseStarts.add(chooseEffects({ lines: song, sections: SECTIONS, title: "My Time No Late", energy: "wild", seed })[3]);
    assert.deepEqual([...verseStarts].sort(), ["pop", "stack"]);
  });

  test("a seed never changes a line's own choice", () => {
    const own = song.map((l, i) => (i === 3 ? { ...l, effect: "curve" } : l));
    for (let seed = 1; seed <= 10; seed++) {
      for (const energy of ["calm", "lively", "wild"]) {
        assert.equal(chooseEffects({ lines: own, sections: SECTIONS, title: "x", energy, seed })[3], "curve");
      }
    }
  });

  test("the same seed gives the same plan", () => {
    const a = chooseEffects({ lines: song, sections: SECTIONS, title: "My Time No Late", energy: "wild", seed: 7 });
    const b = chooseEffects({ lines: song, sections: SECTIONS, title: "My Time No Late", energy: "wild", seed: 7 });
    assert.deepEqual(a, b);
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
