# Moments Server (Moments Phase 1, plan B of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Moments server: occasions, AI statements, the per-user project store, photo and song resolution, a beat-analysis cache, the background render stage, and the `/api/moments` routes, on top of the motion engine from plan A.

**Architecture:** This follows the Ambient mode's proven pattern:
- One JSON file per project under the user's data directory.
- A detached render stage inside `runExclusive`, tracked with `renderJobs`.
- Quota charged inline after validation, so polling `GET /:id` never spends it.

Statements reuse the Story LLM helper (`defaultLlmComplete`). The voiceover reuses Edge TTS exactly as Story's `/script-to-audio` does.

**Tech Stack:** Node 20 ESM, Express, `node:test` and supertest. It uses the motion engine in `server/src/lib/motion/` (plan A, already merged on this branch).

**Spec:** `docs/superpowers/specs/2026-10-12-moments-motion-engine-design.md`

## Global Constraints

- **Lengths and limits:**
  - Lengths are 15, 30 or 60 s.
  - 3 to 20 photos.
  - Title ≤ 40 characters, statements ≤ 60 characters, at most 8 statements. Each detail field ≤ 80 characters.
  - Statements per length: 15 s → max 3, 30 s → max 5, 60 s → max 8 (title excluded).
- **Photos:** each must be the user's own upload (resolved only through `resolveOwnUpload`) or a library item. Limits: ≤ 25 MB, side ≤ 8192, ≤ 40 MP.
- **Quota:**
  - No new buckets. Statements charge `scripts`, the voiceover charges `tts`, and a render (including Shuffle) charges `render`.
  - Charge only after validation, via the inline `charged()` pattern from `routes/ambient.js`.
  - Polling never charges.
- **Rendering:**
  - A second render while one runs returns 409.
  - Renders run inside `runExclusive` (`lib/heavyJobGate.js`) and use `lib/renderJobs.js`.
- **AI statements:**
  - Use OpenAI `gpt-4o-mini` with a Gemini `gemini-2.0-flash` fallback, via `defaultLlmComplete` from `lib/story/scriptRefine.js`.
  - Time out after 15 s, then fall back to the occasion's templates.
  - Verse text is never taken from the LLM. Only a reference is accepted; it is checked with `normalizeReference` and the text fetched with `lookupVerses(reference, 'kjv')`.
- **Isolation:** every read and write is scoped to `req.ctx`. Another user's project id answers 404.
- **Writing code:** write code containing backslashes or regexes with the Write/Edit tools, never shell heredocs.
- **Commits:**
  - Run `git add` and `git commit` as separate commands. Never use `--no-verify`.
  - Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests:** run them from `server/` with `node --test <file>`. The full suite is `npm test`.

## Review Focus

1. **A user deletes an uploaded photo (or its library item) after adding it.** The render must skip it and say so, not fail. If fewer than 3 usable photos remain, it fails with "Need at least 3 readable photos". → Task 6 tests.
2. **A user double-taps Make it.** The second request gets 409, and the quota is charged once. → Task 7 test.
3. **The server restarts mid-render.** `GET /:id` must report `interrupted`, not show "running" forever. → Task 7 test.
4. **The LLM returns prose, a code fence, or a verse it made up.** The statements are still clean and clamped, and the verse text comes from the lookup or is dropped. → Task 2 tests.
5. **A user switches from 60 s to 15 s while holding 8 statements.** The render uses only the first 3; nothing errors. → Task 6 test.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/src/lib/moments/occasions.js` | Occasions: labels, detail fields, defaults (style, Energy, song), title/statement templates; length limits. |
| `server/src/lib/moments/statements.js` | `suggestStatements`: LLM JSON with clamps, verse via lookup, template fallback. |
| `server/src/lib/moments/projectStore.js` | One JSON per project under `<dataDir>/moments/`: create, read, write, list, delete, `applyUpdate` validation, `withHistory`. |
| `server/src/lib/moments/photos.js` | `resolvePhoto(s)`: an upload or library ref → file, size, URL, with all image checks. `resolveSong`. |
| `server/src/lib/moments/beatCache.js` | `songGrid` (cached envelope per content hash) and `voiceGrid`. |
| `server/src/lib/moments/renderStage.js` | The background render: prepare → analyse → direct → render → history. |
| `server/src/routes/moments.js` | `/api/moments` routes. |
| `server/index.js` | Mount the router. |

---

### Task 1: Occasions and templates

**Files:**
- Create: `server/src/lib/moments/occasions.js`
- Test: `server/src/lib/moments/occasions.test.js`

**Interfaces:**
- Consumes: `STYLE_IDS` from `../motion/styles.js`.
- Produces:
  - `LENGTHS = [15, 30, 60]`.
  - `STATEMENT_LIMIT = {15: 3, 30: 5, 60: 8}`.
  - `TITLE_MAX = 40`, `STATEMENT_MAX = 60`, `DETAIL_MAX = 80`, `MAX_STATEMENTS = 8`.
  - `DETAIL_FIELDS = ['name','milestone','eventTitle','date','venue','verse']`.
  - `OCCASIONS`: frozen map id → `{ id, label, church, fields, style, energy, song, titles: string[], statements: string[], voicePrompt }`.
  - `OCCASION_IDS`.
  - `resolveOccasion(id)` (own keys only, else `null`).
  - `statementLimit(lengthSec)`.
  - `templatesFor(occasionId, details, lengthSec) → { title, statements }`.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/moments/occasions.test.js`:

```js
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
  assert.equal(statementLimit(999), 3);
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

test("unknown occasions resolve to null, ignoring the prototype chain", () => {
  assert.equal(resolveOccasion("constructor"), null);
  assert.equal(resolveOccasion("party"), null);
  assert.equal(resolveOccasion("birthday").id, "birthday");
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/moments/occasions.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `occasions.js`**

`server/src/lib/moments/occasions.js`:

```js
/**
 * What a Moment is for. Each occasion picks the defaults that make one tap
 * work (style, Energy, a bundled song) and carries template statements used
 * whenever the AI is unavailable, so a user always gets editable text.
 */
export const LENGTHS = Object.freeze([15, 30, 60]);
export const STATEMENT_LIMIT = Object.freeze({ 15: 3, 30: 5, 60: 8 });
export const TITLE_MAX = 40;
export const STATEMENT_MAX = 60;
export const DETAIL_MAX = 80;
export const MAX_STATEMENTS = 8;
export const DETAIL_FIELDS = Object.freeze(["name", "milestone", "eventTitle", "date", "venue", "verse"]);

const o = (def) => Object.freeze({ ...def, fields: Object.freeze(def.fields), titles: Object.freeze(def.titles), statements: Object.freeze(def.statements) });

export const OCCASIONS = Object.freeze({
  birthday: o({
    id: "birthday", label: "Birthday", church: false, fields: ["name", "milestone"],
    style: "celebrate", energy: 0.8, song: "library:gospel-fire",
    titles: ["Happy birthday, {name}!", "Happy birthday!"],
    statements: ["Another year of grace", "{milestone} and still rising", "Favour looks good on you", "God's not done with you", "Celebrate!"],
    voicePrompt: "A warm, joyful birthday blessing.",
  }),
  anniversary: o({
    id: "anniversary", label: "Anniversary", church: false, fields: ["name", "milestone"],
    style: "glow", energy: 0.4, song: "library:hopeful",
    titles: ["Happy anniversary, {name}", "Happy anniversary"],
    statements: ["{milestone} of love", "Still choosing each other", "What God joined together", "Here's to forever"],
    voicePrompt: "A tender anniversary blessing for a couple.",
  }),
  wedding: o({
    id: "wedding", label: "Wedding", church: true, fields: ["name", "date", "venue", "verse"],
    style: "glow", energy: 0.5, song: "library:inspiring-cinematic",
    titles: ["{name}", "Just married"],
    statements: ["Two hearts, one covenant", "Love is patient, love is kind", "{date}", "The best is yet to come"],
    voicePrompt: "A joyful wedding blessing.",
  }),
  sermon: o({
    id: "sermon", label: "Sermon / service promo", church: true, fields: ["eventTitle", "date", "venue", "verse"],
    style: "gallery", energy: 0.5, song: "library:cinematic-inspirational",
    titles: ["{eventTitle}", "This Sunday"],
    statements: ["This Sunday", "{date}", "{venue}", "Come expectant", "Bring someone"],
    voicePrompt: "An inviting promo for a church service.",
  }),
  event: o({
    id: "event", label: "Church event", church: true, fields: ["eventTitle", "date", "venue", "verse"],
    style: "gallery", energy: 0.6, song: "library:epic-anthem",
    titles: ["{eventTitle}", "Save the date"],
    statements: ["Save the date", "{date}", "{venue}", "Don't miss it"],
    voicePrompt: "An exciting invitation to a church event.",
  }),
  thanksgiving: o({
    id: "thanksgiving", label: "Thanksgiving", church: true, fields: ["name", "verse"],
    style: "celebrate", energy: 0.6, song: "library:gospel-praise",
    titles: ["Thank you, Lord", "Thanksgiving"],
    statements: ["Grateful for {name}", "His mercies are new", "Give thanks with a grateful heart", "Glory to God"],
    voicePrompt: "A heartfelt thanksgiving to God.",
  }),
  memorial: o({
    id: "memorial", label: "Memorial", church: true, fields: ["name", "date", "verse"],
    style: "glow", energy: 0.15, song: "library:prayer-piano",
    titles: ["In loving memory of {name}", "In loving memory"],
    statements: ["Forever in our hearts", "A life well lived", "Present with the Lord", "Rest in perfect peace"],
    voicePrompt: "A gentle, comforting tribute in memory of a loved one.",
  }),
  fun: o({
    id: "fun", label: "Just for fun", church: false, fields: ["name"],
    style: "hype", energy: 0.85, song: "library:gospel-revival",
    titles: ["{name}", "Blessed"],
    statements: ["Good vibes only", "Blessed and grateful", "Living the moment", "Let's go!"],
    voicePrompt: "A fun, upbeat faith-filled shout-out.",
  }),
});

export const OCCASION_IDS = Object.freeze(Object.keys(OCCASIONS));

export function resolveOccasion(id) {
  return typeof id === "string" && Object.hasOwn(OCCASIONS, id) ? OCCASIONS[id] : null;
}

export function statementLimit(lengthSec) {
  return STATEMENT_LIMIT[lengthSec] ?? STATEMENT_LIMIT[15];
}

/** A template with every {field} filled, or null when one is missing. Too long for `max` is null too. */
function fill(template, details, max) {
  let missing = false;
  const text = template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = String(details?.[key] ?? "").trim();
    if (!v) missing = true;
    return v;
  }).trim();
  return missing || !text || text.length > max ? null : text;
}

export function templatesFor(occasionId, details = {}, lengthSec = 15) {
  const occ = resolveOccasion(occasionId) || OCCASIONS.fun;
  const title = occ.titles.map((t) => fill(t, details, TITLE_MAX)).find(Boolean) || occ.label.slice(0, TITLE_MAX);
  const statements = occ.statements
    .map((s) => fill(s, details, STATEMENT_MAX))
    .filter(Boolean)
    .slice(0, statementLimit(lengthSec));
  return { title, statements: statements.length ? statements : [occ.label.slice(0, STATEMENT_MAX)] };
}
```

The last title in every occasion has no placeholder, so `title` is always filled. If an 80-character name pushes the first title over 40 characters, `fill` returns null and the plain title wins.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/moments/occasions.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/moments/occasions.js server/src/lib/moments/occasions.test.js
```

