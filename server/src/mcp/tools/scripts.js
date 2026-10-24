import { z } from "zod";
import { ok, fail, withoutOk } from "../toolResult.js";

const SCRIPT_TYPES = ["peace", "strength", "anxiety", "identity", "prayer", "gratitude", "forgiveness", "purpose", "healing", "custom"];
const CTA_STYLES = ["save", "follow", "share", "comment"];
const BIBLE_MODES = ["translations", "parse", "verse"];

/** A copy of `fields` without undefined values, so the route's own defaults fill the gaps. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

const scriptsGenerate = {
  name: "scripts_generate",
  title: "Generate short Bible scripts",
  description:
    "Write short faceless-video scripts (hook, verse, reference, reflection, call to action, hashtags) for Bible content. " +
    "Every field is optional; leave one out and the app's default applies (10 scripts of about 20 seconds, peace, save). " +
    "Counts against your plan's daily scripts quota; there is no agent daily cap for it. " +
    "Uses a language model when the server has one, otherwise built-in verse templates, and takes a few seconds. " +
    "Returns { scripts }. Next: voice_synthesize on a script's text, or bible_lookup to check a verse.",
  inputSchema: {
    niche: z.string().max(200).optional().describe("The content niche. Default: Christian / Bible encouragement."),
    tone: z.string().max(200).optional().describe("The tone of voice. Default: warm, encouraging, simple."),
    count: z.number().int().min(1).max(100).optional().describe("How many scripts, 1 to 100. Default 10."),
    lengthSeconds: z.number().int().min(8).max(90).optional().describe("Target spoken length of each script in seconds, 8 to 90. Default 20."),
    includeVerseReference: z.boolean().optional().describe("Include a Bible reference such as John 3:16. Default true."),
    ctaStyle: z.enum(CTA_STYLES).optional().describe("The call to action at the end. Default save."),
    scriptType: z.enum(SCRIPT_TYPES).optional().describe("The theme. Use custom together with customPrompt. Default peace."),
    customPrompt: z.string().max(300).optional().describe("Your own theme brief, used when scriptType is custom. Up to 300 characters."),
  },
  routes: ["/api/scripts"],
  async handler(ctx, input) {
    const body = await ctx.api.call("POST", "/api/scripts/generate", { body: defined(input) });
    return ok({ scripts: Array.isArray(body?.scripts) ? body.scripts : [] });
  },
};

const bibleLookup = {
  name: "bible_lookup",
  title: "Look up Bible verses",
  description:
    "Three lookups in one tool, chosen by mode. " +
    "mode verse: the text of a reference (reference required; translation optional, default kjv) with the source and a YouVersion link. " +
    "mode parse: check and normalise a reference such as 'jn 3:16' into book, chapter and verses (reference required). " +
    "mode translations: the supported translations; call it first if unsure which translation ids exist. " +
    "Free, instant, and not counted against any quota. A reference that cannot be parsed or has no verses is a tool error.",
  inputSchema: {
    mode: z.enum(BIBLE_MODES).describe("verse, parse or translations."),
    reference: z.string().max(80).optional().describe("A Bible reference such as John 3:16 or Psalm 23:1-3. Required for verse and parse."),
    translation: z.string().max(20).optional().describe("A translation id from mode translations, for example kjv or niv. Default kjv."),
  },
  routes: ["/api/bible"],
  async handler(ctx, { mode, reference, translation }) {
    if (mode === "translations") {
      return ok(withoutOk(await ctx.api.call("GET", "/api/bible/translations")));
    }
    if (!String(reference || "").trim()) {
      return fail("BAD_INPUT", `reference is required for mode ${mode}.`);
    }
    const query = defined({ reference, translation });
    return ok(withoutOk(await ctx.api.call("GET", `/api/bible/${mode}`, { query })));
  },
};

export default [scriptsGenerate, bibleLookup];
