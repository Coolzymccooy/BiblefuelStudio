import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { projectFromMarkdown } from "./model.js";
import { filmableVisual, montageSubjects, promptForShot, shotSpans, planShots, DEFAULT_LEAD_MAN } from "./shots.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const GRACE = fs.readFileSync(path.join(here, "__fixtures__", "grace-made-me.md"), "utf8");

describe("filmableVisual", () => {
  test("drops what a camera cannot film", () => {
    assert.equal(
      filmableVisual("Sunlight breaks through the clouds. A figure stands with arms raised as the music begins to swell."),
      "Sunlight breaks through the clouds. A figure stands with arms raised.",
    );
    assert.equal(
      filmableVisual("Beautiful golden sunrise over a peaceful landscape. Music softens to piano and choir."),
      "Beautiful golden sunrise over a peaceful landscape.",
    );
  });
});

describe("montageSubjects", () => {
  test("splits a montage into one subject per shot", () => {
    assert.deepEqual(
      montageSubjects("A cinematic montage of a mother caring for her children, a young man working late, a woman graduating, and a worshipper lifting their hands."),
      ["a mother caring for her children", "a young man working late", "a woman graduating", "a worshipper lifting their hands"],
    );
  });
  test("returns nothing for an ordinary visual", () => {
    assert.deepEqual(montageSubjects("A man walks into the light."), []);
  });
});

describe("promptForShot", () => {
  test("puts the lead in place of the man and keeps a capital", () => {
    const p = promptForShot({ text: "A man standing alone in the darkness.", lead: "a tall woman in blue", style: "STYLE", peopleNote: "" });
    assert.equal(p, "A tall woman in blue standing alone in the darkness. STYLE");
  });
  test("never puts the lead into a montage subject", () => {
    const p = promptForShot({ text: "a young man working late", lead: "the lead", montage: true, style: "", peopleNote: "" });
    assert.equal(p, "A young man working late.");
  });
});

describe("planShots on the fixture", () => {
  const project = projectFromMarkdown(GRACE);

  test("defaults the lead to the prototype's man", () => {
    assert.equal(project.look.lead, DEFAULT_LEAD_MAN);
  });

  test("gives every scene at least one shot and the montage one shot per subject", () => {
    for (const s of project.scenes) assert.ok(project.shots.some((x) => x.sceneId === s.id), s.id);
    const montage = project.shots.filter((x) => x.sceneId === "s4");
    assert.equal(montage.length, 4);
    assert.ok(montage.every((x) => x.montage));
  });

  test("starts shots at distinct lines of their own scene, in order", () => {
    const order = project.lines.map((l) => l.id);
    let last = -1;
    for (const shot of project.shots) {
      const idx = order.indexOf(shot.startLineId);
      assert.ok(idx > last, `${shot.id} out of order`);
      assert.equal(project.lines[idx].sceneId, shot.sceneId);
      last = idx;
    }
  });

  test("marks a shot suggested when its scene has no visual", () => {
    const shots = planShots({ scenes: [{ id: "s1", title: "Opening", visual: "", targetStart: 0, targetEnd: 5 }], lines: [{ id: "l1", sceneId: "s1", text: "Hello" }] });
    assert.equal(shots[0].suggested, true);
  });
});

describe("shotSpans", () => {
  test("covers the whole video with no gaps", () => {
    const timeline = { total: 20, lines: [{ id: "a", start: 1.6 }, { id: "b", start: 8 }, { id: "c", start: 14 }] };
    const spans = shotSpans([{ id: "x", startLineId: "a" }, { id: "y", startLineId: "b" }, { id: "z", startLineId: "c", offsetSec: 1 }], timeline);
    assert.deepEqual(spans, [
      { id: "x", from: 0, to: 7.75, seconds: 7.75 },
      { id: "y", from: 7.75, to: 14.75, seconds: 7 },
      { id: "z", from: 14.75, to: 20, seconds: 5.25 },
    ]);
  });

  test("keeps shots in order and at least a second long when offsets cross", () => {
    const timeline = { total: 20, lines: [{ id: "a", start: 1.6 }, { id: "b", start: 8 }, { id: "c", start: 9 }] };
    const spans = shotSpans([{ id: "x", startLineId: "a" }, { id: "y", startLineId: "b", offsetSec: 10 }, { id: "z", startLineId: "c" }], timeline);
    for (const s of spans) assert.ok(s.seconds >= 1, `${s.id} is ${s.seconds} s`);
    assert.ok(spans.every((s, i) => i === 0 || s.from === spans[i - 1].to));
    assert.equal(spans.at(-1).to, 20);
  });
});
