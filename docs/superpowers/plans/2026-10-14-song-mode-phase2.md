# Song mode Phase 2 (Direction) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every lyric line a deliberate look. That means an effect menu per line, a new `echo` effect for crowd responses, a handwritten "soft" style, the full section policy with energy step-downs, a Shuffle that re-rolls only Auto lines, and better timing from the laptop's vocal stem when it is online.

**Architecture:**
- **Engine:** the kinetic caption engine (`server/src/lib/kinetic/`) gains an `echo` effect and an opt-in soft font pairing.
- **Policy:** the Song-mode policy (`server/src/lib/lyricVideo/policy.js`) takes a seed and the full energy step-downs.
- **Captions build:** `lyricAss.js` marks soft lines and keeps a call on screen with its echo.
- **Look step:** gains a per-line effect list and a Shuffle button.
- **Laptop stems queue:** learns a `vocals` stem with a capability handshake, so old workers are never handed vocals jobs.
- **Timing job:** asks for vocals when a capable laptop is online, and waits up to 4 minutes.

**Tech Stack:** Node 22 ESM + `node:test` (server), React 18 + TypeScript + Vitest + Testing Library (client), ASS subtitles via libass/ffmpeg 5.1.9 (prod) and JASSUB (preview), python-audio-separator on the operator's laptop.

**Spec:** `docs/superpowers/specs/2026-10-13-song-mode-lyric-video-design.md`. Phase 2 = §14 item 2. Relevant: §3 step 4, §4 (`effect`, `usedVocalStem`), §5.2, §6.1–6.3, §11 (PATCH `effect`), §12 ("Laptop stem not ready in 4 min → carry on with the mix").

**Code map** (facts gathered before planning; read it first): `.superpowers/sdd/2026-10-14-song-mode-phase2/codemap.md`.

## Global Constraints

- Prod FFmpeg is **5.1.9**. Use only filters and options that exist in 5.1. Pass filter graphs with `-filter_complex_script`, and never use `y_align`.
- Shorts-safe tall layout: nothing drawn above **0.11 h** or below **0.75 h**, and the right **12%** kept clear (spec §6.4). `shortsInk.test.js` enforces this for every effect.
- Engine guards stay: no slam within **4 s**, frames **≥ 30 s** apart, curves **≥ 20 s** apart. A line's own menu choice (not `auto`) always wins.
- Echo geometry (spec §6.2):
  - the look's **hit** font, filled with the **body** colour and outlined in the **hit** colour
  - about **10.5%** of frame width
  - tilted **+6°**, popping in at **175%**
  - tall/shorts anchor **y = 0.645 h**, wide anchor **y = 0.72 h**
  - sparks on the last word
- Soft style (spec §6.3): body **Caveat Bold** (`Caveat-Bold.ttf`, already in `server/assets/fonts`) at scale **1.35**. The key word uses the look's hit font and colour when that font covers the text.
- Vocal stem (spec §5.2): only when a laptop is online. Wait up to **4 minutes**, then carry on with the mix and record `timing.usedVocalStem`. Beats and the audible end are still measured on the original song.
- UI copy is plain English. Never use "ASS", "seed", "stem", "alignment" or "Whisper" in the UI. Say "vocals only", "mix", "effect" instead.
- UI follows `~/.claude/standards/DESIGN_QUALITY_STANDARD.md`:
  - reuse `client/src/components/story/formStyles.ts` classes and existing tokens
  - no new colours, gradients or glows
  - sentence-case labels
  - labelled controls with visible focus
- `server/public` is never committed with Firebase keys. The bundle is rebuilt and committed once, at the end of the phase, with `client/.env.local` absent.
- Commits are conventional (`feat:`, `fix:`, `test:`, `chore:`). Each ends with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use `--no-verify`. Never push.
- Server tests: `cd server && node --test "<glob>"`. Use globs; bare directories fail on this Node. Client tests: `cd client && npx vitest run <file>`.
- Known environmental flakes on this machine: `motion/prepare.test.js` panorama ENOMEM and the `render.captionedVideo` poll timeout. Re-run a failing file alone before calling it a failure.
- Write code containing backslashes (ASS tags, regex) with the Write/Edit tools, never bash heredocs.

## Review Focus

1. **A call drawn in the lower band, followed by an echo.**
   - Risk: a `pop` or `quote` call followed by its echo would overlap at about 0.65 h.
   - Expected: on Auto lines, the call moves out of the lower band, so the two never overlap.
   - Pinned by the Task 4 test "a call before an echo leaves the lower band".
2. **An old laptop worker (no vocals support) is online.**
   - Expected: it is never handed a vocals job, and timing does not wait 4 minutes for nothing.
   - Pinned by Task 5 "claimNext skips vocals jobs for workers without the vocals capability" and Task 6 "no capable laptop → no wait".
3. **Shuffle with lines the user set by hand.**
   - Expected: lines with their own effect never change, and no timing changes.
   - Pinned by Task 3 "a seed never changes a line's own choice".
4. **Yoruba or accented soft lines under a look whose fonts lack the letters.**
   - Expected: drawn in Caveat, not DejaVu boxes, and still inside the Shorts band.
   - Pinned by Task 2 "a soft line uses Caveat and stays in the band" and the soft loop in `shortsInk.test.js`.
5. **The last call and echo of the song, with no following lead line.**
   - Expected: they hold no later than the music's end (`timing.audibleEnd`, or the song duration).
   - Pinned by Task 4 "the last call and echo stop by the audible end".

---

### Task 1: The `echo` engine effect

**Files:**
- Create: `server/src/lib/kinetic/effects/echo.js`
- Modify: `server/src/lib/kinetic/layout.js` (add `ECHO`), `server/src/lib/kinetic/director.js:6` (`EFFECT_IDS`), `server/src/lib/kinetic/ass.js:260` (`EFFECTS`)
- Test: `server/src/lib/kinetic/effects/echo.test.js`. Also update `server/src/lib/kinetic/shortsLayout.test.js:43-46` (the pinned key list) and `server/src/lib/kinetic/ass.test.js:84-101` (add an `echo` fingerprint).

**Interfaces:**
- Consumes: `fontsFor`, `caseText`, `holdEnd`, `lineEvent`, `sparksEvent`, `wrapWords`, `inkAllowance`, `shortsMargin`, `shortsCentre` from `effects/common.js`; `widthAt`, `fitSize` from `text.js`; `isTall` from `layout.js`.
- Produces:
  - `ECHO` anchors in `layout.js`: `{ wide:{x:.5,y:.72}, tall:{x:.47,y:.645}, shorts:{x:.47,y:.645} }`.
  - `EFFECT_IDS` now includes `"echo"`.
  - `EFFECTS.echo = render`.
  - The random director pools (`MIX`) do **not** include echo, so other caption features get echo only when forced through `overrides`.

- [ ] **Step 1: Write the failing test**

```js
// server/src/lib/kinetic/effects/echo.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "./echo.js";
import { planned, ctx } from "./testkit.js";
import { EFFECT_IDS } from "../director.js";
import { EFFECTS } from "../ass.js";

const shorts = (p) => ctx(p, { w: 720, h: 1280, aspect: "shorts" });
const head = (line) => line.match(/\{[^}]*\}/)[0];

test("echo is a registered effect but never a random pick", () => {
  assert.ok(EFFECT_IDS.includes("echo"));
  assert.equal(typeof EFFECTS.echo, "function");
});

test("echo draws in the hit font, filled with the body colour and outlined in the hit colour", () => {
  const lines = render(shorts(planned("(WHO TALK SAY?!)", "echo")));
  const dialogue = lines.filter((l) => !/\\p1/.test(l));
  assert.ok(dialogue.length >= 1);
  const h0 = head(dialogue[0]);
  assert.match(h0, /\\fnKnewave/);          // lagos-night hit font
  assert.match(h0, /\\frz6\b/);             // tilted +6°
  assert.match(h0, /\\fscx175\\fscy175/);   // pops in at 175%
  assert.match(h0, /\\3c&H3AD3F5&/);        // outline = hit colour #F5D33A (ASS is BGR)
});

test("echo sits in the lower band at about 0.645 h on a tall frame", () => {
  const dialogue = render(shorts(planned("(NO DEY LATE!)", "echo"))).filter((l) => !/\\p1/.test(l));
  const y = Number(/\\move\(\d+,\d+,\d+,(\d+)/.exec(head(dialogue[0]))[1]);
  assert.ok(Math.abs(y - 0.645 * 1280) < 0.05 * 1280, `y=${y}`);
});

test("echo ends with sparks on its last word", () => {
  assert.ok(render(shorts(planned("(WHO TALK SAY?!)", "echo"))).some((l) => /\\p1/.test(l)));
});

test("a wide frame anchors the echo at about 0.72 h", () => {
  const dialogue = render(ctx(planned("(NO DEY LATE!)", "echo"))).filter((l) => !/\\p1/.test(l));
  const y = Number(/\\move\(\d+,\d+,\d+,(\d+)/.exec(head(dialogue[0]))[1]);
  assert.ok(Math.abs(y - 0.72 * 720) < 0.06 * 720, `y=${y}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && node --test "src/lib/kinetic/effects/echo.test.js"`
Expected: FAIL (`Cannot find module './echo.js'`).

- [ ] **Step 3: Add the anchors and the effect**

In `layout.js`, next to `LOWER` and `CENTRE`:

```js
/** Where a crowd reply sits: under the call, in the lower band (spec §6.2). */
export const ECHO = Object.freeze({ wide: { x: 0.5, y: 0.72 }, tall: { x: 0.47, y: 0.645 }, shorts: { x: 0.47, y: 0.645 } });
```

```js
// server/src/lib/kinetic/effects/echo.js
// A crowd reply under its call: the look's hit font filled with the body colour, outlined in the
// hit colour, tilted +6°, popping in at 175%, with sparks on the last word (spec §6.2).
import { ECHO, isTall, maxWidthFor } from "../layout.js";
import { widthAt } from "../text.js";
import { caseText, fontsFor, holdEnd, inkAllowance, lineEvent, shortsCentre, shortsMargin, sparksEvent, wrapWords } from "./common.js";