```bash
git commit -m "feat: Moments occasions, defaults and template statements

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: AI statement suggestions

**Files:**
- Create: `server/src/lib/moments/statements.js`
- Test: `server/src/lib/moments/statements.test.js`

**Interfaces:**
- Consumes:
  - `defaultLlmComplete` from `../story/scriptRefine.js`;
  - `normalizeReference` from `../bible/bibleReference.js`;
  - `lookupVerses` from `../bible/scriptureApi.js`;
  - Task 1's `resolveOccasion`, `statementLimit`, `templatesFor`, `TITLE_MAX`, `STATEMENT_MAX`.
- Produces:
  - `AI_TIMEOUT_MS = 15000`.
  - `suggestStatements({ occasion, details, lengthSec, timeoutMs? }) → Promise<{ title, statements: string[], verse?: { reference, text }, source: 'ai'|'template' }>`.
  - Seams: `_setLlmImpl`, `_resetLlmImpl`, `_setLookupImpl`, `_resetLookupImpl`.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/moments/statements.test.js`:

```js
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { suggestStatements, _setLlmImpl, _resetLlmImpl, _setLookupImpl, _resetLookupImpl } from "./statements.js";

afterEach(() => { _resetLlmImpl(); _resetLookupImpl(); });

const json = (o) => JSON.stringify(o);

test("AI JSON becomes clean, clamped statements", async () => {
  let prompt = "";
  _setLlmImpl(async (p) => {
    prompt = p;
    return json({ title: "Happy 40th, Tolu!", statements: ["40 years of grace", "Still rising", "  ", "x".repeat(80), "Celebrate", "Extra", "More"], verseReference: "" });
  });
  const s = await suggestStatements({ occasion: "birthday", details: { name: "Tolu", milestone: "40th" }, lengthSec: 15 });
  assert.equal(s.source, "ai");
  assert.equal(s.title, "Happy 40th, Tolu!");
  assert.deepEqual(s.statements, ["40 years of grace", "Still rising", "Celebrate"]);
  assert.match(prompt, /Tolu/);
  assert.match(prompt, /3 statements/);
  assert.equal(s.verse, undefined, "birthday is not a church occasion");
});

test("JSON inside a code fence or prose is still read", async () => {
  _setLlmImpl(async () => "Here you go:\n```json\n" + json({ title: "T", statements: ["A", "B"] }) + "\n```");
  const s = await suggestStatements({ occasion: "fun", details: {}, lengthSec: 30 });
  assert.equal(s.source, "ai");
  assert.deepEqual(s.statements, ["A", "B"]);
});

test("malformed output falls back to the occasion's templates", async () => {
  _setLlmImpl(async () => "I cannot help with that.");
  const s = await suggestStatements({ occasion: "birthday", details: { name: "Tolu" }, lengthSec: 15 });
  assert.equal(s.source, "template");
  assert.equal(s.title, "Happy birthday, Tolu!");
  assert.ok(s.statements.length >= 1 && s.statements.length <= 3);
});

test("a timeout falls back to the templates", async () => {
  _setLlmImpl(() => new Promise(() => {}));
  const s = await suggestStatements({ occasion: "memorial", details: { name: "Mama" }, lengthSec: 30, timeoutMs: 30 });
  assert.equal(s.source, "template");
  assert.equal(s.title, "In loving memory of Mama");
});

test("an LLM error falls back to the templates", async () => {
  _setLlmImpl(async () => { throw new Error("network"); });
  const s = await suggestStatements({ occasion: "sermon", details: { eventTitle: "Fire Night" }, lengthSec: 15 });
  assert.equal(s.source, "template");
  assert.equal(s.title, "Fire Night");
});

test("a too-long AI title falls back to the template title", async () => {
  _setLlmImpl(async () => json({ title: "T".repeat(41), statements: ["One"] }));
  const s = await suggestStatements({ occasion: "birthday", details: { name: "Ada" }, lengthSec: 15 });
  assert.equal(s.title, "Happy birthday, Ada!");
  assert.deepEqual(s.statements, ["One"]);
});

test("church occasions get the verse text from the lookup, never from the LLM", async () => {
  _setLlmImpl(async () => json({ title: "Fire Night", statements: ["Come"], verseReference: "Jn 3:16", verseText: "MADE UP WORDS" }));
  let asked = null;
  _setLookupImpl(async (ref, tr) => { asked = [ref, tr]; return { ok: true, canonical: "John 3:16", verses: [{ text: "For God so loved the world" }] }; });
  const s = await suggestStatements({ occasion: "sermon", details: {}, lengthSec: 30 });
  assert.deepEqual(asked, ["John 3:16", "kjv"]);
  assert.deepEqual(s.verse, { reference: "John 3:16", text: "For God so loved the world" });
});

test("an invalid reference or a failed lookup drops the verse", async () => {
  _setLlmImpl(async () => json({ title: "T", statements: ["A"], verseReference: "Hezekiah 9:99" }));
  _setLookupImpl(async () => { throw new Error("should not be called"); });
  assert.equal((await suggestStatements({ occasion: "sermon", details: {}, lengthSec: 15 })).verse, undefined);
  _setLlmImpl(async () => json({ title: "T", statements: ["A"], verseReference: "John 3:16" }));
  _setLookupImpl(async () => { throw new Error("offline"); });
  assert.equal((await suggestStatements({ occasion: "sermon", details: {}, lengthSec: 15 })).verse, undefined);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/moments/statements.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `statements.js`**

`server/src/lib/moments/statements.js`:

```js
import { defaultLlmComplete } from "../story/scriptRefine.js";
import { normalizeReference } from "../bible/bibleReference.js";
import { lookupVerses } from "../bible/scriptureApi.js";
import { resolveOccasion, statementLimit, templatesFor, TITLE_MAX, STATEMENT_MAX, OCCASIONS } from "./occasions.js";

/**
 * Statement ideas for a Moment. The AI gets 15 s; anything unusable (an
 * error, a timeout, prose instead of JSON) falls back to the occasion's
 * templates, so the user always has editable text. A verse is only ever a
 * reference from the AI: its words come from the Bible lookup.
 */
export const AI_TIMEOUT_MS = 15_000;

