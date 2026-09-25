import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SCRIPT_TEMPLATES, templateById } from "./scriptTemplates.js";

describe("scriptTemplates", () => {
  test("has the 5 templates incl. custom", () => {
    assert.equal(SCRIPT_TEMPLATES.length, 5);
    assert.ok(SCRIPT_TEMPLATES.find((t) => t.id === "custom"));
    for (const t of SCRIPT_TEMPLATES) {
      assert.ok(t.id && t.label);
      assert.ok(t.targetSeconds > 0);
      assert.equal(typeof t.prompt, "string");
    }
  });
  test("templateById returns the match, or custom for unknown", () => {
    assert.equal(templateById("teaching-60").id, "teaching-60");
    assert.equal(templateById("nope").id, "custom");
    assert.equal(templateById(undefined).id, "custom");
  });
});
