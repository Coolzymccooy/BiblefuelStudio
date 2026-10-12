import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OCCASIONS, OCCASION_IDS, resolveOccasion, statementLimit, templatesFor, LENGTHS, TITLE_MAX, STATEMENT_MAX, DETAIL_FIELDS,
} from "./occasions.js";
import { STYLE_IDS } from "../motion/styles.js";
import { resolveLibraryTrack } from "../musicLibrary.js";

test("the eight occasions", () => {
  assert.deepEqual(OCCASION_IDS, ["birthday", "anniversary", "wedding", "sermon", "event", "thanksgiving", "memorial", "fun"]);
});

test("every occasion's defaults are real: a style, an Energy, a bundled song", () => {
  for (const o of Object.values(OCCASIONS)) {
    assert.ok(STYLE_IDS.includes(o.style), o.id);
    assert.ok(o.energy >= 0 && o.energy <= 1, o.id);
    assert.ok(resolveLibraryTrack(o.song), `${o.id}: ${o.song}`);
    assert.ok(o.fields.every((f) => DETAIL_FIELDS.includes(f)), o.id);
    assert.ok(o.titles.length >= 1 && o.statements.length >= 3, o.id);
  }
});

test("birthday is Celebrate at 0.8 and memorial is Glow at 0.15", () => {
  assert.equal(OCCASIONS.birthday.style, "celebrate");
  assert.equal(OCCASIONS.birthday.energy, 0.8);
  assert.equal(OCCASIONS.memorial.style, "glow");
  assert.equal(OCCASIONS.memorial.energy, 0.15);
});

test("church occasions are marked", () => {
  assert.deepEqual(OCCASION_IDS.filter((id) => OCCASIONS[id].church), ["wedding", "sermon", "event", "thanksgiving", "memorial"]);
});

test("statement limits follow the length", () => {
  assert.deepEqual(LENGTHS.map(statementLimit), [3, 5, 8]);
  // The engine's rule: the nearest limit at or below the length, at least 3.
  assert.equal(statementLimit(999), 8);
  assert.equal(statementLimit(10), 3);
});

test("the word limits are the engine's own, not a copy", async () => {
  const engine = await import("../motion/director.js");
  assert.equal(statementLimit, engine.statementLimit);
  assert.equal(TITLE_MAX, engine.TITLE_MAX);
  assert.equal(STATEMENT_MAX, engine.STATEMENT_MAX);
});

test("templates fill the details and drop lines whose details are missing", () => {
  const full = templatesFor("birthday", { name: "Tolu", milestone: "40 years" }, 30);
  assert.equal(full.title, "Happy birthday, Tolu!");
  assert.ok(full.statements.includes("40 years and still rising"));
  const bare = templatesFor("birthday", {}, 30);
  assert.equal(bare.title, "Happy birthday!");
  assert.ok(bare.statements.every((s) => !s.includes("{")));
  assert.ok(!bare.statements.some((s) => s.includes("still rising")));
});

test("templates respect the length's limit and the character limits", () => {
  for (const id of OCCASION_IDS) {
    for (const len of LENGTHS) {
      const t = templatesFor(id, { name: "A".repeat(80), eventTitle: "E".repeat(80), date: "Sunday", venue: "Grace Hall" }, len);
      assert.ok(t.title.length > 0 && t.title.length <= TITLE_MAX, `${id} title`);
      assert.ok(t.statements.length <= statementLimit(len) && t.statements.length >= 1, `${id}@${len}`);
      assert.ok(t.statements.every((s) => s.length <= STATEMENT_MAX), `${id} statements`);
    }
  }
});

test("no occasion's fallback title repeats its first statement (every length)", () => {
  for (const id of OCCASION_IDS) {
    for (const len of LENGTHS) {
      const t = templatesFor(id, {}, len);
      assert.notEqual(t.title, t.statements[0], `${id}@${len}`);
    }
  }
});

test("unknown occasions resolve to null, ignoring the prototype chain", () => {
  assert.equal(resolveOccasion("constructor"), null);
  assert.equal(resolveOccasion("party"), null);
  assert.equal(resolveOccasion("birthday").id, "birthday");
});