let _llm = defaultLlmComplete;
export function _setLlmImpl(impl) { _llm = impl; }
export function _resetLlmImpl() { _llm = defaultLlmComplete; }
let _lookup = lookupVerses;
export function _setLookupImpl(impl) { _lookup = impl; }
export function _resetLookupImpl() { _lookup = lookupVerses; }

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** The first {...} block in the text, parsed; null if there is none or it is not JSON. */
function parseJson(raw) {
  const s = String(raw || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

const tidy = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

function buildPrompt(occ, details, limit) {
  const known = Object.entries(details || {})
    .map(([k, v]) => [k, tidy(v)])
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`);
  return [
    `Write on-screen text for a short ${occ.label.toLowerCase()} photo video for social media.`,
    "Warm, faith-friendly, celebratory where it fits. Plain words, no emojis, no hashtags.",
    `Return a title (at most ${TITLE_MAX} characters) and ${limit} statements (each at most ${STATEMENT_MAX} characters, ideally 2-6 words).`,
    "Use only the details given; never invent facts about the person.",
    occ.church ? "Also suggest one fitting Bible verse reference, like \"Psalm 118:24\" (reference only)." : "Leave verseReference empty.",
    "Details:",
    ...(known.length ? known : ["- none"]),
    "Answer with JSON only: {\"title\": \"...\", \"statements\": [\"...\"], \"verseReference\": \"...\"}",
  ].join("\n");
}

async function verseFor(reference) {
  const ref = tidy(reference);
  if (!ref) return null;
  const parsed = normalizeReference(ref);
  if (!parsed) return null;
  try {
    const looked = await _lookup(parsed.canonical, "kjv");
    const text = tidy((looked?.verses || []).map((v) => v.text).join(" "));
    return text ? { reference: looked.canonical || parsed.canonical, text } : null;
  } catch {
    return null;
  }
}

export async function suggestStatements({ occasion, details = {}, lengthSec = 15, timeoutMs = AI_TIMEOUT_MS }) {
  const occ = resolveOccasion(occasion) || OCCASIONS.fun;
  const limit = statementLimit(lengthSec);
  const fallback = templatesFor(occ.id, details, lengthSec);
  let parsed = null;
  try {
    parsed = parseJson(await withTimeout(Promise.resolve().then(() => _llm(buildPrompt(occ, details, limit))), timeoutMs));
  } catch {
    parsed = null;
  }
  const aiStatements = Array.isArray(parsed?.statements)
    ? parsed.statements.map(tidy).filter((s) => s && s.length <= STATEMENT_MAX).slice(0, limit)
    : [];
  const aiTitle = tidy(parsed?.title);
  const useAi = aiStatements.length > 0;
  const result = {
    title: useAi && aiTitle && aiTitle.length <= TITLE_MAX ? aiTitle : fallback.title,
    statements: useAi ? aiStatements : fallback.statements,
    source: useAi ? "ai" : "template",
  };
  if (occ.church && useAi) {
    const verse = await verseFor(parsed.verseReference);
    if (verse) result.verse = verse;
  }
  return result;
}
```

`normalizeReference("Hezekiah 9:99")` returns null (no such book), so the lookup is never called. That is what the test asserts by throwing from the stub. If `normalizeReference` resolves an unknown book by alias in this codebase, add an explicit check that `parsed.canonical` starts with a known book name from `BIBLE_BOOKS`, and keep the test.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/moments/statements.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/moments/statements.js server/src/lib/moments/statements.test.js
```

```bash
git commit -m "feat: Moments AI statement suggestions with template fallback and looked-up verses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Moments project store

**Files:**
- Create: `server/src/lib/moments/projectStore.js`
- Test: `server/src/lib/moments/projectStore.test.js`

**Interfaces:**
- Consumes: Task 1's constants and `resolveOccasion`; `STYLE_IDS` from `../motion/styles.js`; `normaliseSeed` from `../kinetic/renderCaptions.js`.
- Produces:
  - `HISTORY_KEEP = 20`, `MIN_PHOTOS = 3`, `MAX_PHOTOS = 20`.
  - `createProject(baseDir, { occasion })`. The project shape:

    ```js
    { projectId, createdAt, updatedAt, occasion, details: {}, photos: [], heroIndex: 0,
      sound: { song: { ref, windowStartSec: null } | null, voiceover: { script, voiceId, file } | null },
      title: "", statements: [], style, energy, lengthSec: 15, seed, plan: null,
      render: null | { jobId, status: 'running'|'done'|'error'|'interrupted', percent, stage, file?, error?, notes? },
      history: [] }
    ```

  - A photo entry is `{ ref: { kind: 'upload', path } | { kind: 'library', id }, url, width, height }`.
  - `readProject(baseDir, id) → project | null`.
  - `writeProject(baseDir, project) → project` (sets `updatedAt`; atomic).
  - `listProjects(baseDir) → summaries[]`, newest first: `{ projectId, occasion, title, updatedAt, thumb, lastFile }`.
  - `deleteProject(baseDir, id) → boolean`.
  - `applyUpdate(project, body) → { ok: true, project } | { ok: false, error }`. Validates everything except photo files; `body.photos` must already be resolved entries (Task 4 resolves them).
  - `withHistory(project, entry) → project` (keeps the last 20).
  - `isRendering(project) → boolean`.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/moments/projectStore.test.js`:

```js
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createProject, readProject, writeProject, listProjects, deleteProject, applyUpdate, withHistory, isRendering, HISTORY_KEEP,
} from "./projectStore.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "moments-store-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test("a new Moment takes its occasion's defaults", () => {
  const p = createProject(dir, { occasion: "memorial" });
  assert.equal(p.occasion, "memorial");
  assert.equal(p.style, "glow");
  assert.equal(p.energy, 0.15);
  assert.equal(p.lengthSec, 15);
  assert.deepEqual(p.sound.song, { ref: "library:prayer-piano", windowStartSec: null });
  assert.equal(p.sound.voiceover, null);
  assert.ok(Number.isInteger(p.seed));
  assert.deepEqual(readProject(dir, p.projectId), p);
});

test("ids that could escape the folder are refused", () => {
  assert.equal(readProject(dir, "../../etc/passwd"), null);
  assert.equal(deleteProject(dir, "..%2F..%2Fx"), false);
});

test("list is newest first with a thumbnail and the last render", () => {
  const a = createProject(dir, { occasion: "birthday" });
  const b = createProject(dir, { occasion: "fun" });
  // updatedAt: b's, so the rewrite is strictly newer even within one millisecond.
  writeProject(dir, { ...a, updatedAt: b.updatedAt, title: "A", photos: [{ ref: { kind: "upload", path: "x" }, url: "/outputs/x.jpg", width: 1, height: 1 }], history: [{ jobId: "j", file: "/outputs/moment-1.mp4", createdAt: 1, seed: 1 }] });
  const list = listProjects(dir);
  assert.equal(list[0].projectId, a.projectId, "the most recently written comes first");
  assert.equal(list[0].thumb, "/outputs/x.jpg");
  assert.equal(list[0].lastFile, "/outputs/moment-1.mp4");
  assert.equal(list[1].projectId, b.projectId);
});

test("applyUpdate accepts good fields and clamps Energy", () => {
  const p = createProject(dir, { occasion: "birthday" });
  const r = applyUpdate(p, {
    details: { name: " Tolu ", milestone: "40" }, title: "Happy 40th!", statements: ["One", "Two"],
    style: "hype", energy: 7, lengthSec: 30, heroIndex: 0, seed: 42,
    sound: { song: { ref: "library:hopeful", windowStartSec: 12.5 } },
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.project.details.name, "Tolu");
  assert.equal(r.project.energy, 1);
  assert.equal(r.project.lengthSec, 30);
  assert.equal(r.project.seed, 42);
  assert.deepEqual(r.project.sound.song, { ref: "library:hopeful", windowStartSec: 12.5 });
});

const bad = [
  ["an unknown occasion", { occasion: "party" }, /occasion/],
  ["an unknown style", { style: "disco" }, /style/],
  ["a length of 20", { lengthSec: 20 }, /length/],
  ["a 41-character title", { title: "x".repeat(41) }, /title/],
  ["nine statements", { statements: Array(9).fill("x") }, /statements/],
  ["a 61-character statement", { statements: ["x".repeat(61)] }, /statement/],
  ["an empty statement", { statements: ["ok", "  "] }, /statement/],
  ["an unknown detail", { details: { password: "x" } }, /detail/],
  ["an 81-character detail", { details: { name: "x".repeat(81) } }, /name/],
  ["21 photos", { photos: Array(21).fill({ ref: { kind: "upload", path: "p" }, url: "u", width: 1, height: 1 }) }, /20 photos/],
  ["a hero outside the photos", { heroIndex: 3 }, /hero/],
  ["a negative window", { sound: { song: { ref: "library:hopeful", windowStartSec: -1 } } }, /window/],
];
for (const [name, body, re] of bad) {
  test(`applyUpdate refuses ${name}`, () => {
    const r = applyUpdate(createProject(dir, { occasion: "birthday" }), body);
    assert.equal(r.ok, false);
    assert.match(r.error, re);
  });
}

test("the song can be removed, and the voiceover only cleared, through applyUpdate", () => {
  const p = { ...createProject(dir, { occasion: "fun" }), sound: { song: { ref: "library:hopeful", windowStartSec: null }, voiceover: { script: "s", voiceId: "v", file: "moment-vo-1.mp3" } } };
  const r = applyUpdate(p, { sound: { song: null, voiceover: null } });
  assert.equal(r.ok, true);
  assert.equal(r.project.sound.song, null);
  assert.equal(r.project.sound.voiceover, null);
  const keep = applyUpdate(p, { sound: { voiceover: { script: "injected", voiceId: "x", file: "../../x.mp3" } } });
  assert.equal(keep.ok, false);
  assert.match(keep.error, /voiceover/);
});

test("history keeps the last 20", () => {
  let p = createProject(dir, { occasion: "fun" });
  for (let i = 0; i < 25; i += 1) p = withHistory(p, { jobId: `j${i}`, file: `/outputs/m${i}.mp4`, createdAt: i, seed: i });
  assert.equal(p.history.length, HISTORY_KEEP);
  assert.equal(p.history[0].jobId, "j5");
});

test("isRendering is true only while a render runs", () => {
  const p = createProject(dir, { occasion: "fun" });
  assert.equal(isRendering(p), false);
  assert.equal(isRendering({ ...p, render: { status: "running" } }), true);
  assert.equal(isRendering({ ...p, render: { status: "done" } }), false);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/moments/projectStore.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `projectStore.js`**

`server/src/lib/moments/projectStore.js`:

```js
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { STYLE_IDS } from "../motion/styles.js";
import { normaliseSeed } from "../kinetic/renderCaptions.js";
import {
  resolveOccasion, LENGTHS, TITLE_MAX, STATEMENT_MAX, DETAIL_MAX, MAX_STATEMENTS, DETAIL_FIELDS,
} from "./occasions.js";

/**
 * Moments persistence: one JSON file per project under <dataDir>/moments/,
 * written to a temp file and renamed so a crash never leaves half a file.
 * The same layout and id rule as lib/ambient/projectStore.js.
 */
export const HISTORY_KEEP = 20;
export const MIN_PHOTOS = 3;
export const MAX_PHOTOS = 20;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const dirOf = (baseDir) => path.join(baseDir, "moments");
function fileOf(baseDir, id) {
  const s = String(id || "");
  return ID_RE.test(s) ? path.join(dirOf(baseDir), `${s}.json`) : null;
}

export function createProject(baseDir, { occasion }) {
  const occ = resolveOccasion(occasion);
  if (!occ) throw new Error("unknown occasion");
  const now = Date.now();
  return writeProject(baseDir, {
    projectId: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    occasion: occ.id,
    details: {},
    photos: [],
    heroIndex: 0,
    sound: { song: { ref: occ.song, windowStartSec: null }, voiceover: null },
    title: "",
    statements: [],
    style: occ.style,
    energy: occ.energy,
    lengthSec: 15,
    seed: normaliseSeed(undefined),
    plan: null,
    render: null,
    history: [],
  });
}

export function readProject(baseDir, id) {
  const file = fileOf(baseDir, id);
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

export function writeProject(baseDir, project) {
  const file = fileOf(baseDir, project.projectId);
  if (!file) throw new Error("invalid project id");
  fs.mkdirSync(dirOf(baseDir), { recursive: true });
  // updatedAt only ever moves forward, so "newest first" is stable even when
  // two writes land in the same millisecond.
  const next = { ...project, updatedAt: Math.max(Date.now(), Number(project.updatedAt || 0) + 1) };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
  return next;
}

export function listProjects(baseDir) {
  const dir = dirOf(baseDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readProject(baseDir, f.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => ({
      projectId: p.projectId,
      occasion: p.occasion,
      title: p.title,
      updatedAt: p.updatedAt,
      thumb: p.photos?.[p.heroIndex]?.url || p.photos?.[0]?.url || null,
      lastFile: p.history?.at(-1)?.file || null,
    }));
}

export function deleteProject(baseDir, id) {
  const file = fileOf(baseDir, id);
  if (!file || !fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function withHistory(project, entry) {
  return { ...project, history: [...(project.history || []), entry].slice(-HISTORY_KEEP) };
}

export function isRendering(project) {
  return project?.render?.status === "running";
}

const text = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

function checkDetails(details) {
  if (details === null || typeof details !== "object" || Array.isArray(details)) return { error: "details must be an object" };
  const out = {};
  for (const [k, v] of Object.entries(details)) {
    if (!DETAIL_FIELDS.includes(k)) return { error: `unknown detail "${k}"` };
    const t = text(v);
    if (t.length > DETAIL_MAX) return { error: `${k} can be up to ${DETAIL_MAX} characters` };
    if (t) out[k] = t;
  }
  return { value: out };
}

function checkStatements(list) {
  if (!Array.isArray(list)) return { error: "statements must be a list" };
  if (list.length > MAX_STATEMENTS) return { error: `up to ${MAX_STATEMENTS} statements` };
  const out = list.map(text);
  if (out.some((s) => !s)) return { error: "a statement can't be empty" };
  if (out.some((s) => s.length > STATEMENT_MAX)) return { error: `each statement can be up to ${STATEMENT_MAX} characters` };
  return { value: out };
}

function checkPhotos(photos) {
  if (!Array.isArray(photos)) return { error: "photos must be a list" };
  if (photos.length > MAX_PHOTOS) return { error: `up to ${MAX_PHOTOS} photos` };
  const ok = photos.every((p) => p && p.ref && (p.ref.kind === "upload" || p.ref.kind === "library")
    && typeof p.url === "string" && Number.isFinite(p.width) && Number.isFinite(p.height));
  return ok ? { value: photos.map((p) => ({ ref: p.ref, url: p.url, width: p.width, height: p.height })) } : { error: "photos are not resolved" };
}

function checkSound(current, sound) {
  if (sound === null || typeof sound !== "object") return { error: "sound must be an object" };
  const next = { ...current };
  if ("song" in sound) {
    if (sound.song === null) next.song = null;
    else {
      const ref = text(sound.song?.ref);
      if (!ref) return { error: "the song needs a ref" };
      const w = sound.song.windowStartSec;
      if (w !== null && w !== undefined && !(Number.isFinite(w) && w >= 0)) return { error: "the song window must start at 0 or later" };
      next.song = { ref, windowStartSec: w ?? null };
    }
  }
  if ("voiceover" in sound) {
    // The voiceover is made only by POST /:id/voiceover; here it can only be removed.
    if (sound.voiceover !== null) return { error: "the voiceover can only be removed here" };
    next.voiceover = null;
  }
  return { value: next };
}

/** The project with `body`'s fields applied, or the first problem found. */
export function applyUpdate(project, body = {}) {
  const next = { ...project };
  const fail = (error) => ({ ok: false, error });
  if ("occasion" in body) {
    const occ = resolveOccasion(body.occasion);
    if (!occ) return fail("unknown occasion");
    next.occasion = occ.id;
  }
  if ("details" in body) {
    const r = checkDetails(body.details);
    if (r.error) return fail(r.error);
    next.details = r.value;
  }
  if ("photos" in body) {
    const r = checkPhotos(body.photos);
    if (r.error) return fail(r.error);
    next.photos = r.value;
  }
  if ("heroIndex" in body) next.heroIndex = body.heroIndex;
  if (!(Number.isInteger(next.heroIndex) && next.heroIndex >= 0 && (next.heroIndex < next.photos.length || next.heroIndex === 0))) {
    return fail("the hero photo must be one of the photos");
  }
  if ("title" in body) {
    const t = text(body.title);
    if (t.length > TITLE_MAX) return fail(`the title can be up to ${TITLE_MAX} characters`);
    next.title = t;
  }
  if ("statements" in body) {
    const r = checkStatements(body.statements);
    if (r.error) return fail(r.error);
    next.statements = r.value;
  }
  if ("style" in body) {
    if (!STYLE_IDS.includes(body.style)) return fail("unknown style");
    next.style = body.style;
  }
  if ("energy" in body) next.energy = Math.min(1, Math.max(0, Number(body.energy) || 0));
  if ("lengthSec" in body) {
    if (!LENGTHS.includes(body.lengthSec)) return fail("the length must be 15, 30 or 60 seconds");
    next.lengthSec = body.lengthSec;
  }
  if ("seed" in body) next.seed = normaliseSeed(body.seed);
  if ("sound" in body) {
    const r = checkSound(project.sound, body.sound);
    if (r.error) return fail(r.error);
    next.sound = r.value;
  }
  return { ok: true, project: next };
}
```

When photos are removed below the hero's index, the client sends a new `heroIndex` in the same PUT. If it does not, the update is refused with "the hero photo must be one of the photos". Removing photos resets the hero client-side (plan C).

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/moments/projectStore.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/moments/projectStore.js server/src/lib/moments/projectStore.test.js
```

```bash
git commit -m "feat: Moments project store with update validation and render history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Photo and song resolution

**Files:**
- Create: `server/src/lib/moments/photos.js`
- Test: `server/src/lib/moments/photos.test.js`

**Interfaces:**
- Consumes:
  - from `../ambient/movementImage.js`: `resolveOwnUpload`, `MAX_IMAGE_BYTES`, `MAX_IMAGE_SIDE`, `MAX_IMAGE_PIXELS`;
  - from `../imageSniff.js`: `sniffImage`, `imageHeaderSize`, `UNDECODABLE_IMAGE_ERROR`;
  - `readLibrary` from `../imageGen/imageLibrary.js`;
  - `resolveTrackFile` from `../ambient/stages.js`.
- Produces:
  - `resolvePhoto(ctx, ref, { items }) → { ok: true, file, url, width, height } | { ok: false, error }`. Here `ctx = { dataDir, outputDir }` and `items` defaults to `readLibrary(ctx.dataDir).items`.
  - `resolvePhotos(ctx, refs) → { ok: true, photos: [{ ref, url, width, height }] } | { ok: false, error }`. The error names the photo number.
  - `resolveSong(ctx, ref) → string | null`.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/moments/photos.test.js`:

```js
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { resolvePhoto, resolvePhotos, resolveSong } from "./photos.js";

// A real 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let ctx;
beforeEach(() => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "moments-photos-"));
  const outputDir = path.join(dataDir, "out");
  fs.mkdirSync(outputDir);
  ctx = { dataDir, outputDir };
});
afterEach(() => fs.rmSync(ctx.dataDir, { recursive: true, force: true }));

function upload(buf = PNG, ext = "png") {
  const name = `bg-image-${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(ctx.outputDir, name), buf);
  return name;
}

test("an own upload resolves to its file, URL and size", () => {
  const name = upload();
  const r = resolvePhoto(ctx, { kind: "upload", path: name }, { items: [] });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.url, `/outputs/${name}`);
  assert.deepEqual([r.width, r.height], [1, 1]);
  assert.equal(r.file, fs.realpathSync(path.join(ctx.outputDir, name)));
});

test("an upload path that leaves the outputs folder is refused", () => {
  const r = resolvePhoto(ctx, { kind: "upload", path: "../../etc/passwd" }, { items: [] });
  assert.equal(r.ok, false);
});

test("a file that isn't a picture is refused with the format message", () => {
  const name = upload(Buffer.from("not an image at all"), "jpg");
  const r = resolvePhoto(ctx, { kind: "upload", path: name }, { items: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /format/);
});

test("a library item resolves through the user's own library", () => {
  const file = path.join(ctx.outputDir, "pool-abc.png");
  fs.writeFileSync(file, PNG);
  const items = [{ id: "lib1", path: file, publicUrl: "/outputs/pool-abc.png" }];
  const r = resolvePhoto(ctx, { kind: "library", id: "lib1" }, { items });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.url, "/outputs/pool-abc.png");
  assert.equal(resolvePhoto(ctx, { kind: "library", id: "nope" }, { items }).ok, false);
});

test("an unknown ref kind is refused", () => {
  assert.equal(resolvePhoto(ctx, { kind: "url", path: "http://x" }, { items: [] }).ok, false);
  assert.equal(resolvePhoto(ctx, null, { items: [] }).ok, false);
});

test("resolvePhotos names the photo that failed", () => {
  const good = upload();
  const r = resolvePhotos(ctx, [{ kind: "upload", path: good }, { kind: "upload", path: "bg-image-00000000-0000-0000-0000-000000000000.png" }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /^Photo 2:/);
  const ok = resolvePhotos(ctx, [{ kind: "upload", path: good }]);
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.photos[0]).sort(), ["height", "ref", "url", "width"]);
});

test("resolveSong accepts bundled library refs and refuses forgotten ones", () => {
  assert.ok(resolveSong(ctx, "library:hopeful"));
  assert.equal(resolveSong(ctx, "library:not-a-track"), null);
  assert.equal(resolveSong(ctx, "mylib:00000000-0000-0000-0000-000000000000"), null);
  assert.equal(resolveSong(ctx, "/etc/passwd"), null);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/moments/photos.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `photos.js`**

`server/src/lib/moments/photos.js`:

```js
import fs from "node:fs";
import path from "node:path";
import { resolveOwnUpload, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MAX_IMAGE_PIXELS } from "../ambient/movementImage.js";
import { sniffImage, imageHeaderSize, UNDECODABLE_IMAGE_ERROR } from "../imageSniff.js";
import { readLibrary } from "../imageGen/imageLibrary.js";
import { resolveTrackFile } from "../ambient/stages.js";

/**
 * A Moment's photos are refs, never paths: an own upload (by file NAME,
 * resolved only inside the user's outputs) or an item in the user's own
 * image library. Every check a render needs happens here, from the file's
 * header, so a bad photo is caught when it is added, not an hour into a render.
 */
function fileFor(ctx, ref, items) {
  if (ref?.kind === "upload") {
    const file = resolveOwnUpload(ctx.outputDir, ref.path);
    return file ? { file, url: `/outputs/${path.basename(file)}` } : null;
  }
  if (ref?.kind === "library") {
    const entry = (items || []).find((it) => it?.id === String(ref.id || ""));
    if (!entry?.path || !fs.existsSync(entry.path)) return null;
    return { file: entry.path, url: entry.publicUrl || `/outputs/${path.basename(entry.path)}` };
  }
  return null;
}

export function resolvePhoto(ctx, ref, { items } = {}) {
  const lib = items ?? readLibrary(ctx.dataDir).items;
  const found = fileFor(ctx, ref, lib);
  if (!found) return { ok: false, error: "that photo was not found. Try adding it again." };
  let bytes;
  try { bytes = fs.statSync(found.file).size; } catch { return { ok: false, error: "that photo was not found. Try adding it again." }; }
  if (bytes > MAX_IMAGE_BYTES) return { ok: false, error: "That photo is over 25 MB. Use a smaller copy." };
  const kind = sniffImage(found.file);
  if (!kind) return { ok: false, error: UNDECODABLE_IMAGE_ERROR };
  const size = imageHeaderSize(found.file, kind);
  if (!size) return { ok: false, error: UNDECODABLE_IMAGE_ERROR };
  if (size.animated) return { ok: false, error: "That's an animated picture. Use a still JPG or PNG." };
  if (size.w > MAX_IMAGE_SIDE || size.h > MAX_IMAGE_SIDE || size.w * size.h > MAX_IMAGE_PIXELS) {
    return { ok: false, error: `That picture is ${size.w}×${size.h}, too large for a video.` };
  }
  return { ok: true, file: found.file, url: found.url, width: size.w, height: size.h };
}

export function resolvePhotos(ctx, refs) {
  const items = readLibrary(ctx.dataDir).items;
  const photos = [];
  for (let i = 0; i < refs.length; i += 1) {
    const r = resolvePhoto(ctx, refs[i], { items });
    if (!r.ok) return { ok: false, error: `Photo ${i + 1}: ${r.error}` };
    const ref = refs[i].kind === "upload" ? { kind: "upload", path: path.basename(r.file) } : { kind: "library", id: String(refs[i].id) };
    photos.push({ ref, url: r.url, width: r.width, height: r.height });
  }
  return { ok: true, photos };
}

/** The song's file: a bundled track, the user's own library, or their own upload. */
export function resolveSong(ctx, ref) {
  return resolveTrackFile(ctx, ref) || null;
}
```

`readLibrary(dataDir)` returns `{ items: [] }` when the user has no library. Check that it does in this codebase; if it can return null, use `(readLibrary(ctx.dataDir)?.items) || []` in both places.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/moments/photos.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/moments/photos.js server/src/lib/moments/photos.test.js
```

```bash
git commit -m "feat: Moments photo and song resolution with image checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The beat-analysis cache

**Files:**
- Create: `server/src/lib/moments/beatCache.js`
- Test: `server/src/lib/moments/beatCache.test.js`

**Interfaces:**
- Consumes:
  - from `../motion/beats.js`: `decodePcm`, `onsetEnvelope`, `estimateTempo`, `beatGrid`, `chooseWindow`, `pausesFrom`, `FRAME_RATE`;
  - from `../motion/cuts.js`: `beatGridOf`, `pulseGrid`, `pauseGrid`;
  - `clickTrack` and `toneGaps` from `../motion/testkit.js`, in tests only.
- Produces:
  - `songGrid(ctx, file, { lengthSec, windowStartSec = null, decode = decodePcm }) → Promise<{ grid, tempo, durationSec, windowStartSec }>`.
  - `voiceGrid(file, { lengthSec, decode = decodePcm }) → Promise<grid>`.
  - The cache lives at `<dataDir>/moments/beats/<sha1>.json`, as `{ tempo, durationSec, env: number[] }`.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/moments/beatCache.test.js`:

```js
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { songGrid, voiceGrid } from "./beatCache.js";
import { clickTrack, toneGaps } from "../motion/testkit.js";

let ctx;
let song;
beforeEach(() => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "moments-beats-"));
  ctx = { dataDir, outputDir: dataDir };
  song = path.join(dataDir, "song.mp3");
  fs.writeFileSync(song, "pretend mp3 bytes");
});
afterEach(() => fs.rmSync(ctx.dataDir, { recursive: true, force: true }));

test("a song is analysed once, then served from the cache", async () => {
  let decodes = 0;
  const decode = async () => { decodes += 1; return clickTrack({ bpm: 120, sec: 40 }); };
  const a = await songGrid(ctx, song, { lengthSec: 15, decode });
  const b = await songGrid(ctx, song, { lengthSec: 15, decode });
  assert.equal(decodes, 1);
  assert.equal(a.grid.kind, "beats");
  assert.ok(Math.abs(a.tempo - 120) <= 1);
  assert.deepEqual(a.grid, b.grid);
  assert.equal(fs.readdirSync(path.join(ctx.dataDir, "moments", "beats")).length, 1);
});

test("the user's own window start wins, clamped so the window fits the song", async () => {
  const decode = async () => clickTrack({ bpm: 120, sec: 40 });
  const own = await songGrid(ctx, song, { lengthSec: 15, windowStartSec: 10, decode });
  assert.equal(own.windowStartSec, 10);
  const late = await songGrid(ctx, song, { lengthSec: 15, windowStartSec: 39, decode });
  assert.ok(late.windowStartSec <= 25 + 1e-9, `${late.windowStartSec}`);
});

test("a song with no clear tempo gets the pulse grid", async () => {
  const decode = async () => Buffer.alloc(11025 * 2 * 20);
  const r = await songGrid(ctx, song, { lengthSec: 15, decode });
  assert.equal(r.tempo, null);
  assert.equal(r.grid.kind, "pulse");
});

test("a voiceover gives a pause grid, or a pulse grid when it never pauses", async () => {
  const withGaps = await voiceGrid("vo.mp3", { lengthSec: 15, decode: async () => toneGaps([[0.2, false], [3, true], [0.5, false], [3, true], [0.2, false]]) });
  assert.equal(withGaps.kind, "pauses");
  assert.equal(withGaps.marks.length, 1);
  const solid = await voiceGrid("vo.mp3", { lengthSec: 15, decode: async () => toneGaps([[5, true]]) });
  assert.equal(solid.kind, "pulse");
});

test("a decode failure is reported, not cached", async () => {
  await assert.rejects(songGrid(ctx, song, { lengthSec: 15, decode: async () => { throw new Error("bad audio"); } }), /bad audio/);
  assert.equal(fs.existsSync(path.join(ctx.dataDir, "moments", "beats")), false);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/moments/beatCache.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `beatCache.js`**

`server/src/lib/moments/beatCache.js`:

```js
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { decodePcm, onsetEnvelope, estimateTempo, beatGrid, chooseWindow, pausesFrom, FRAME_RATE } from "../motion/beats.js";
import { beatGridOf, pulseGrid, pauseGrid } from "../motion/cuts.js";

/**
 * Timing grids for a Moment. A song's onset envelope and tempo are cached by
 * the file's content hash, so Shuffle, a new length or a nudged window never
 * decodes the song again.
 */
const cacheDir = (dataDir) => path.join(dataDir, "moments", "beats");

function hashOf(file) {
  return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
}

async function analysis(ctx, file, decode) {
  const cacheFile = path.join(cacheDir(ctx.dataDir), `${hashOf(file)}.json`);
  if (fs.existsSync(cacheFile)) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      return { tempo: c.tempo, durationSec: c.durationSec, env: Float64Array.from(c.env) };
    } catch { /* a corrupt cache entry is rebuilt below */ }
  }
  const env = onsetEnvelope(await decode(file));
  const result = { tempo: estimateTempo(env), durationSec: env.length / FRAME_RATE, env };
  fs.mkdirSync(cacheDir(ctx.dataDir), { recursive: true });
  const tmp = `${cacheFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ tempo: result.tempo, durationSec: result.durationSec, env: Array.from(env, (v) => Math.round(v * 1e4) / 1e4) }));
  fs.renameSync(tmp, cacheFile);
  return result;
}

export async function songGrid(ctx, file, { lengthSec, windowStartSec = null, decode = decodePcm }) {
  const { tempo, durationSec, env } = await analysis(ctx, file, decode);
  const latest = Math.max(0, durationSec - lengthSec);
  const start = windowStartSec === null || windowStartSec === undefined
    ? chooseWindow(env, lengthSec)
    : Math.min(Math.max(0, windowStartSec), latest);
  const grid = tempo ? beatGridOf(beatGrid(env, tempo, start, lengthSec)) : pulseGrid(lengthSec);
  return { grid, tempo, durationSec, windowStartSec: Math.round(start * 100) / 100 };
}

export async function voiceGrid(file, { lengthSec, decode = decodePcm }) {
  const pauses = pausesFrom(await decode(file)).filter((p) => p.start < lengthSec);
  return pauses.length ? pauseGrid(pauses, lengthSec) : pulseGrid(lengthSec);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/moments/beatCache.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/moments/beatCache.js server/src/lib/moments/beatCache.test.js
```

```bash
git commit -m "feat: Moments beat-analysis cache and voiceover pause grid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The render stage

**Files:**
- Create: `server/src/lib/moments/renderStage.js`
- Test: `server/src/lib/moments/renderStage.test.js`

**Interfaces:**
- Consumes:
  - Task 3's `readProject`, `writeProject`, `withHistory`;
  - Task 4's `resolvePhoto`, `resolveSong`;
  - Task 5's `songGrid`, `voiceGrid`;
  - `statementLimit` (Task 1);
  - from the motion engine: `orientationOf`, `workImageArgs` (`../motion/prepare.js`), `directMoment` (`../motion/director.js`), `validatePlan` (`../motion/plan.js`), `pulseGrid` (`../motion/cuts.js`), `renderPlan`, `runFfmpeg` (`../motion/render.js`);
  - from `../renderJobs.js`: `markRunning`, `markProgress`, `markDone`, `markError`, `persistJob`, `getJob`;
  - `readLibrary`;
  - `resolveOwnUpload` (for the voiceover file).
- Produces:
  - `VOICE_NAME = /^moment-vo-[0-9a-f-]{36}\.mp3$/i`.
  - `OUTPUT_NAME = /^moment-[0-9a-f-]{36}\.mp4$/i`.
  - `STAGES` (for progress): `prepare` 0–10, `analyse` 10–20, `shots` 20–75, `join` 75–85, `finish` 85–100.
  - `momentRenderStage(ctx, projectId, jobId, { seed, signal } = {}) → Promise<void>`. It never throws; failures are written to the project.
  - Seams: `_setEngineForTest({ runFfmpeg?, renderPlan?, decode? })` and `_resetEngineForTest()`.
  - `cancelMomentRender(projectId) → boolean`. The cancel registry is an AbortController per project.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/moments/renderStage.test.js`:

```js
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { momentRenderStage, _setEngineForTest, _resetEngineForTest, STAGES } from "./renderStage.js";
import { createProject, readProject, writeProject } from "./projectStore.js";
import { createJob, getJob } from "../renderJobs.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let ctx;
let calls;
beforeEach(() => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "moments-stage-"));
  const outputDir = path.join(dataDir, "out");
  fs.mkdirSync(outputDir);
  ctx = { dataDir, outputDir, userId: "u1" };
  calls = { prepare: 0, render: [] };
  _setEngineForTest({
    runFfmpeg: async (args) => { calls.prepare += 1; fs.writeFileSync(args.at(-1), "jpg"); return { ok: true }; },
    decode: async () => Buffer.alloc(11025 * 2 * 30),
    renderPlan: async (opts) => {
      calls.render.push(opts);
      assert.ok(fs.existsSync(opts.workDir), "the work dir exists during the render");
      opts.onProgress({ stage: "shots", fraction: 0.5 });
      opts.onProgress({ stage: "shots", fraction: 1 });
      opts.onProgress({ stage: "join", fraction: 1 });
      opts.onProgress({ stage: "finish", fraction: 1 });
      fs.writeFileSync(opts.out, "mp4");
      return { ok: true, file: opts.out };
    },
  });
});
afterEach(() => { _resetEngineForTest(); fs.rmSync(ctx.dataDir, { recursive: true, force: true }); });

function photo(buf = PNG) {
  const name = `bg-image-${crypto.randomUUID()}.png`;
  fs.writeFileSync(path.join(ctx.outputDir, name), buf);
  return { ref: { kind: "upload", path: name }, url: `/outputs/${name}`, width: 1, height: 1 };
}

function moment(over = {}) {
  const p = createProject(ctx.dataDir, { occasion: "birthday" });
  return writeProject(ctx.dataDir, {
    ...p, photos: [photo(), photo(), photo(), photo()], title: "Happy birthday",
    statements: ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"], lengthSec: 15, seed: 9,
    render: { jobId: null, status: "running", percent: 0, stage: "waiting" }, ...over,
  });
}

test("prepare → analyse → direct → render → history, with progress by stage", async () => {
  const p = moment();
  const job = createJob("u1", { durationSec: 15 });
  await momentRenderStage(ctx, p.projectId, job.jobId, {});
  const done = readProject(ctx.dataDir, p.projectId);
  assert.equal(done.render.status, "done", JSON.stringify(done.render));
  assert.equal(done.render.percent, 100);
  assert.match(done.render.file, /^\/outputs\/moment-[0-9a-f-]{36}\.mp4$/);
  assert.equal(done.history.length, 1);
  assert.equal(done.history[0].seed, 9);
  assert.equal(calls.prepare, 4, "one working image per photo");
  assert.ok(done.plan && done.plan.shots.length > 0, "the plan is saved");
  assert.equal(getJob(job.jobId).status, "done");
  assert.ok(!fs.existsSync(calls.render[0].workDir), "the work dir is removed");
  assert.deepEqual(STAGES.shots, [20, 75]);
});

test("only the length's share of statements is used (15 s → 3)", async () => {
  const p = moment();
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const caps = readProject(ctx.dataDir, p.projectId).plan.captions.map((c) => c.text);
  assert.deepEqual(caps, ["Happy birthday", "One", "Two", "Three"].filter((t) => caps.includes(t)));
  assert.ok(!caps.includes("Four"));
});

test("a Shuffle seed is stored with the render", async () => {
  const p = moment();
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, { seed: 1234 });
  const done = readProject(ctx.dataDir, p.projectId);
  assert.equal(done.seed, 1234);
  assert.equal(done.plan.seed, 1234);
});

test("an unreadable photo is skipped and noted", async () => {
  const p = moment();
  fs.writeFileSync(path.join(ctx.outputDir, p.photos[2].ref.path), "garbage");
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const done = readProject(ctx.dataDir, p.projectId);
  assert.equal(done.render.status, "done");
  assert.match(done.render.notes.join(" "), /Photo 3/);
  assert.equal(calls.prepare, 3);
});

test("fewer than 3 readable photos fails with a clear message", async () => {
  const p = moment();
  for (const ph of p.photos.slice(1)) fs.writeFileSync(path.join(ctx.outputDir, ph.ref.path), "garbage");
  const job = createJob("u1", { durationSec: 15 });
  await momentRenderStage(ctx, p.projectId, job.jobId, {});
  const failed = readProject(ctx.dataDir, p.projectId);
  assert.equal(failed.render.status, "error");
  assert.match(failed.render.error, /Need at least 3 readable photos/);
  assert.equal(getJob(job.jobId).status, "error");
  assert.equal(calls.render.length, 0);
});

test("a render failure is recorded with the engine's friendly message", async () => {
  _setEngineForTest({ renderPlan: async () => ({ ok: false, error: "Rendering failed at shot 2 of 9.", detail: "No such filter" }) });
  const p = moment();
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const failed = readProject(ctx.dataDir, p.projectId);
  assert.equal(failed.render.status, "error");
  assert.equal(failed.render.error, "Rendering failed at shot 2 of 9.");
});

test("a song that is gone fails clearly", async () => {
  const p = moment({ sound: { song: { ref: "library:no-such-track", windowStartSec: null }, voiceover: null } });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  assert.match(readProject(ctx.dataDir, p.projectId).render.error, /song/i);
});

test("no song and no voiceover still renders on the pulse grid with silence", async () => {
  const p = moment({ sound: { song: null, voiceover: null } });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  assert.equal(readProject(ctx.dataDir, p.projectId).render.status, "done");
  assert.equal(calls.render[0].song, null);
  assert.equal(calls.render[0].voice, null);
});

test("the song plays from the analysed window", async () => {
  const p = moment({ sound: { song: { ref: "library:hopeful", windowStartSec: 7 }, voiceover: null } });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  assert.equal(calls.render[0].song.startSec, 7);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/moments/renderStage.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `renderStage.js`**

`server/src/lib/moments/renderStage.js`:

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { readProject, writeProject, withHistory } from "./projectStore.js";
import { resolvePhoto, resolveSong } from "./photos.js";
import { songGrid, voiceGrid } from "./beatCache.js";
import { statementLimit } from "./occasions.js";
import { orientationOf, workImageArgs } from "../motion/prepare.js";
import { directMoment } from "../motion/director.js";
import { validatePlan } from "../motion/plan.js";
import { pulseGrid } from "../motion/cuts.js";
import { renderPlan as realRenderPlan, runFfmpeg as realRunFfmpeg } from "../motion/render.js";
import { decodePcm } from "../motion/beats.js";
import { markRunning, markProgress, markDone, markError, persistJob, getJob } from "../renderJobs.js";
import { readLibrary } from "../imageGen/imageLibrary.js";
import { resolveOwnUpload } from "../ambient/movementImage.js";

/**
 * A Moment's render, run detached inside runExclusive. Every outcome is
 * written to the project (the client polls it), and the per-job work folder
 * is removed whatever happens.
 */
export const VOICE_NAME = /^moment-vo-[0-9a-f-]{36}\.mp3$/i;
export const OUTPUT_NAME = /^moment-[0-9a-f-]{36}\.mp4$/i;
export const STAGES = Object.freeze({ prepare: [0, 10], analyse: [10, 20], shots: [20, 75], join: [75, 85], finish: [85, 100] });
const MIN_USABLE = 3;

let engine = { runFfmpeg: realRunFfmpeg, renderPlan: realRenderPlan, decode: decodePcm };
export function _setEngineForTest(over) { engine = { ...engine, ...over }; }
export function _resetEngineForTest() { engine = { runFfmpeg: realRunFfmpeg, renderPlan: realRenderPlan, decode: decodePcm }; }

const controllers = new Map();
export function cancelMomentRender(projectId) {
  const c = controllers.get(String(projectId));
  if (!c) return false;
  c.abort();
  return true;
}

class StageError extends Error {}

function progressWriter(ctx, projectId, jobId) {
  let lastWritten = -1;
  return (stage, fraction) => {
    const [a, b] = STAGES[stage];
    const percent = Math.round(a + (b - a) * Math.min(1, Math.max(0, fraction)));
    try { markProgress(jobId, percent); } catch { /* job gone */ }
    if (percent - lastWritten < 5 && percent !== 100 && fraction !== 0) return;
    lastWritten = percent;
    const live = readProject(ctx.dataDir, projectId);
    if (live) writeProject(ctx.dataDir, { ...live, render: { ...live.render, jobId, status: "running", percent, stage } });
  };
}

async function preparePhotos(ctx, project, workDir, signal) {
  const items = readLibrary(ctx.dataDir)?.items || [];
  const usable = [];
  const notes = [];
  for (let i = 0; i < project.photos.length; i += 1) {
    if (signal.aborted) throw new StageError("cancelled");
    const r = resolvePhoto(ctx, project.photos[i].ref, { items });
    if (!r.ok) { notes.push(`Photo ${i + 1} was skipped: ${r.error}`); continue; }
    const out = path.join(workDir, `work-${i}.jpg`);
    const { args, shape } = workImageArgs({ src: r.file, out, width: r.width, height: r.height, orientation: orientationOf(r.file) });
    const ran = await engine.runFfmpeg(args, { signal });
    if (!ran.ok) { notes.push(`Photo ${i + 1} was skipped: it could not be read.`); continue; }
    usable.push({ index: i, file: out, shape });
  }
  if (usable.length < MIN_USABLE) throw new StageError("Need at least 3 readable photos. Add more photos and try again.");
  return { usable, notes };
}

async function timing(ctx, project) {
  const { song, voiceover } = project.sound || {};
  const lengthSec = project.lengthSec;
  if (song) {
    const file = resolveSong(ctx, song.ref);
    if (!file) throw new StageError("That song is no longer available. Pick another song.");
    const g = await songGrid(ctx, file, { lengthSec, windowStartSec: song.windowStartSec, decode: engine.decode });
    return { grid: g.grid, song: { file, startSec: g.windowStartSec } };
  }
  if (voiceover?.file) {
    const file = resolveOwnUpload(ctx.outputDir, voiceover.file, VOICE_NAME);
    if (!file) throw new StageError("The voiceover is missing. Make it again.");
    return { grid: await voiceGrid(file, { lengthSec, decode: engine.decode }), song: null };
  }
  return { grid: pulseGrid(lengthSec), song: null };
}

function voiceFile(ctx, project) {
  const vo = project.sound?.voiceover;
  if (!vo?.file) return null;
  const file = resolveOwnUpload(ctx.outputDir, vo.file, VOICE_NAME);
  return file ? { file } : null;
}

export async function momentRenderStage(ctx, projectId, jobId, { seed } = {}) {
  const controller = new AbortController();
  controllers.set(String(projectId), controller);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "moment-"));
  const progress = progressWriter(ctx, projectId, jobId);
  try {
    let project = readProject(ctx.dataDir, projectId);
    if (!project) throw new StageError("This Moment no longer exists.");
    if (Number.isInteger(seed)) project = writeProject(ctx.dataDir, { ...project, seed });
    try { markRunning(jobId); } catch { /* job gone */ }
    progress("prepare", 0);

    const { usable, notes } = await preparePhotos(ctx, project, workDir, controller.signal);
    progress("prepare", 1);
    const { grid, song } = await timing(ctx, project);
    const heroAt = usable.findIndex((u) => u.index === project.heroIndex);
    const { plan, dropped } = directMoment({
      photos: usable.map((u) => ({ shape: u.shape })),
      heroIndex: heroAt >= 0 ? heroAt : 0,
      grid,
      title: project.title,
      statements: project.statements.slice(0, statementLimit(project.lengthSec)),
      styleId: project.style,
      energy: project.energy,
      lengthSec: project.lengthSec,
      seed: project.seed,
    });
    const checked = validatePlan(plan, { photoCount: usable.length });
    if (!checked.ok) {
      console.error(`[moments] invalid plan for ${projectId}: ${checked.errors.join("; ")}`);
      throw new StageError("Couldn't plan this Moment. Try Shuffle or a different length.");
    }
    if (dropped) notes.push(`${dropped} photo${dropped === 1 ? "" : "s"} didn't fit ${project.lengthSec} s.`);
    project = writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, projectId), plan });
    progress("analyse", 1);

    const name = `moment-${crypto.randomUUID()}.mp4`;
    const out = path.join(ctx.outputDir, name);
    const result = await engine.renderPlan({
      plan,
      workImages: usable.map((u) => u.file),
      song,
      voice: voiceFile(ctx, project),
      workDir,
      out,
      signal: controller.signal,
      onProgress: ({ stage, fraction }) => progress(stage, fraction),
    });
    if (!result.ok) {
      if (result.detail) console.error(`[moments] render ${projectId} failed: ${result.detail}`);
      throw new StageError(result.error === "cancelled" ? "Cancelled." : result.error);
    }

    const file = `/outputs/${name}`;
    const live = readProject(ctx.dataDir, projectId);
    writeProject(ctx.dataDir, withHistory(
      { ...live, render: { jobId, status: "done", percent: 100, stage: "done", file, notes } },
      { jobId, file, createdAt: Date.now(), seed: plan.seed, notes },
    ));
    try { markDone(jobId, out); } catch { /* job gone */ }
    persistJob(ctx.dataDir, { ...(getJob(jobId) || {}), jobId, projectId, status: "done", outputPath: out });
  } catch (err) {
    const friendly = err instanceof StageError ? err.message : "Something went wrong while making this Moment. Please try again.";
    if (!(err instanceof StageError)) console.error(`[moments] render ${projectId} crashed:`, err);
    try { markError(jobId, friendly); } catch { /* job gone */ }
    const live = readProject(ctx.dataDir, projectId);
    if (live) writeProject(ctx.dataDir, { ...live, render: { jobId, status: "error", percent: 0, stage: "error", error: friendly } });
    persistJob(ctx.dataDir, { ...(getJob(jobId) || {}), jobId, projectId, status: "error", outputPath: null });
  } finally {
    controllers.delete(String(projectId));
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
```

The 15 s statements test filters `caps` to the expected order because `placeCaptions` may drop body statements when there are fewer body shots than statements. What it pins is that "Four" never appears.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/moments/renderStage.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/moments/renderStage.js server/src/lib/moments/renderStage.test.js
```

```bash
git commit -m "feat: Moments render stage (prepare, analyse, direct, render, history)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The `/api/moments` routes and mount

**Files:**
- Create: `server/src/routes/moments.js`
- Modify: `server/index.js` (import and mount, next to `/api/ambient`)
- Test: `server/src/routes/moments.test.js`

**Interfaces:**
- Consumes:
  - everything above;
  - `quota` from `../middleware/quota.js`;
  - `runExclusive` from `../lib/heavyJobGate.js`;
  - `createJob`, `persistJob`, `markError`, `getJob`, `cancelJob` from `../lib/renderJobs.js`;
  - `refineScript` from `../lib/story/scriptRefine.js`;
  - `cleanSpeakableText` from `../lib/speakableScript.js`;
  - `synthesizeEdgeTts` from `../lib/edgeTts.js`;
  - `STYLES` from `../lib/motion/styles.js`.
- Produces these routes. Every response is `{ ok, ... }`.

| Method | Path | Notes |
|---|---|---|
| GET | `/meta` | `{ occasions, styles, lengths, limits }` for the client |
| GET | `/` | `{ projects }` |
| GET | `/library-images` | `{ images }`: the user's library pictures as `{ id, url, aspect, source, createdAt }`, never paths (`libraryImageView`) |
| POST | `/` | `{ occasion }` → `{ project }` |
| GET | `/:id/song-window` | `{ durationSec, tempo, windowStartSec, autoStartSec }` for the chosen song at the project's length (cached analysis; not charged); 400 when there is no song |
| GET | `/:id` | `{ project }`, with live percent; `running` with no live job → `interrupted` |
| PUT | `/:id` | 409 while rendering; photos as refs, resolved here |
| DELETE | `/:id` | 409 while rendering; removes outputs and the voiceover |
| POST | `/:id/statements` | charges `scripts` → `{ suggestion }` (not saved) |
| POST | `/:id/voiceover` | `{ script?, idea?, voiceId? }`, charges `tts`, saves the voiceover → `{ project }` |
| POST | `/:id/render` | `{ seed? }`, 409 if rendering, needs ≥ 3 photos, charges `render` → `{ jobId }` |
| POST | `/:id/cancel` | aborts a running render |

- Seams: `_setQuotaImpl`, `_resetQuotaImpl`, `_setRenderStageImpl`, `_resetRenderStageImpl`, `_setTtsImpl`, `_resetTtsImpl`, `_setSongGridImpl`, `_resetSongGridImpl`.
- Route order matters: `/meta` and `/library-images` are registered before `/:id`, so they are not read as project ids.

- [ ] **Step 1: Write the failing tests**

`server/src/routes/moments.test.js`:

```js
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import momentsRouter, {
  _setQuotaImpl, _resetQuotaImpl, _setRenderStageImpl, _resetRenderStageImpl, _setTtsImpl, _resetTtsImpl,
  _setSongGridImpl, _resetSongGridImpl,
} from "./moments.js";
import { readProject, writeProject } from "../lib/moments/projectStore.js";
import { _setLlmImpl, _resetLlmImpl } from "../lib/moments/statements.js";
import { _resetHeavyGate } from "../lib/heavyJobGate.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let dataDir;
let outputDir;
let app;
let charges;
let stageCalls;

function makeApp(userId = "u1", dir = dataDir, out = outputDir) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = { userId, plan: "free", dataDir: dir, outputDir: out }; next(); });
  a.use("/api/moments", momentsRouter);
  return a;
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "moments-route-"));
  outputDir = path.join(dataDir, "out");
  fs.mkdirSync(outputDir);
  app = makeApp();
  charges = [];
  stageCalls = [];
  _setQuotaImpl((bucket) => (_req, _res, next) => { charges.push(bucket); next(); });
  _setRenderStageImpl(async (...args) => { stageCalls.push(args); });
  _setLlmImpl(async () => JSON.stringify({ title: "Happy 40th!", statements: ["A", "B"] }));
  _setTtsImpl(async () => {
    const f = path.join(os.tmpdir(), `tts-${crypto.randomUUID()}.mp3`);
    fs.writeFileSync(f, "mp3");
    return { ok: true, file: f };
  });
  _resetHeavyGate();
});
afterEach(() => {
  _resetQuotaImpl(); _resetRenderStageImpl(); _resetLlmImpl(); _resetTtsImpl();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function upload() {
  const name = `bg-image-${crypto.randomUUID()}.png`;
  fs.writeFileSync(path.join(outputDir, name), PNG);
  return { kind: "upload", path: name };
}

async function newMoment(occasion = "birthday") {
  const r = await request(app).post("/api/moments").send({ occasion });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.project;
}

test("GET /meta lists occasions, styles, lengths and limits", async () => {
  const r = await request(app).get("/api/moments/meta");
  assert.equal(r.status, 200);
  assert.equal(r.body.occasions.length, 8);
  assert.deepEqual(r.body.styles.map((s) => s.id), ["glow", "celebrate", "hype", "gallery"]);
  assert.deepEqual(r.body.lengths, [15, 30, 60]);
  assert.deepEqual(r.body.limits.statements, { 15: 3, 30: 5, 60: 8 });
  const birthday = r.body.occasions.find((o) => o.id === "birthday");
  assert.deepEqual(birthday.fields, ["name", "milestone"]);
  assert.equal(birthday.style, "celebrate");
});

test("create needs a known occasion", async () => {
  assert.equal((await request(app).post("/api/moments").send({ occasion: "party" })).status, 400);
  const p = await newMoment("memorial");
  assert.equal(p.style, "glow");
});

test("PUT resolves photo refs and saves them; a bad photo is named", async () => {
  const p = await newMoment();
  const ok = await request(app).put(`/api/moments/${p.projectId}`).send({ photos: [upload(), upload(), upload()], heroIndex: 1, title: "Hi" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.project.photos.length, 3);
  assert.match(ok.body.project.photos[0].url, /^\/outputs\/bg-image-/);
  const bad = await request(app).put(`/api/moments/${p.projectId}`).send({ photos: [upload(), { kind: "upload", path: "../../x.png" }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /^Photo 2:/);
});

test("another user's Moment is a 404", async () => {
  const p = await newMoment();
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "moments-other-"));
  const other = makeApp("u2", otherDir, otherDir);
  assert.equal((await request(other).get(`/api/moments/${p.projectId}`)).status, 404);
  assert.equal((await request(other).put(`/api/moments/${p.projectId}`).send({ title: "x" })).status, 404);
  fs.rmSync(otherDir, { recursive: true, force: true });
});

test("statements charge scripts once and are returned, not saved", async () => {
  const p = await newMoment();
  const r = await request(app).post(`/api/moments/${p.projectId}/statements`).send();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.suggestion.statements, ["A", "B"]);
  assert.deepEqual(charges, ["scripts"]);
  assert.deepEqual(readProject(dataDir, p.projectId).statements, []);
});

test("a voiceover is synthesised, stored in the user's outputs, and charged to tts", async () => {
  const p = await newMoment();
  const r = await request(app).post(`/api/moments/${p.projectId}/voiceover`).send({ script: "Happy birthday Tolu, God bless you.", voiceId: "en-GB-SoniaNeural" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const vo = r.body.project.sound.voiceover;
  assert.match(vo.file, /^moment-vo-[0-9a-f-]{36}\.mp3$/);
  assert.ok(fs.existsSync(path.join(outputDir, vo.file)));
  assert.deepEqual(charges, ["tts"]);
  const empty = await request(app).post(`/api/moments/${p.projectId}/voiceover`).send({ script: "  " });
  assert.equal(empty.status, 400);
  assert.deepEqual(charges, ["tts"], "nothing charged for a refused request");
});

test("render needs 3 photos, charges once after validation, and a second render is 409", async () => {
  const p = await newMoment();
  const few = await request(app).post(`/api/moments/${p.projectId}/render`).send();
  assert.equal(few.status, 400);
  assert.deepEqual(charges, []);
  await request(app).put(`/api/moments/${p.projectId}`).send({ photos: [upload(), upload(), upload()] });
  const first = await request(app).post(`/api/moments/${p.projectId}/render`).send({ seed: 77 });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.body.jobId);
  const second = await request(app).post(`/api/moments/${p.projectId}/render`).send();
  assert.equal(second.status, 409);
  assert.deepEqual(charges, ["render"]);
  await new Promise((r) => setImmediate(r));
  assert.equal(stageCalls.length, 1);
  assert.equal(stageCalls[0][3].seed, 77);
});

test("polling GET /:id never charges", async () => {
  const p = await newMoment();
  for (let i = 0; i < 5; i += 1) await request(app).get(`/api/moments/${p.projectId}`);
  assert.deepEqual(charges, []);
});

test("a running render with no live job (a restart) reads as interrupted", async () => {
  const p = await newMoment();
  writeProject(dataDir, { ...readProject(dataDir, p.projectId), render: { jobId: "gone-job", status: "running", percent: 40, stage: "shots" } });
  const r = await request(app).get(`/api/moments/${p.projectId}`);
  assert.equal(r.body.project.render.status, "interrupted");
});

test("PUT and DELETE are refused while rendering", async () => {
  const p = await newMoment();
  writeProject(dataDir, { ...readProject(dataDir, p.projectId), render: { jobId: "j", status: "running", percent: 0, stage: "x" } });
  assert.equal((await request(app).put(`/api/moments/${p.projectId}`).send({ title: "x" })).status, 409);
  assert.equal((await request(app).delete(`/api/moments/${p.projectId}`)).status, 409);
});

test("DELETE removes the Moment, its videos and its voiceover", async () => {
  const p = await newMoment();
  const video = `moment-${crypto.randomUUID()}.mp4`;
  const vo = `moment-vo-${crypto.randomUUID()}.mp3`;
  fs.writeFileSync(path.join(outputDir, video), "v");
  fs.writeFileSync(path.join(outputDir, vo), "a");
  writeProject(dataDir, {
    ...readProject(dataDir, p.projectId),
    history: [{ jobId: "j", file: `/outputs/${video}`, createdAt: 1, seed: 1 }, { jobId: "k", file: "/outputs/../../etc/passwd", createdAt: 2, seed: 2 }],
    sound: { song: null, voiceover: { script: "s", voiceId: "v", file: vo } },
  });
  const r = await request(app).delete(`/api/moments/${p.projectId}`);
  assert.equal(r.status, 200);
  assert.equal(fs.existsSync(path.join(outputDir, video)), false);
  assert.equal(fs.existsSync(path.join(outputDir, vo)), false);
  assert.equal(readProject(dataDir, p.projectId), null);
});

test("library images are listed as URLs, never server paths", async () => {
  const r = await request(app).get("/api/moments/library-images");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.images, []);
});

test("song-window reports the auto window and the user's own start, and needs a song", async () => {
  const calls = [];
  _setSongGridImpl(async (_ctx, _file, opts) => {
    calls.push(opts);
    return { durationSec: 180, tempo: 99.5, windowStartSec: opts.windowStartSec ?? 42, grid: {} };
  });
  try {
    const p = await newMoment();
    const auto = await request(app).get(`/api/moments/${p.projectId}/song-window`);
    assert.equal(auto.status, 200, JSON.stringify(auto.body));
    assert.deepEqual(auto.body, { ok: true, durationSec: 180, tempo: 99.5, windowStartSec: 42, autoStartSec: 42 });
    await request(app).put(`/api/moments/${p.projectId}`).send({ sound: { song: { ref: "library:gospel-fire", windowStartSec: 10 } } });
    const own = await request(app).get(`/api/moments/${p.projectId}/song-window`);
    assert.equal(own.body.windowStartSec, 10);
    assert.equal(own.body.autoStartSec, 42);
    await request(app).put(`/api/moments/${p.projectId}`).send({ sound: { song: null } });
    assert.equal((await request(app).get(`/api/moments/${p.projectId}/song-window`)).status, 400);
    assert.deepEqual(charges, [], "never charged");
  } finally {
    _resetSongGridImpl();
  }
});

test("a free user over quota gets 429 from the render", async () => {
  _setQuotaImpl(() => (_req, res) => res.status(429).json({ ok: false, error: "Daily limit reached" }));
  const p = await newMoment();
  await request(app).put(`/api/moments/${p.projectId}`).send({ photos: [upload(), upload(), upload()] });
  const r = await request(app).post(`/api/moments/${p.projectId}/render`).send();
  assert.equal(r.status, 429);
  assert.equal(stageCalls.length, 0);
  assert.equal(readProject(dataDir, p.projectId).render, null);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/routes/moments.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `routes/moments.js`**

`server/src/routes/moments.js`:

```js
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Router } from "express";
import { quota } from "../middleware/quota.js";
import { runExclusive } from "../lib/heavyJobGate.js";
import { createJob, persistJob, markError, getJob, cancelJob } from "../lib/renderJobs.js";
import { refineScript } from "../lib/story/scriptRefine.js";
import { cleanSpeakableText } from "../lib/speakableScript.js";
import { synthesizeEdgeTts } from "../lib/edgeTts.js";
import { STYLES } from "../lib/motion/styles.js";
import { normaliseSeed } from "../lib/kinetic/renderCaptions.js";
import {
  OCCASIONS, LENGTHS, STATEMENT_LIMIT, TITLE_MAX, STATEMENT_MAX, DETAIL_MAX, MAX_STATEMENTS, resolveOccasion,
} from "../lib/moments/occasions.js";
import {
  createProject, readProject, writeProject, listProjects, deleteProject, applyUpdate, isRendering, MIN_PHOTOS, MAX_PHOTOS,
} from "../lib/moments/projectStore.js";
import { resolvePhotos, resolveSong } from "../lib/moments/photos.js";
import { songGrid } from "../lib/moments/beatCache.js";
import { readLibrary } from "../lib/imageGen/imageLibrary.js";
import { libraryImageView } from "../lib/ambient/movementImage.js";
import { suggestStatements } from "../lib/moments/statements.js";
import { momentRenderStage, cancelMomentRender, VOICE_NAME, OUTPUT_NAME } from "../lib/moments/renderStage.js";

/**
 * Moments: one-tap photo videos for birthdays, sermons and events.
 *
 * Mounted WITHOUT a blanket quota (see index.js): the page polls GET /:id
 * while a render runs, and a per-request charge would empty a free user's
 * allowance in seconds. Each expensive POST charges its own bucket inline,
 * after its own checks pass.
 */
let _quota = quota;
export function _setQuotaImpl(fn) { _quota = fn; }
export function _resetQuotaImpl() { _quota = quota; }
let _renderStage = momentRenderStage;
export function _setRenderStageImpl(fn) { _renderStage = fn; }
export function _resetRenderStageImpl() { _renderStage = momentRenderStage; }
let _tts = synthesizeEdgeTts;
export function _setTtsImpl(fn) { _tts = fn; }
export function _resetTtsImpl() { _tts = synthesizeEdgeTts; }

const SCRIPT_MAX = 1200;
const router = Router();

function charged(bucket, req, res) {
  let passed = false;
  _quota(bucket)(req, res, () => { passed = true; });
  return passed;
}

function loadOr404(req, res) {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) res.status(404).json({ ok: false, error: "Moment not found" });
  return project;
}

/** The stored project as the client sees it: live percent, and a dead job as interrupted. */
function view(project) {
  const r = project.render;
  if (r?.status !== "running" || !r.jobId) return project;
  const job = getJob(r.jobId);
  if (!job) return { ...project, render: { ...r, status: "interrupted" } };
  return typeof job.percent === "number" ? { ...project, render: { ...r, percent: Math.max(r.percent || 0, job.percent) } } : project;
}

function removeOutput(outputDir, name, pattern) {
  if (!pattern.test(String(name || ""))) return;
  try { fs.unlinkSync(path.join(outputDir, name)); } catch { /* already gone */ }
}

router.get("/meta", (_req, res) => {
  res.json({
    ok: true,
    occasions: Object.values(OCCASIONS).map(({ id, label, church, fields, style, energy, song }) => ({ id, label, church, fields, style, energy, song })),
    styles: Object.values(STYLES).map(({ id, label, description }) => ({ id, label, description })),
    lengths: LENGTHS,
    limits: {
      statements: STATEMENT_LIMIT, maxStatements: MAX_STATEMENTS, title: TITLE_MAX, statement: STATEMENT_MAX,
      detail: DETAIL_MAX, minPhotos: MIN_PHOTOS, maxPhotos: MAX_PHOTOS,
    },
  });
});

router.get("/", (req, res) => res.json({ ok: true, projects: listProjects(req.ctx.dataDir) }));

router.get("/library-images", (req, res) => {
  res.json({ ok: true, images: libraryImageView(readLibrary(req.ctx.dataDir)?.items || []) });
});

router.post("/", (req, res) => {
  if (!resolveOccasion(req.body?.occasion)) return res.status(400).json({ ok: false, error: "choose an occasion" });
  return res.json({ ok: true, project: createProject(req.ctx.dataDir, { occasion: req.body.occasion }) });
});

router.get("/:id", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  return res.json({ ok: true, project: view(project) });
});

// The song's length and its best window at this Moment's length, for the
// "start at" slider. Cached by content hash, so only the first call decodes.
let _songGridFn = songGrid;
export function _setSongGridImpl(fn) { _songGridFn = fn; }
export function _resetSongGridImpl() { _songGridFn = songGrid; }
router.get("/:id/song-window", async (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  const song = project.sound?.song;
  const file = song ? resolveSong(req.ctx, song.ref) : null;
  if (!file) return res.status(400).json({ ok: false, error: "choose a song first" });
  try {
    const auto = await _songGridFn(req.ctx, file, { lengthSec: project.lengthSec });
    const chosen = song.windowStartSec === null
      ? auto
      : await _songGridFn(req.ctx, file, { lengthSec: project.lengthSec, windowStartSec: song.windowStartSec });
    return res.json({
      ok: true, durationSec: auto.durationSec, tempo: auto.tempo, windowStartSec: chosen.windowStartSec, autoStartSec: auto.windowStartSec,
    });
  } catch (e) {
    console.error(`[moments] song window ${project.projectId}:`, e);
    return res.status(422).json({ ok: false, error: "That song couldn't be read. Pick another song." });
  }
});

router.put("/:id", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (isRendering(view(project))) return res.status(409).json({ ok: false, error: "this Moment is rendering" });
  const body = { ...(req.body || {}) };
  if ("photos" in body) {
    if (!Array.isArray(body.photos)) return res.status(400).json({ ok: false, error: "photos must be a list" });
    if (body.photos.length > MAX_PHOTOS) return res.status(400).json({ ok: false, error: `up to ${MAX_PHOTOS} photos` });
    const resolved = resolvePhotos(req.ctx, body.photos);
    if (!resolved.ok) return res.status(400).json({ ok: false, error: resolved.error });
    body.photos = resolved.photos;
  }
  const r = applyUpdate(project, body);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
  return res.json({ ok: true, project: writeProject(req.ctx.dataDir, r.project) });
});

router.delete("/:id", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (isRendering(view(project))) return res.status(409).json({ ok: false, error: "this Moment is rendering" });
  for (const h of project.history || []) removeOutput(req.ctx.outputDir, path.basename(String(h.file || "")), OUTPUT_NAME);
  removeOutput(req.ctx.outputDir, project.sound?.voiceover?.file, VOICE_NAME);
  deleteProject(req.ctx.dataDir, project.projectId);
  return res.json({ ok: true });
});

router.post("/:id/statements", async (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (!charged("scripts", req, res)) return undefined;
  const suggestion = await suggestStatements({ occasion: project.occasion, details: project.details, lengthSec: project.lengthSec });
  return res.json({ ok: true, suggestion });
});

router.post("/:id/voiceover", async (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (isRendering(view(project))) return res.status(409).json({ ok: false, error: "this Moment is rendering" });
  const typed = String(req.body?.script || "").trim();
  const idea = String(req.body?.idea || "").trim();
  if (!typed && idea.length < 3) return res.status(400).json({ ok: false, error: "write the voiceover, or describe it for the AI" });
  if (typed.length > SCRIPT_MAX || idea.length > SCRIPT_MAX) return res.status(400).json({ ok: false, error: `up to ${SCRIPT_MAX} characters` });
  if (typed && cleanSpeakableText(typed).length < 3) return res.status(400).json({ ok: false, error: "the voiceover is empty" });
  if (!charged("tts", req, res)) return undefined;
  try {
    const occ = resolveOccasion(project.occasion);
    const raw = typed || await refineScript({ idea, template: { prompt: occ?.voicePrompt || "", targetSeconds: Math.max(8, project.lengthSec - 3) } });
    const script = cleanSpeakableText(raw).slice(0, SCRIPT_MAX);
    const voiceId = req.body?.voiceId ? String(req.body.voiceId).slice(0, 100) : undefined;
    const tts = await _tts({ text: script, voiceId });
    if (!tts?.ok || !tts.file) return res.status(502).json({ ok: false, error: tts?.error || "voice synthesis failed" });
    fs.mkdirSync(req.ctx.outputDir, { recursive: true });
    const name = `moment-vo-${crypto.randomUUID()}.mp3`;
    const dest = path.join(req.ctx.outputDir, name);
    try { fs.renameSync(tts.file, dest); } catch { fs.copyFileSync(tts.file, dest); try { fs.unlinkSync(tts.file); } catch { /* temp file */ } }
    const live = readProject(req.ctx.dataDir, project.projectId);
    removeOutput(req.ctx.outputDir, live.sound?.voiceover?.file, VOICE_NAME);
    const saved = writeProject(req.ctx.dataDir, { ...live, sound: { ...live.sound, voiceover: { script, voiceId: voiceId || null, file: name } } });
    return res.json({ ok: true, project: saved });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/:id/render", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (isRendering(view(project))) return res.status(409).json({ ok: false, error: "this Moment is already rendering" });
  if ((project.photos || []).length < MIN_PHOTOS) return res.status(400).json({ ok: false, error: `add at least ${MIN_PHOTOS} photos` });
  const seed = req.body?.seed === undefined ? project.seed : normaliseSeed(req.body.seed);
  if (!charged("render", req, res)) return undefined;

  const job = createJob(req.ctx.userId, { durationSec: project.lengthSec });
  persistJob(req.ctx.dataDir, { ...job, projectId: project.projectId, status: "running" });
  writeProject(req.ctx.dataDir, { ...project, render: { jobId: job.jobId, status: "running", percent: 0, stage: "waiting" } });
  const ctx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir, userId: req.ctx.userId };
  const id = project.projectId;
  runExclusive(() => _renderStage(ctx, id, job.jobId, { seed }), {
    onQueued: () => {
      const live = readProject(ctx.dataDir, id);
      if (live) writeProject(ctx.dataDir, { ...live, render: { ...live.render, stage: "waiting for another video to finish" } });
    },
  }).catch((err) => {
    // A rejected fire-and-forget is an unhandled rejection, which kills the server.
    const message = "Something went wrong while making this Moment. Please try again.";
    console.error(`[moments] render ${id} rejected:`, err);
    try { markError(job.jobId, message); } catch { /* already errored */ }
    const live = readProject(ctx.dataDir, id);
    if (live) writeProject(ctx.dataDir, { ...live, render: { jobId: job.jobId, status: "error", percent: 0, stage: "error", error: message } });
  });
  return res.json({ ok: true, jobId: job.jobId });
});

router.post("/:id/cancel", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  cancelMomentRender(project.projectId);
  if (project.render?.jobId) { try { cancelJob(project.render.jobId, req.ctx.userId); } catch { /* gone */ } }
  return res.json({ ok: true });
});

export default router;
```

- [ ] **Step 4: Mount the router in `server/index.js`**

Add the import beside `ambientRouter`:

```js
import momentsRouter from "./src/routes/moments.js";
```

Add the mount directly after the `/api/ambient` line:

```js
// Moments carries NO blanket quota, for the same reason as Ambient: the page
// polls GET /api/moments/:id during a render. The expensive POSTs (statements,
// voiceover, render) charge their own bucket inside routes/moments.js.
app.use("/api/moments",   requireAuth, withUserScope, requireVerifiedEmail,                      momentsRouter);
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd server && node --test src/routes/moments.test.js`
Expected: all PASS.

- [ ] **Step 6: Run the whole server suite**

Run: `cd server && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/moments.js server/src/routes/moments.test.js server/index.js
```

```bash
git commit -m "feat: /api/moments routes (projects, statements, voiceover, render, cancel)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After this plan

Plan C (`docs/superpowers/plans/2026-10-12-moments-client.md`) builds `MomentsPage` on these routes.
