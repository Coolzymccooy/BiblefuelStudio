import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { suggestTemplate } from "./suggestTemplate.js";

describe("suggestTemplate", () => {
  test("defaults to the 30-minute sleep session", () => {
    assert.equal(suggestTemplate("psalms about rest").templateId, "sleep-30");
  });
  test("an hour cue picks sleep-60 and says why", () => {
    const r = suggestTemplate("an hour of scripture for the night shift");
    assert.equal(r.templateId, "sleep-60");
    assert.match(r.reason, /hour/i);
  });
  test("empty input still returns a valid template", () => {
    assert.equal(suggestTemplate("").templateId, "sleep-30");
  });
});