const BORD = 5;
const SHAD = 3;
const POP = 175;
const TILT = 6;
const MIN_FS = 24;

export function render({ planned, look, w, h, aspect, nextStart }) {
  const { phrase } = planned;
  const text = caseText(look, phrase.words.map((x) => x.text).join(" "));
  const fonts = fontsFor(look, text, { soft: phrase.soft === true });
  const anchor = ECHO[aspect];
  const words = phrase.words.map((x) => ({ text: caseText(look, x.text), t: x.start, colour: fonts.body.colour }));
  const maxWidth = maxWidthFor({ side: false }, w, aspect);
  let fs = Math.round((isTall(aspect) ? w : h) * 0.105);
  const budget = (size) => maxWidth - inkAllowance(size, { bord: BORD, shad: SHAD, italic: fonts.hit.italic, bold: fonts.hit.bold });
  let lines = wrapWords(words, fonts.hit.file, fs, budget(fs));
  while (lines.length > 2 && fs > MIN_FS) { fs = Math.max(MIN_FS, Math.floor(fs * 0.92)); lines = wrapWords(words, fonts.hit.file, fs, budget(fs)); }
  const end = holdEnd(phrase, nextStart);
  const lineGap = fs * 1.1;
  const widest = Math.max(...lines.map((ln) => widthAt(fonts.hit.file, ln.map((x) => x.text).join(" "), fs)));
  const margin = shortsMargin({ aspect, lineGap, fs, bord: BORD, rot: TILT, width: widest, pop: POP });
  const cy = shortsCentre({ aspect, cy: anchor.y * h, blockHeight: lines.length * lineGap, margin, h });
  const y0 = cy - ((lines.length - 1) * lineGap) / 2;
  const events = lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: anchor.x * w, y: y0 + i * lineGap, fs, family: fonts.hit.family, rot: TILT, pop: POP,
    bord: BORD, shad: SHAD, outline: fonts.hit.colour, words: ln, bold: fonts.hit.bold, italic: fonts.hit.italic, layer: 1,
  }));
  const lastLine = lines[lines.length - 1];
  const lastWidth = widthAt(fonts.hit.file, lastLine.map((x) => x.text).join(" "), fs);
  const sparkR = Math.round(Math.min(w, h) * 0.05);
  const sparkMaxX = (isTall(aspect) ? 0.88 : 0.94) * w - 1.6 * sparkR;
  const sparks = sparksEvent({
    x: Math.min(anchor.x * w + lastWidth / 2 - w * 0.01, sparkMaxX),
    y: y0 + (lines.length - 1) * lineGap - fs * 0.55,
    at: lastLine[lastLine.length - 1].t, r: sparkR, colour: fonts.hit.colour,
    until: Number.isFinite(phrase.holdUntil) ? end : undefined,
  });
  if (sparks) events.push(sparks);
  return events;
}
```

`fontsFor(look, text, { soft })` gains its third argument in Task 2. Until then the extra argument is ignored, so Task 1 passes on its own.

Register the effect: in `director.js:6` set `EFFECT_IDS = Object.freeze(["pop", "stack", "slam", "quote", "curve", "frame", "title", "echo"])`. In `ass.js` add `import { render as echo } from "./effects/echo.js";` and `echo` to `EFFECTS`. In `shortsLayout.test.js:43-46` add `"echo"` to the sorted list. In `ass.test.js` `FINGERPRINTS` add `echo: (s) => /\\frz6\b/.test(s) && /\\fscx175/.test(s)`.

Check that `lineEvent` emits `\frz${rot}` with the integer as given. If it formats differently, adjust the test regex to match its real output, never the reverse.

- [ ] **Step 4: Run the kinetic tests**

Run: `cd server && node --test "src/lib/kinetic/**/*.test.js"`
Expected: PASS. `shortsInk.test.js` loops `Object.keys(EFFECTS)`, so echo is now checked for the Shorts band on 3 looks × 3 energies × 12 seeds. If it fails, fix the effect (size or wrap), not the test.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/kinetic
git commit -m "feat: echo caption effect for crowd replies"
```

---

### Task 2: The soft style (Caveat pairing)

**Files:**
- Modify: `server/src/lib/kinetic/looks.js` (add `SOFT_FONT`), `server/src/lib/kinetic/effects/common.js:35` (`fontsFor`), every effect that calls `fontsFor` (`pop`, `stack`, `slam`, `quote`, `curve`, `frame`, `title`, `echo`), `server/src/lib/kinetic/ass.js:37` (`phrasesFrom` passes `soft`), `client/src/lib/lyricPreviewFonts.ts`
- Test: `server/src/lib/kinetic/effects/soft.test.js`. Also extend `server/src/lib/kinetic/shortsInk.test.js` (the `fileFor` lookup gets `SOFT_FONT`, plus a soft loop), and `server/src/lib/kinetic/looks.test.js` (the font file exists).

**Interfaces:**
- Consumes: `covers(file, text)` from `text.js`; `FALLBACK_FONT` from `looks.js`.
- Produces:
  - `SOFT_FONT = { file: "Caveat-Bold.ttf", family: <internal family name>, scale: 1.35 }` exported from `looks.js`.
  - `fontsFor(look, text, { soft = false } = {})` returns `{ body, hit }`.
  - A phrase can carry `soft: true`. `phrasesFrom` copies `line.soft` onto the phrase, and every effect passes `{ soft: phrase.soft === true }`.

Rules (spec §6.3; the blast radius is kept to soft phrases only):
- `soft` is false and the look's fonts cover the text: the look's fonts, exactly as today.
- `soft` is false and they don't cover it: the DejaVu fallback, exactly as today. Other caption features are unchanged.
- `soft` is true and Caveat covers the text:
  - body is Caveat (scale 1.35) in the body colour
  - hit is the look's hit font when it covers the text, otherwise Caveat in the hit colour
- `soft` is true but Caveat doesn't cover it: DejaVu, as today.

- [ ] **Step 1: Confirm Caveat's internal family name**

libass and JASSUB match the font's *internal* family name. Run:

```bash
cd server && node -e "const f=require('fs').readFileSync('assets/fonts/Caveat-Bold.ttf');const n=f.readUInt16BE(4);for(let i=0;i<n;i++){const o=12+i*16;if(f.toString('latin1',o,o+4)==='name'){const t=f.readUInt32BE(o+8);const c=f.readUInt16BE(t+2),s=t+f.readUInt16BE(t+4);for(let r=0;r<c;r++){const p=t+6+r*12;const id=f.readUInt16BE(p+6),len=f.readUInt16BE(p+8),off=f.readUInt16BE(p+10),plat=f.readUInt16BE(p);if(id===1||id===16){const b=f.subarray(s+off,s+off+len);console.log(id,plat,plat===3?b.swap16().toString('utf16le'):b.toString('latin1'))}}}}"
```

Use the family it prints (name id 16 if present, else 1). The plan assumes `"Caveat"`; if the font says otherwise, use what it says, both here and in the client map key (lower-cased).

- [ ] **Step 2: Write the failing tests**

