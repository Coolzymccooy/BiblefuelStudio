import test from "node:test";
import assert from "node:assert/strict";
import { generateScripts } from "./generateScripts.js";

test("generateScripts supports scriptType and keeps hashtags separate from speakable fields", async () => {
  const oldOpenAi = process.env.OPENAI_API_KEY;
  const oldGemini = process.env.GEMINI_API_KEY;
  const oldOpencode = process.env.OPENCODE_ENABLED;
  process.env.OPENAI_API_KEY = "your-openai-key";
  process.env.GEMINI_API_KEY = "your-gemini-key";
  process.env.OPENCODE_ENABLED = "false";

  try {
    const scripts = await generateScripts({
      niche: "Christian encouragement",
      tone: "warm",
      count: 1,
      lengthSeconds: 20,
      includeVerseReference: true,
      ctaStyle: "save",
      scriptType: "strength",
    });

    assert.equal(scripts.length, 1);
    const script = scripts[0];
    assert.match(script.title, /Strength|Biblefuel/);
    for (const key of ["hook", "verse", "reference", "reflection", "cta"]) {
      assert.equal(/[#*`]/.test(script[key] || ""), false, `${key} should be speakable-clean`);
    }
    assert.ok(Array.isArray(script.hashtags));
    assert.ok(script.hashtags.every((h) => h.startsWith("#")));
  } finally {
    if (oldOpenAi === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldOpenAi;
    if (oldGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldGemini;
    if (oldOpencode === undefined) delete process.env.OPENCODE_ENABLED; else process.env.OPENCODE_ENABLED = oldOpencode;
  }
});
