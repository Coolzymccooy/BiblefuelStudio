import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { projectFromMarkdown } from "./model.js";
import { suggestShotPrompts, directorPrompt, parseSuggestions } from "./shotDirector.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const project = projectFromMarkdown(fs.readFileSync(path.join(here, "__fixtures__", "grace-made-me.md"), "utf8"));

describe("shot director", () => {
  test("briefs the model with the lead, the rules and the spoken words", async () => {
    let seen = "";
    await suggestShotPrompts(project, { shotIds: ["sh1"], llm: async (p) => { seen = p; return "[]"; } });
    assert.match(seen, /Black Nigerian man in his late thirties/);
    assert.match(seen, /Look at me today/);
    assert.match(seen, /copyright/);
    assert.doesNotMatch(seen, /Music softens/);
  });

  test("returns prompts with the style line, only for the shots asked", async () => {
    const r = await suggestShotPrompts(project, {
      shotIds: ["sh1", "sh2"],
      llm: async () => 'Here you go: [{"id":"sh1","prompt":"In a dark room, he stands in a beam of light."},{"id":"sh99","prompt":"x"}]',
    });
    assert.ok(r.ok);
    assert.deepEqual(Object.keys(r.prompts), ["sh1"]);
    assert.match(r.prompts.sh1, /beam of light\. Cinematic film still/);
  });

  test("reports a failure when nothing usable comes back", async () => {
    const r = await suggestShotPrompts(project, { llm: async () => "sorry" });
    assert.equal(r.ok, false);
  });

  test("ignores malformed JSON", () => {
    assert.deepEqual(parseSuggestions("[{bad json}]", ["sh1"]), {});
  });

  test("tells the model a montage subject is someone else", () => {
    const brief = directorPrompt(project, [{ id: "sh10", montageSubject: true, visual: "a young man working late" }]);
    assert.match(brief, /montage subject is a different person/);
  });
});