```js
// server/src/lib/kinetic/effects/soft.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fontsFor } from "./common.js";
import { SOFT_FONT, resolveLook, FALLBACK_FONT } from "../looks.js";
import { covers } from "../text.js";
import { buildAss } from "../ass.js";

const look = resolveLook("studio-lagos-night");
const yoruba = "Ẹ ṣeun Jésù fún ìfẹ́ rẹ";

test("Caveat covers Yoruba tone-marked text", () => {
  assert.ok(covers(SOFT_FONT.file, yoruba));
});

test("without the soft flag nothing changes: look fonts, or DejaVu when they lack the letters", () => {
  assert.equal(fontsFor(look, "MY TIME NO LATE").body.file, look.body.file);
  assert.equal(fontsFor(look, yoruba).body.file, FALLBACK_FONT.file);
});

test("a soft phrase uses Caveat at 1.35 in the body colour", () => {
  const f = fontsFor(look, "In the quiet of the night", { soft: true });
  assert.equal(f.body.file, SOFT_FONT.file);
  assert.equal(f.body.scale, 1.35);
  assert.equal(f.body.colour, look.body.colour);
  assert.equal(f.hit.file, look.hit.file); // Knewave covers plain Latin
});

test("a soft Yoruba phrase falls back to Caveat for the key word too", () => {
  const f = fontsFor(look, yoruba, { soft: true });
  assert.equal(f.body.file, SOFT_FONT.file);
  assert.equal(f.hit.file, SOFT_FONT.file);
  assert.equal(f.hit.colour, look.hit.colour);
});

test("a soft line drawn by buildAss names Caveat", () => {
  const lines = [{ text: yoruba, start: 2, end: 5, soft: true }];
  const words = yoruba.split(" ").map((t, i) => ({ text: t, start: 2 + i * 0.5, end: 2.4 + i * 0.5 }));
  const out = buildAss({ words, lines, w: 720, h: 1280, look, energy: "lively", layout: "shorts", overrides: { 0: "stack" } });
  assert.match(out, new RegExp(`\\\\fn${SOFT_FONT.family}`));
});
```

In `shortsInk.test.js`:
- Add `SOFT_FONT` to the `fileFor` search list: `[look.body, look.hit, SOFT_FONT, FALLBACK_FONT]`.
- Add a second loop that builds the same song with `lines` input where every line carries `soft: true` (effects × 3 looks × energy `wild` × seeds 1..3), asserting the same band rules.

In `looks.test.js`, assert `fs.existsSync(path.join(FONT_DIR, SOFT_FONT.file))`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && node --test "src/lib/kinetic/effects/soft.test.js"`
Expected: FAIL (`SOFT_FONT` is not exported).

- [ ] **Step 4: Implement**

`looks.js`, beside `FALLBACK_FONT`:

```js
/** The handwritten pairing for soft lines (bridges, tone-marked Yoruba): spec §6.3. */
export const SOFT_FONT = Object.freeze({ file: "Caveat-Bold.ttf", family: "Caveat", scale: 1.35 });
```

`effects/common.js`, replacing `fontsFor`:

```js
export function fontsFor(look, text, { soft = false } = {}) {
  const bodyOk = covers(look.body.file, text);
  const hitOk = covers(look.hit.file, text);
  if (!soft && bodyOk && hitOk) return { body: look.body, hit: look.hit };
  if (soft && covers(SOFT_FONT.file, text)) {
    return {
      body: { ...SOFT_FONT, colour: look.body.colour },
      hit: hitOk ? look.hit : { ...SOFT_FONT, colour: look.hit.colour },
    };
  }
  return { body: { ...FALLBACK_FONT, colour: look.body.colour }, hit: { ...FALLBACK_FONT, colour: look.hit.colour } };
}
```

In every effect, change `fontsFor(look, <text>)` to `fontsFor(look, <text>, { soft: phrase.soft === true })`. `phrase` is `planned.phrase` in each. In `ass.js` `phrasesFrom`, copy `soft: line.soft === true` onto each phrase built from `lines`, alongside `reveal` and `holdUntil`.

`client/src/lib/lyricPreviewFonts.ts`: add `caveat: \`${CAPTION_FONT_BASE}/Caveat-Bold.ttf\`` (key = the lower-cased family from Step 1). The existing client test `lyricPreviewFonts.test.ts` regex-scans `looks.js` for `file`/`family` pairs and will require it.

- [ ] **Step 5: Run the tests**

Run: `cd server && node --test "src/lib/kinetic/**/*.test.js"` and `cd client && npx vitest run src/lib/__tests__/lyricPreviewFonts.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/lib/kinetic client/src/lib/lyricPreviewFonts.ts
git commit -m "feat: handwritten soft style for bridges and tone-marked lines"
```

---

### Task 3: Full section policy: echo, energy step-downs, Shuffle seed

**Files:**
- Modify: `server/src/lib/lyricVideo/policy.js`
- Test: `server/src/lib/lyricVideo/policy.test.js`

**Interfaces:**
- Consumes: `mulberry32(seed)` from `server/src/lib/kinetic/director.js:20` (already exported).
- Produces: `chooseEffects({ lines, sections, title, energy, seed = 1 })` returns `string[]`, index-aligned with `lines`. The changes:
  1. Every Auto `response` line becomes `echo`, in every energy.
  2. An Auto lead line followed directly by a response never ends up with a lower-band effect (`pop`, `quote`); it becomes `stack`. This check runs **last**, after the energy step, because calm turns `slam` and `title` into `pop`.
  3. Energy step-downs follow the engine's MIX:
     - `lively` (its pools have no frame): a `frame` becomes `slam` when the slam guards allow it (≤ 4 words, 4 s since the last slam), otherwise `stack`. This happens **before** the spacing bookkeeping, so the new slam counts for the 4 s gap.
     - `calm` (its pools are pop and stack only): `{ slam: "pop", frame: "stack", curve: "stack", quote: "stack", title: "pop" }`, applied after the bookkeeping as today, so calm is the same plan made quiet.
     - Echo is never stepped.
  4. The seed re-rolls only the Auto choices where the policy has alternatives: which of `stack`/`pop` each section's alternation starts with.
     - Seed 1 keeps today's output ("stack" first), so existing expectations hold.
     - A line's own choice (`effect` other than `auto`) is never changed by seed or energy.

- [ ] **Step 1: Write the failing tests** (append to `policy.test.js`; reuse its `lineMaker` helper and `sections` fixtures, adapting the names to what the file already defines)

```js
describe("Phase 2 direction", () => {
  const S = [{ id: "s1", kind: "chorus" }, { id: "s2", kind: "verse" }];
  const L = (id, sectionId, kind, text, start, effect = "auto") => ({ id, sectionId, kind, text, start, end: start + 1.5, effect });
  const song = [
    L("l1", "s1", "lead", "Who talk say", 10),
    L("l2", "s1", "response", "(WHO TALK SAY?!)", 11.7),
    L("l3", "s1", "lead", "My time no late, my time no late", 14),
    L("l4", "s2", "lead", "Everywhere you go", 40),
    L("l5", "s2", "lead", "Everybody get pain", 42),
    L("l6", "s2", "lead", "Some dey work double shift", 44),
  ];

  it("an Auto response becomes echo, in every energy", () => {
    for (const energy of ["calm", "lively", "wild"]) {
      assert.equal(chooseEffects({ lines: song, sections: S, title: "My Time No Late", energy })[1], "echo");
    }
  });

  it("a call before an echo leaves the lower band", () => {
    // The verse alternation makes the second line pop; a chorus slam becomes pop on calm.
    const verse = [L("a", "s2", "lead", "Everywhere you go", 5), L("b", "s2", "lead", "Everybody get pain", 7), L("c", "s2", "response", "(PAIN!)", 9)];
    const chorus = [L("d", "s1", "lead", "Who talk say", 20), L("e", "s1", "response", "(WHO TALK SAY?!)", 21.5)];
    for (const energy of ["calm", "lively", "wild"]) {
      for (let seed = 1; seed <= 5; seed++) {
        assert.ok(!["pop", "quote"].includes(chooseEffects({ lines: verse, sections: S, title: "x", energy, seed })[1]), `${energy}/${seed}`);
        assert.ok(!["pop", "quote"].includes(chooseEffects({ lines: chorus, sections: S, title: "x", energy, seed })[0]), `${energy}/${seed}`);
      }
    }
  });

  it("lively turns a frame into a slam only when the slam guards allow it", () => {
    const lines = [L("a", "s1", "lead", "My time no late", 10), L("b", "s1", "lead", "Go go", 11)];
    const fx = chooseEffects({ lines, sections: S, title: "My Time No Late", energy: "lively" });
    assert.equal(fx[0], "slam");   // the title line would frame on wild
    assert.notEqual(fx[1], "slam"); // within 4 s of that slam
  });

  it("lively has no frame; calm keeps only pop, stack and echo", () => {
    const lively = chooseEffects({ lines: song, sections: S, title: "My Time No Late", energy: "lively" });
    assert.ok(!lively.includes("frame"));
    const calm = chooseEffects({ lines: song, sections: S, title: "My Time No Late", energy: "calm" });
    assert.ok(calm.every((e) => ["pop", "stack", "echo"].includes(e)), calm.join());
  });

  it("seed 1 is today's output; another seed can start a section's alternation on pop", () => {
    const base = chooseEffects({ lines: song, sections: S, title: "My Time No Late", energy: "wild" });
    assert.deepEqual(chooseEffects({ lines: song, sections: S, title: "My Time No Late", energy: "wild", seed: 1 }), base);
    const verseStarts = new Set();
    for (let seed = 1; seed <= 20; seed++) verseStarts.add(chooseEffects({ lines: song, sections: S, title: "My Time No Late", energy: "wild", seed })[3]);
    assert.deepEqual([...verseStarts].sort(), ["pop", "stack"]);
  });

  it("a seed never changes a line's own choice", () => {
    const own = song.map((l, i) => (i === 3 ? { ...l, effect: "curve" } : l));
    for (let seed = 1; seed <= 10; seed++) {
      for (const energy of ["calm", "lively", "wild"]) {
        assert.equal(chooseEffects({ lines: own, sections: S, title: "x", energy, seed })[3], "curve");
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test "src/lib/lyricVideo/policy.test.js"`
Expected: FAIL (the response is `pop`, lively still frames, seed is ignored).

- [ ] **Step 3: Implement** (edit `policy.js`; keep its structure and the guards' state updates)

```js
import { mulberry32 } from "../kinetic/director.js";

const CALM_STEP = Object.freeze({ slam: "pop", frame: "stack", curve: "stack", quote: "stack", title: "pop" });
const LOWER_BAND = new Set(["pop", "quote"]);
```

- **Signature:** `export function chooseEffects({ lines, sections, title, energy, seed = 1 })`.
- **Seeded `flip`:** draw `const rnd = mulberry32(Math.floor(Number(seed)) || 1);` once at the top. Replace `flip(sectionId)`'s fixed "stack first" with a per-section first choice. When a section is first seen, draw `rnd()` once, in line order. The first effect is `"stack"` when `seed === 1`, otherwise `rnd() < 0.5 ? "stack" : "pop"`. After that it alternates. Draw for every section the first time it's seen, whether or not `flip` is used, so one section's choice never shifts another's.
- **Responses:** `else if (l.kind === "response") fx = "echo";`
- **The long-line clamp (L112):** must not touch `echo`. Responses are short, but guard it anyway: `fx !== "echo"`.
- **Lively frames**, after the clamp and before the bookkeeping lines: `if (!own && energy === "lively" && fx === "frame") fx = canSlam ? "slam" : "stack";`
- **The end of the map callback** replaces today's last line:

```js
    let out = !own && energy === "calm" ? CALM_STEP[fx] ?? fx : fx;
    // A call shares the screen with its echo (§6.2), so it stays out of the echo's lower band.
    if (!own && l.kind !== "response" && lines[i + 1]?.kind === "response" && LOWER_BAND.has(out)) out = "stack";
    return out;
```

- [ ] **Step 4: Run all lyricVideo policy and captions tests**

Run: `cd server && node --test "src/lib/lyricVideo/**/*.test.js"`
Expected: PASS. Existing tests that pinned `pop` for responses, or `frame` under lively, must be updated to the spec behaviour above. Cite §6.1/§6.2 in a comment on each changed expectation. Calm still equals the "same project with pinned effects" check in `lyricAss.test.js` (that test pins whatever the policy returns).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/lyricVideo/policy.js server/src/lib/lyricVideo/policy.test.js
git commit -m "feat: full lyric section policy with echo, energy step-downs and a shuffle seed"
```

---

### Task 4: Captions wiring: soft lines, call-and-echo hold, seed, resolved effects route

**Files:**
- Modify: `server/src/lib/lyricVideo/lyricAss.js`, `server/src/routes/lyricVideo.js` (new `GET /:id/effects`)
- Test: `server/src/lib/lyricVideo/lyricAss.test.js`, `server/src/routes/lyricVideo.test.js` (or the existing route test file; match its name)

**Interfaces:**
- Consumes: `chooseEffects({ …, seed })` (Task 3); phrase `soft` and `holdUntil` (Task 2, `common.js` `holdEnd`).
- Produces:
  - `buildLyricAss(project, { w, h, layout })` passes `seed: Number(project.look?.seed) || 1` to `chooseEffects`. Each phrase carries `soft: line.kind === "soft"`.
  - A lead line directly followed by response line(s), and each of those responses, gets `holdUntil`:
    - normally `min(nextLeadStart − 0.05, lastResponseEnd + 3)`
    - never earlier than its own `end + 0.25`
    - never later than `project.timing.audibleEnd ?? project.song.durationSec`
  - Exported helper `resolvedEffects(project)` returns `{ [lineId]: effect }` for placed lines, using exactly the inputs `buildLyricAss` uses.
  - `GET /api/lyric-video/:id/effects` returns `{ effects: { [lineId]: string } }`. It uses the existing `load(req)` ownership, and does not charge quota.

- [ ] **Step 1: Write the failing tests** (in `lyricAss.test.js`, reusing its `project` fixture; build small projects inline)

```js
import { buildLyricAss, resolvedEffects } from "./lyricAss.js";

const timed = (id, kind, text, start, sectionId = "s1") => {
  const ws = text.split(" ").map((t, i) => ({ text: t, start: start + i * 0.3, end: start + i * 0.3 + 0.28 }));
  return { id, sectionId, kind, text, effect: "auto", words: ws, start, end: ws[ws.length - 1].end, confidence: 1, flag: null };
};
const mini = (lines, extra = {}) => ({
  title: "My Time No Late", look: { id: "studio-lagos-night", energy: "wild", seed: 1 },
  sections: [{ id: "s1", kind: "chorus", label: "CHORUS" }], song: { durationSec: 30 }, timing: { status: "done" }, lines, ...extra,
});
const dialogues = (ass) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
const toSec = (t) => { const [h, m, s] = t.split(":"); return +h * 3600 + +m * 60 + +s; };
const endOf = (d) => toSec(d.split(",")[2]);

test("a call holds on screen until the next lead line when an echo follows it", () => {
  const p = mini([timed("l1", "lead", "Who talk say", 10), timed("l2", "response", "(WHO TALK SAY?!)", 11.2), timed("l3", "lead", "My time no late", 14)]);
  const call = dialogues(buildLyricAss(p, { w: 720, h: 1280 })).filter((d) => /WHO/.test(d) && !/\(/.test(d));
  assert.ok(call.length);
  assert.ok(Math.abs(Math.max(...call.map(endOf)) - 13.95) < 0.02);
});

test("the last call and echo stop by the audible end", () => {
  const p = mini([timed("l1", "lead", "Who talk say", 20), timed("l2", "response", "(WHO TALK SAY?!)", 21.2)], { timing: { status: "done", audibleEnd: 22.5 } });
  for (const d of dialogues(buildLyricAss(p, { w: 720, h: 1280 }))) assert.ok(endOf(d) <= 22.5 + 0.01, d);
});

test("a soft line is drawn in Caveat", () => {
  const p = mini([{ ...timed("l1", "soft", "In the quiet of the night", 5), sectionId: "s1" }]);
  assert.match(buildLyricAss(p, { w: 720, h: 1280 }), /\\fnCaveat/);
});

test("resolvedEffects maps each placed line to the effect the render uses", () => {
  const p = mini([timed("l1", "lead", "Who talk say", 10), timed("l2", "response", "(WHO TALK SAY?!)", 11.2)]);
  const fx = resolvedEffects(p);
  assert.equal(fx.l2, "echo");
  assert.ok(typeof fx.l1 === "string");
});

test("the shuffle seed changes the captions; seed 1 matches the default", () => {
  const lines = [timed("l1", "lead", "Everywhere you go", 5, "s2"), timed("l2", "lead", "Everybody get pain", 7, "s2"), timed("l3", "lead", "Some dey work", 9, "s2")];
  const p = mini(lines, { sections: [{ id: "s2", kind: "verse", label: "VERSE" }] });
  const a = buildLyricAss(p, { w: 720, h: 1280 });
  const seeds = new Set([2, 3, 4, 5, 6].map((seed) => buildLyricAss({ ...p, look: { ...p.look, seed } }, { w: 720, h: 1280 })));
  assert.ok([...seeds].some((s) => s !== a));
});
```

Route test (follow the existing route test file's setup helpers for creating a project with timed lines and an authed request):

```js
test("GET /:id/effects returns each placed line's resolved effect", async () => {
  // create a project with a chorus lead + response, timed (use the file's existing timedProject/seed helper)
  // const res = await agent.get(`/api/lyric-video/${id}/effects`);
  // assert.equal(res.status, 200); assert.equal(res.body.effects[responseLineId], "echo");
});
```

Write that route test concretely with the file's own helpers. If no helper creates a timed project, write the project JSON through `writeProject` from `projectStore.js`, as other route tests in that file do.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test "src/lib/lyricVideo/lyricAss.test.js"`
Expected: FAIL (`resolvedEffects` is not exported, and no hold or soft yet).

- [ ] **Step 3: Implement** (`lyricAss.js`)

```js
const MAX_HOLD = 3;
const isResponse = (l) => l.kind === "response";

/** A call and its echoes share the screen until the next lead line (spec §6.2), never past the music's end. */
function holdsFor(placed, songEnd) {
  const until = new Array(placed.length).fill(undefined);
  for (let i = 0; i < placed.length; i++) {
    if (isResponse(placed[i]) || !isResponse(placed[i + 1] || {})) continue;
    let j = i + 1;
    while (j < placed.length && isResponse(placed[j])) j++;
    const lastEnd = placed[j - 1].end;
    const nextLead = j < placed.length ? placed[j].start - 0.05 : Infinity;
    const bound = Math.min(nextLead, lastEnd + MAX_HOLD, songEnd);
    for (let k = i; k < j; k++) until[k] = Math.min(Math.max(placed[k].end + 0.25, bound), songEnd);
  }
  return until;
}

function planInputs(project) {
  const placed = (project.lines || []).filter(isPlaced);
  const energy = resolveEnergy(project.look?.energy, "wild");
  const seed = Number(project.look?.seed) || 1;
  const effects = chooseEffects({ lines: placed, sections: project.sections || [], title: project.title || "", energy, seed });
  return { placed, energy, seed, effects };
}

export function resolvedEffects(project) {
  const { placed, effects } = planInputs(project);
  return Object.fromEntries(placed.map((l, i) => [l.id, effects[i]]));
}
```

In `buildLyricAss`, use `planInputs`. Set `songEnd = Number(project.timing?.audibleEnd) || Number(project.song?.durationSec) || Infinity`. Build phrases as `{ text, start, end, words, soft: l.kind === "soft", ...(holds[i] !== undefined && { holdUntil: holds[i] }) }`. Pass `seed` to `planPhrases` as today.

Check `holdEnd` in `common.js`: it honours a finite `holdUntil` as `max(holdUntil, start + 0.1)`. That is fine, because `holdUntil` ≥ `end + 0.25` > `start`.

Route, in `routes/lyricVideo.js` next to `GET /:id/captions.ass`:

```js
router.get("/:id/effects", route((req, res) => {
  const project = load(req);
  ok(res, { effects: resolvedEffects(project) });
}));
```

- [ ] **Step 4: Run the tests**

Run: `cd server && node --test "src/lib/lyricVideo/**/*.test.js" "src/routes/lyricVideo*.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/lyricVideo/lyricAss.js server/src/lib/lyricVideo/lyricAss.test.js server/src/routes
git commit -m "feat: calls hold with their echoes, soft lines and shuffle reach the captions"
```

---

### Task 5: Vocals from the laptop stems worker (protocol and capability handshake)

**Files:**
- Modify: `server/src/lib/stems/separator.js` (`buildSeparatorArgs`, `removeVocals`), `server/src/lib/stems/laptopQueue.js` (`stem` field, `sane`, `claimNext`, `laptopOnline`), `server/src/lib/stems/worker.js` (sends capabilities, passes `stem`), `server/src/routes/stemsWorker.js` (`/claim` caps and returns `stem`; `/result` skips the music-library save for vocals)
- Test: `server/src/lib/stems/separator.test.js`, `server/src/lib/stems/laptopQueue.test.js`, `server/src/routes/stemsWorker.test.js` (extend each existing file; create one only if it doesn't exist)

**Interfaces:**
- Produces:
  - `buildSeparatorArgs({ input, outDir, quality, modelDir, stem = "Instrumental" })` takes `stem` of `"Instrumental"` or `"Vocals"` and passes `--single_stem <stem>`.
  - `separateStem({ input, outPath, workDir, quality, stem = "Instrumental", onProgress, signal })`: the renamed `removeVocals`, which finds the output WAV by `new RegExp(stem, "i")`. `removeVocals` stays as an alias that calls `separateStem` with `stem: "Instrumental"`.
  - Laptop jobs carry `stem` (`"instrumental"` default, or `"vocals"`), and `stem` is persisted. `sane(row)` accepts `resultPath` basenames `instrumental-<id>.m4a` for instrumental and `lyric-vocals-<id>.m4a` for vocals.
  - `claimNext(now, { caps = [] } = {})`:
    - skips a `vocals` job unless `caps.includes("vocals")`
    - records `lastSeenVocals = now` when the caller has the vocals capability
  - `laptopOnline(now, { needs } = {})`: with `needs === "vocals"`, true only if a vocals-capable worker claimed within `ONLINE_MS`.
  - `POST /api/stems-worker/claim` reads the capability list from body `{ caps: ["vocals"] }` (an older worker sends no body, which means no caps). It returns `{ job: { jobId, quality, sourceName, stem } }`.
  - `POST /jobs/:jobId/result` for a `vocals` job writes the file, sets `status: "done"` and `resultFile: resultPath`. It does **not** call `saveInstrumental`.
  - `worker.js` `workOnce` sends `{ caps: ["vocals"] }` on claim, and calls `remove({ ..., stem: job.stem === "vocals" ? "Vocals" : "Instrumental", outPath: dir + (vocals ? "/vocals.m4a" : "/instrumental.m4a") })`. `stems-worker.mjs` passes `separateStem` as `remove`.

- [ ] **Step 1: Write the failing tests**

```js
// separator.test.js (append)
test("the separator can be asked for the vocals stem", () => {
  const args = buildSeparatorArgs({ input: "in.wav", outDir: "out", quality: "best", stem: "Vocals" });
  assert.equal(args[args.indexOf("--single_stem") + 1], "Vocals");
  assert.equal(buildSeparatorArgs({ input: "in.wav", outDir: "out", quality: "best" })[args.indexOf("--single_stem") + 1], "Instrumental");
});
```

```js
// laptopQueue.test.js (append; use the file's existing reset/enqueue helpers)
test("claimNext skips vocals jobs for workers without the vocals capability", () => {
  const job = enqueueLaptopJob({ ...baseFields("u1"), stem: "vocals", resultPath: path.join(outDir, "lyric-vocals-j1.m4a") });
  assert.equal(claimNext(Date.now()), null);                               // an old worker gets nothing
  assert.equal(claimNext(Date.now(), { caps: ["vocals"] })?.jobId, job.jobId);
});

test("laptopOnline can ask for a vocals-capable worker", () => {
  claimNext(1_000);                                 // an old worker polled
  assert.equal(laptopOnline(2_000), true);
  assert.equal(laptopOnline(2_000, { needs: "vocals" }), false);
  claimNext(3_000, { caps: ["vocals"] });
  assert.equal(laptopOnline(4_000, { needs: "vocals" }), true);
});

test("a persisted vocals job survives a reload", () => {
  // enqueue a vocals job, persistLaptopQueue(), reset, loadLaptopQueue() → the job is back with stem "vocals"
});
```

Write the reload test concretely with the file's existing persist/reload pattern. If `baseFields` doesn't exist, build the fields object inline: `{ jobId, userId, sourceRef: "lyric:lv_x", sourcePreview: null, resultPath, sourceLabel: "song", input, quality: "best", dataDir, outputDir }`.

```js
// stemsWorker.test.js (append; use its authed request helper)
test("a vocals result is stored but not added to the music library", async () => {
  // enqueue a vocals job, claim with { caps: ["vocals"] }, POST a tiny valid m4a to /jobs/:id/result
  // → job status "done", resultFile is the lyric-vocals path, and the music library has no new track
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test "src/lib/stems/**/*.test.js" "src/routes/stemsWorker*.test.js"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`separator.js`:

```js
const STEMS = new Set(["Instrumental", "Vocals"]);
export function buildSeparatorArgs({ input, outDir, quality, modelDir, stem = "Instrumental" }) {
  const q = quality === "fast" ? "fast" : "best";
  const s = STEMS.has(stem) ? stem : "Instrumental";
  const args = [input, "--model_filename", MODELS[q], "--output_dir", outDir, "--output_format", "WAV", "--single_stem", s, ...EXTRA_ARGS[q]];
  if (modelDir) args.push("--model_file_dir", modelDir);
  return args;
}
```

In `removeVocals`, rename it to `separateStem`, take `stem`, pass it to `buildSeparatorArgs`, and find the WAV with `new RegExp(stem, "i")`. Keep `export const removeVocals = (opts) => separateStem({ ...opts, stem: "Instrumental" });`.

`laptopQueue.js`:
- Add `stem` to `PERSISTED` and to the fields `enqueueLaptopJob` copies, defaulting to `"instrumental"`.
- `sane`: `const name = path.basename(row.resultPath); const ok = row.stem === "vocals" ? /^lyric-vocals-[\w-]+\.m4a$/.test(name) : /^instrumental-[\w-]+\.m4a$/.test(name);`.
- `let lastSeenVocals = 0;`
- In `claimNext(now = Date.now(), { caps = [] } = {})`: when `caps.includes("vocals")`, set `lastSeenVocals = now`; skip waiting jobs where `job.stem === "vocals" && !caps.includes("vocals")`.
- `laptopOnline(now = Date.now(), { needs } = {})`: `if (needs === "vocals") return lastSeenVocals > 0 && now - lastSeenVocals <= ONLINE_MS;`

`stemsWorker.js` `/claim`:
- `const caps = Array.isArray(req.body?.caps) ? req.body.caps.filter((c) => typeof c === "string").slice(0, 8) : [];`
- Pass `{ caps }` to `claimNext`.
- Add `stem: job.stem || "instrumental"` to the response.

`/result`: after the probe and rename, `if (job.stem === "vocals") { updateStemJob(job.jobId, { status: "done", resultFile: job.resultPath, percent: 100 }); return res.json({ ok: true }); }`, before the existing `saveInstrumental` path.

`worker.js`: `api.claim({ caps: ["vocals"] })`. Check how `makeWorkerApi` posts `/claim` and add the JSON body. Choose `stem` and `outPath` from `job.stem`. `server/scripts/stems-worker.mjs`: `remove: separateStem`.

- [ ] **Step 4: Run the tests**

Run: `cd server && node --test "src/lib/stems/**/*.test.js" "src/routes/stemsWorker*.test.js" "src/routes/music*.test.js"`
Expected: PASS. The instrumental flow (music routes) is unchanged.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/stems server/src/routes/stemsWorker.js server/src/routes/*stemsWorker*.test.js server/scripts/stems-worker.mjs
git commit -m "feat: the laptop worker can return a vocals stem to capable callers"
```

---

### Task 6: Timing listens to the vocals when a laptop can provide them

**Files:**
- Create: `server/src/lib/lyricVideo/vocalStem.js`
- Modify: `server/src/lib/lyricVideo/alignJob.js` (new `vocalStem` dep, `"vocals"` progress step, `usedVocalStem`), `server/src/routes/lyricVideo.js` (pass `userId` into `runAlignJob`), `client/src/lib/lyricVideoTypes.ts` (`TimingStep` adds `'vocals'`; `LyricTiming.usedVocalStem?: boolean`), `client/src/components/lyricVideo/TimingStep.tsx` (`PHASE_TEXT.vocals = "Separating the vocals on your laptop…"`)
- Test: `server/src/lib/lyricVideo/vocalStem.test.js`, `server/src/lib/lyricVideo/alignJob.test.js`, `client/src/components/lyricVideo/__tests__/TimingStep.test.tsx`

**Interfaces:**
- Consumes:
  - `laptopOnline(now, { needs: "vocals" })`, `laptopQueueEnabled()`, `queueRoomFor(userId)`, `enqueueLaptopJob(fields)` from Task 5
  - `getStemJob(jobId, userId)` and `cancelLaptopJob(jobId)` from `stems/`
- Produces:
  - `requestVocalStem({ userId, input, dataDir, outputDir, timeoutMs = 240_000, pollMs = 2000, signal, deps })` resolves to `string | null`: the vocals `.m4a` path, or `null` when no capable laptop is online, there's no queue room, the wait times out (the job is then cancelled), or the job fails. `deps` (a test seam) overrides `{ now, sleep, laptopOnline, enqueue, getJob, cancel, queueRoomFor, enabled }`.
  - `runAlignJob({ dataDir, workDir, projectId, userId, deps })`. Its default `deps.vocalStem(song)` calls `requestVocalStem({ userId, input: song, dataDir, outputDir: workDir })`.
  - In `timeLyrics`, the order is:
    1. `progress("vocals")` and `const vocals = await d.vocalStem(snapshot.song.file);`
    2. `const audio = await d.prepareAudio(vocals || snapshot.song.file);` (transcription input)
    3. `measureAudibleEnd` runs on `await d.prepareAudio(snapshot.song.file)` when `vocals` is set (the mix is what decides where the music ends), otherwise on `audio` as today
    4. `detectBeats(snapshot.song.file)` is unchanged
    5. The final timing has `usedVocalStem: Boolean(vocals)`
    6. The vocals file is deleted in the job's cleanup (it is feature-made)
  - The vocal-stem step **never** fails the job. Any error is logged once and treated as `null`.

- [ ] **Step 1: Write the failing tests**

```js
// server/src/lib/lyricVideo/vocalStem.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { requestVocalStem } from "./vocalStem.js";

const fakeClock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; } }; };
const base = (over = {}) => ({ userId: "u1", input: "/out/song.m4a", dataDir: "/d", outputDir: "/out", pollMs: 2000, timeoutMs: 240_000, ...over });

test("no capable laptop → null at once, nothing queued", async () => {
  let queued = 0;
  const out = await requestVocalStem(base({ deps: { ...fakeClock(), enabled: () => true, laptopOnline: () => false, enqueue: () => { queued++; } } }));
  assert.equal(out, null);
  assert.equal(queued, 0);
});

test("a finished vocals job → its file", async () => {
  const clock = fakeClock();
  let polls = 0;
  const out = await requestVocalStem(base({ deps: { ...clock, enabled: () => true, laptopOnline: () => true, queueRoomFor: () => true,
    enqueue: (f) => ({ jobId: "j1", resultPath: f.resultPath }),
    getJob: () => (++polls < 3 ? { status: "running" } : { status: "done", resultFile: "/out/lyric-vocals-j1.m4a" }) } }));
  assert.equal(out, "/out/lyric-vocals-j1.m4a");
});

test("not ready in 4 minutes → null and the job is cancelled", async () => {
  const clock = fakeClock();
  let cancelled = null;
  const out = await requestVocalStem(base({ deps: { ...clock, enabled: () => true, laptopOnline: () => true, queueRoomFor: () => true,
    enqueue: (f) => ({ jobId: "j2", resultPath: f.resultPath }), getJob: () => ({ status: "running" }), cancel: (id) => { cancelled = id; } } }));
  assert.equal(out, null);
  assert.equal(cancelled, "j2");
  assert.ok(clock.now() >= 240_000);
});

test("a failed job → null", async () => {
  const out = await requestVocalStem(base({ deps: { ...fakeClock(), enabled: () => true, laptopOnline: () => true, queueRoomFor: () => true,
    enqueue: (f) => ({ jobId: "j3", resultPath: f.resultPath }), getJob: () => ({ status: "error", error: "boom" }) } }));
  assert.equal(out, null);
});
```

In `alignJob.test.js` (use the file's existing fake-deps setup):

```js
test("timing listens to the vocals when the laptop returns them", async () => {
  // deps.vocalStem = async () => "<tmp>/lyric-vocals-x.m4a" (create the file); spy prepareAudio's argument
  // → the first prepareAudio call receives the vocals path; final timing.usedVocalStem === true; the vocals file is deleted after the job
});

test("no capable laptop → no wait, timing runs on the mix", async () => {
  // deps.vocalStem = async () => null → prepareAudio receives the song file; timing.usedVocalStem === false
});

test("a vocal-stem error never fails timing", async () => {
  // deps.vocalStem = async () => { throw new Error("laptop gone"); } → status "done", usedVocalStem false
});
```

Write these three concretely with the file's own helpers (it already fakes `prepareAudio`, `transcribe`, `cutAudio`, `detectBeats`, `measureAudibleEnd`).

In `TimingStep.test.tsx`: a project with `timing: { status: "running", progress: { step: "vocals" } }` shows "Separating the vocals on your laptop…".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test "src/lib/lyricVideo/vocalStem.test.js" "src/lib/lyricVideo/alignJob.test.js"` and `cd client && npx vitest run src/components/lyricVideo/__tests__/TimingStep.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
// server/src/lib/lyricVideo/vocalStem.js
// Ask the laptop worker for the song's vocals so timing listens to the voice alone (spec §5.2).
// Never blocks timing for long and never fails it: no capable laptop, no room, an error or 4 minutes → null.
import path from "node:path";
import { randomUUID } from "node:crypto";
import { enqueueLaptopJob, laptopOnline, laptopQueueEnabled, queueRoomFor, cancelLaptopJob } from "../stems/laptopQueue.js";
import { getStemJob } from "../stems/stemJobs.js";

const defaults = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  enabled: () => laptopQueueEnabled(),
  laptopOnline: () => laptopOnline(Date.now(), { needs: "vocals" }),
  queueRoomFor,
  enqueue: enqueueLaptopJob,
  getJob: (jobId, userId) => getStemJob(jobId, userId),
  cancel: cancelLaptopJob,
};

export async function requestVocalStem({ userId, input, dataDir, outputDir, timeoutMs = 240_000, pollMs = 2000, signal, deps = {} }) {
  const d = { ...defaults, ...deps };
  if (!d.enabled() || !d.laptopOnline() || !d.queueRoomFor(userId)) return null;
  const jobId = randomUUID();
  const resultPath = path.resolve(outputDir, `lyric-vocals-${jobId}.m4a`);
  const job = d.enqueue({ jobId, userId, sourceRef: "lyric-video", sourcePreview: null, resultPath, sourceLabel: path.basename(input),
    input, quality: "best", dataDir, outputDir, stem: "vocals" });
  const deadline = d.now() + timeoutMs;
  while (d.now() < deadline) {
    if (signal?.aborted) break;
    const view = d.getJob(job.jobId, userId);
    if (view?.status === "done") return view.resultFile || resultPath;
    if (!view || view.status === "error" || view.status === "cancelled") return null;
    await d.sleep(pollMs);
  }
  d.cancel(job.jobId);
  return null;
}
```

Check `createStemJob`'s required fields and `cancelLaptopJob`'s signature in `server/src/lib/stems/` before relying on them. Pass exactly what they need. If `enqueueLaptopJob` generates its own `jobId`, use the returned `job.jobId` and `job.resultPath` (as written above).

In `alignJob.js`:
- `defaultDeps(workDir, projectId, { userId, dataDir })` adds `vocalStem: (song) => (userId ? requestVocalStem({ userId, input: song, dataDir, outputDir: workDir }) : Promise.resolve(null))`.
- `runAlignJob` takes `userId` and threads it through.
- In `timeLyrics`, before preparing audio:

```js
progress("vocals");
let vocals = null;
try { vocals = await d.vocalStem(snapshot.song.file); } catch (err) { log(`[lyric] vocals skipped: ${err.message}`); }
const audio = await d.prepareAudio(vocals || snapshot.song.file);
const endSource = vocals ? await d.prepareAudio(snapshot.song.file) : audio;
// …measureAudibleEnd(endSource, durationSec)… (existing call, new argument)
```

- Add `usedVocalStem: Boolean(vocals)` to the final `timing` write. Delete `vocals` and the extra prepared file in the job's existing cleanup path (use `d.discard`/`d.cleanup`, whichever the file already uses for cut files).
- In `routes/lyricVideo.js` (~L447), pass `userId: req.ctx.userId` to `runAlignJob`.
- Client: add `'vocals'` to `TimingStep` and to `PHASE_TEXT`, and add `usedVocalStem?: boolean` to `LyricTiming`.

- [ ] **Step 4: Run the tests**

Run: `cd server && node --test "src/lib/lyricVideo/**/*.test.js" "src/routes/lyricVideo*.test.js"` and `cd client && npx vitest run src/components/lyricVideo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/lyricVideo server/src/routes/lyricVideo.js client/src/lib/lyricVideoTypes.ts client/src/components/lyricVideo
git commit -m "feat: timing listens to the vocals when the laptop can separate them"
```

---

### Task 7: Look step: per-line effect menu and Shuffle

**Files:**
- Create: `client/src/components/lyricVideo/LineEffects.tsx`, `client/src/components/lyricVideo/ShuffleButton.tsx`
- Modify: `client/src/components/lyricVideo/LookStep.tsx`, `client/src/lib/lyricVideoApi.ts` (`effects(id)`), `client/src/lib/lyricVideoTypes.ts` (`LyricEffect` adds `'echo'`)
- Test: `client/src/components/lyricVideo/__tests__/LineEffects.test.tsx`, `client/src/components/lyricVideo/__tests__/LookStep.test.tsx` (extend or create)

**Interfaces:**
- Consumes: `lyricVideoApi.patchLine(id, lineId, { effect })`, `lyricVideoApi.setLook(id, { seed })`, the new `GET /:id/effects`.
- Produces:
  - `lyricVideoApi.effects(id): Promise<Record<string, LyricEffect>>`
  - `<LineEffects project onChange onPreviewChange />`: a list of placed lines, each with a labelled `<select>`. The first option is "Auto · <resolved effect>", then Pop, Stack, Slam, Quote, Curve, Frame, Echo. Changing a line calls `patchLine` then `onChange(project)`, refetches the resolved effects, and calls `onPreviewChange()`, which bumps the preview's `assVersion`.
  - `<ShuffleButton project onChange onPreviewChange />`: "Shuffle effects" sets a new seed via `setLook({ seed: nextSeed })`. While saving it shows "Shuffling…"; after saving it shows "✓ Shuffled" for 1.2 s, and the preview redraws right away. The button carries a hint: "Changes the effects on lines set to Auto. Your own choices stay."
  - `nextSeed(seed)` returns an integer ≥ 2 that differs from `seed`: `((seed * 7919 + 13) % 100_000) + 2`, kept deterministic for tests.

Labels (plain English, sentence case):

| Value | Label |
|---|---|
| `auto` | `Auto · Slam` (resolved effect, capitalised) |
| `pop` | Pop |
| `stack` | Stack |
| `slam` | Slam |
| `quote` | Quote |
| `curve` | Curve |
| `frame` | Frame |
| `echo` | Echo (crowd reply) |

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/components/lyricVideo/__tests__/LineEffects.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../../lib/lyricVideoApi', () => ({ lyricVideoApi: { patchLine: vi.fn(), effects: vi.fn(), setLook: vi.fn() } }));
import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { LineEffects } from '../LineEffects';
import { ShuffleButton, nextSeed } from '../ShuffleButton';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const line = (id: string, text: string, kind = 'lead', effect = 'auto') => ({ id, sectionId: 's1', kind, text, effect,
  words: [{ text, start: 1, end: 2 }], start: 1, end: 2, confidence: 1, flag: null });
const project = { projectId: 'lv_1', look: { id: 'studio-lagos-night', energy: 'wild', seed: 1 },
  lines: [line('l1', 'Who talk say'), line('l2', '(WHO TALK SAY?!)', 'response'), { id: 'l3', sectionId: 's1', kind: 'lead', text: 'Not timed', effect: 'auto' }] } as unknown as LyricProject;

beforeEach(() => { vi.mocked(lyricVideoApi.effects).mockResolvedValue({ l1: 'slam', l2: 'echo' }); });

describe('LineEffects', () => {
  it('lists timed lines with Auto showing the effect the video will use', async () => {
    render(<LineEffects project={project} onChange={vi.fn()} onPreviewChange={vi.fn()} />);
    expect(await screen.findByRole('option', { name: 'Auto · Slam' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Auto · Echo' })).toBeTruthy();
    expect(screen.queryByText('Not timed')).toBeNull();
  });
  it('choosing an effect saves it and redraws the preview', async () => {
    const changed = { ...project };
    vi.mocked(lyricVideoApi.patchLine).mockResolvedValue(changed);
    const onChange = vi.fn(); const onPreviewChange = vi.fn();
    render(<LineEffects project={project} onChange={onChange} onPreviewChange={onPreviewChange} />);
    fireEvent.change(await screen.findByLabelText('Effect for “Who talk say”'), { target: { value: 'curve' } });
    await waitFor(() => expect(lyricVideoApi.patchLine).toHaveBeenCalledWith('lv_1', 'l1', { effect: 'curve' }));
    expect(onChange).toHaveBeenCalledWith(changed);
    expect(onPreviewChange).toHaveBeenCalled();
  });
});

describe('ShuffleButton', () => {
  it('saves a new mix and confirms it', async () => {
    const shuffled = { ...project, look: { ...project.look, seed: nextSeed(1) } } as LyricProject;
    vi.mocked(lyricVideoApi.setLook).mockResolvedValue(shuffled);
    const onChange = vi.fn(); const onPreviewChange = vi.fn();
    render(<ShuffleButton project={project} onChange={onChange} onPreviewChange={onPreviewChange} />);
    fireEvent.click(screen.getByRole('button', { name: /shuffle effects/i }));
    await waitFor(() => expect(lyricVideoApi.setLook).toHaveBeenCalledWith('lv_1', { seed: nextSeed(1) }));
    expect(await screen.findByText('✓ Shuffled')).toBeTruthy();
    expect(onPreviewChange).toHaveBeenCalled();
  });
  it('nextSeed never repeats and never returns 1', () => {
    for (const s of [1, 2, 50, 99_999]) { expect(nextSeed(s)).not.toBe(s); expect(nextSeed(s)).toBeGreaterThanOrEqual(2); }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run src/components/lyricVideo/__tests__/LineEffects.test.tsx`
Expected: FAIL (the modules don't exist).

- [ ] **Step 3: Implement**

`lyricVideoTypes.ts`: `LyricEffect` adds `'echo'`. `lyricVideoApi.ts`:

```ts
effects: async (id: string): Promise<Record<string, LyricEffect>> =>
  unwrap(await api.get<{ effects: Record<string, LyricEffect> }>(`${BASE}/${id}/effects`)).effects,
```

```tsx
// client/src/components/lyricVideo/LineEffects.tsx
import { useEffect, useState } from 'react';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import type { LyricEffect, LyricProject } from '../../lib/lyricVideoTypes';
import { isPlacedLine } from '../../lib/lyricTiming';
import { fieldLabelCls, inputCls } from '../story/formStyles';
import { messageOf } from './messageOf';

const CHOICES: { value: Exclude<LyricEffect, 'auto' | 'title'>; label: string }[] = [
  { value: 'pop', label: 'Pop' }, { value: 'stack', label: 'Stack' }, { value: 'slam', label: 'Slam' },
  { value: 'quote', label: 'Quote' }, { value: 'curve', label: 'Curve' }, { value: 'frame', label: 'Frame' },
  { value: 'echo', label: 'Echo (crowd reply)' },
];
const NAMES: Record<string, string> = { title: 'Title', ...Object.fromEntries(CHOICES.map((c) => [c.value, c.label.split(' ')[0]])) };

interface Props { project: LyricProject; onChange: (p: LyricProject) => void; onPreviewChange: () => void }

export function LineEffects({ project, onChange, onPreviewChange }: Props) {
  const [resolved, setResolved] = useState<Record<string, LyricEffect>>({});
  const [error, setError] = useState('');
  const lines = project.lines.filter(isPlacedLine);
  const key = `${project.look.seed}|${project.look.energy}|${lines.map((l) => `${l.id}:${l.effect}`).join(',')}`;
  useEffect(() => {
    let live = true;
    lyricVideoApi.effects(project.projectId).then((fx) => { if (live) setResolved(fx); }).catch(() => undefined);
    return () => { live = false; };
  }, [project.projectId, key]);
  const choose = async (lineId: string, effect: LyricEffect) => {
    setError('');
    try { onChange(await lyricVideoApi.patchLine(project.projectId, lineId, { effect })); onPreviewChange(); }
    catch (err) { setError(messageOf(err)); }
  };
  if (!lines.length) return null;
  return (
    <section aria-labelledby="line-effects-heading" className="space-y-2">
      <h3 id="line-effects-heading" className={fieldLabelCls}>Effect for each line</h3>
      {error && <p role="alert" className="text-sm text-status-error">{error}</p>}
      <ul className="space-y-2">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm">{l.text}</span>
            <select aria-label={`Effect for “${l.text}”`} className={`${inputCls} w-44`} value={l.effect}
              onChange={(e) => void choose(l.id, e.target.value as LyricEffect)}>
              <option value="auto">{`Auto · ${NAMES[resolved[l.id] ?? ''] ?? '…'}`}</option>
              {CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Before using them, check that `messageOf` (or the error helper the other steps use) and `text-status-error` (or the error token other steps use) exist. Use the repo's actual helper and token names. Never add new colour classes.

```tsx
// client/src/components/lyricVideo/ShuffleButton.tsx
import { useEffect, useRef, useState } from 'react';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import type { LyricProject } from '../../lib/lyricVideoTypes';
import { secondaryBtnCls } from '../story/formStyles';

export const nextSeed = (seed: number) => ((Math.abs(Math.trunc(seed)) * 7919 + 13) % 100_000) + 2;
const TICK_MS = 1200;

interface Props { project: LyricProject; onChange: (p: LyricProject) => void; onPreviewChange: () => void }

export function ShuffleButton({ project, onChange, onPreviewChange }: Props) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const shuffle = async () => {
    setState('busy');
    try {
      onChange(await lyricVideoApi.setLook(project.projectId, { seed: nextSeed(project.look.seed || 1) }));
      onPreviewChange();
      setState('done');
      timer.current = setTimeout(() => setState('idle'), TICK_MS);
    } catch { setState('idle'); }
  };
  return (
    <div className="space-y-1">
      <button type="button" className={secondaryBtnCls} onClick={() => void shuffle()} disabled={state === 'busy'}>
        {state === 'busy' ? 'Shuffling…' : state === 'done' ? '✓ Shuffled' : 'Shuffle effects'}
      </button>
      <p className="text-xs text-content-secondary">Changes the effects on lines set to Auto. Your own choices stay.</p>
    </div>
  );
}
```

The accessible name for the busy and done states must still match `/shuffle/i` or the confirmation text. Keep `aria-live="polite"` on a status element if the repo pattern uses one; the `StudioEffects.tsx` Shuffle uses `role="status"`.

In `LookStep.tsx`: under the energy select, render `<ShuffleButton … onPreviewChange={bump} />`. Below the background controls, render `<LineEffects … onPreviewChange={bump} />`, where `bump` is the existing `assVersion` increment the step already uses for look changes.

- [ ] **Step 4: Run the tests**

Run: `cd client && npx vitest run src/components/lyricVideo` then `cd client && npm run build`
Expected: PASS, and the build is clean. Discard `server/public` afterwards: `git checkout -- server/public && git clean -fdq server/public`.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/lyricVideo client/src/lib/lyricVideoApi.ts client/src/lib/lyricVideoTypes.ts
git commit -m "feat: choose each line's effect and shuffle the Auto ones on the Look step"
```

---

### Task 8: Real-song check, laptop vocals check, bundle

**Files:**
- Modify: `server/scripts/lyric-video-smoke.mjs` (print each line's effect; optional `--vocals <file>` to time from a given vocals file), `server/public/**` (rebuilt bundle)

- [ ] **Step 1: The smoke script shows effects**

After timing, print `resolvedEffects(readProject(dir, p.projectId))[line.id]` beside each line. Add `--vocals <path>`: when given, pass `deps: { vocalStem: async () => path.resolve(vocalsArg) }` to `runAlignJob`. This proves the vocals path on a real file without the laptop.

- [ ] **Step 2: Run on both reference songs** (small paid speech-service calls; once each)

Run (from `server/`):

```bash
node --env-file="C:/Users/segun/source/repos/biblefuel-studio/server/.env" scripts/lyric-video-smoke.mjs "<scratchpad>/lyric/song.m4a" src/lib/lyricVideo/__fixtures__/my-time-no-late/sheet.txt
```

Then the same for "I Know the Driver" (`<uploads>/c41b57de-gemini_generated_video_508F578B.mp4` with `<scratchpad>/driver/sheet.txt`).

Expected:
- every response is `echo`
- chorus title lines `frame`, short chorus lines `slam`
- flag counts no worse than Phase 1: 10/72 and 33/113

Then the vocals path, using the Phase 1 stems already on disk: `<scratchpad>/lyric/vocals.m4a`, passed as `--vocals`. Record the flag count against the mix.

- [ ] **Step 3: Laptop worker check** (operator)

The laptop worker must run the new code to offer vocals. Old workers simply aren't handed vocals jobs. Hand over to the operator with these steps:
1. Restart the stems worker on the laptop from an updated checkout.
2. Time a song on the test copy.
3. Confirm the Timing step shows "Separating the vocals on your laptop…" and the project's `timing.usedVocalStem` is `true`.

- [ ] **Step 4: Render one portrait video with echo** (on the local stack or the test copy) and check frames: the call and its echo are on screen together, neither overlaps, and both are inside the Shorts band.

- [ ] **Step 5: Full suites, bundle, commit**

Run: `cd client && npm test && npm run build && cd ../server && npm test` (with `client/.env.local` absent).
Expected: all green, and no `AIza` in `server/public/assets/*.js`.

```bash
git add server/scripts/lyric-video-smoke.mjs && git commit -m "test: smoke script shows each line's effect and can time from a vocals file"
git add server/public && git commit -m "chore: rebuild client bundle"
```

- [ ] **Step 6: Hand over.** Report:
  - per-task test counts
  - the smoke results with effects and flags, for the mix and the vocals
  - the laptop check

Do not push. The operator decides when to open the PR. It uses `Refs #51`; Codex review is mandatory before merge.
