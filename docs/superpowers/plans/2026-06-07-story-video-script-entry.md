# Story Video Script / Template Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users start a Story Video from a typed idea + template: refine it into a narration, synthesize a free Edge-TTS voiceover, and feed that audio into the existing trim→transcribe→segment→images→render pipeline.

**Architecture:** New backend modules `scriptTemplates.js` (pure) + `scriptRefine.js` (LLM, injected) and a `POST /api/story/script-to-audio` route (refine → Edge TTS → move file into the user's output dir). New frontend: a Step-1 entry-mode toggle (Upload / Write a script) + a `ScriptForm`; on "Generate voiceover" it sets `pendingAudio` and reuses the existing ready-panel/trim/`startPipeline` flow.

**Tech Stack:** Node/Express + `node:test` (server); React 19 + TanStack Query + Vitest/testing-library (client). Reuses `lib/edgeTts.js`, the gpt-4o-mini→gemini LLM pattern, and the trim sub-project's `pendingAudio`/`startPipeline`.

**Spec:** `docs/superpowers/specs/2026-06-07-story-video-script-entry-design.md`

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `server/src/lib/story/scriptTemplates.js` | 5 templates + `templateById` | Create |
| `server/src/lib/story/scriptTemplates.test.js` | template tests | Create |
| `server/src/lib/story/scriptRefine.js` | `refineScript` (LLM injected + fallback) | Create |
| `server/src/lib/story/scriptRefine.test.js` | refine tests | Create |
| `server/src/routes/story.js` | `POST /script-to-audio` (+ `_setTtsImpl` seam) | Modify |
| `server/src/routes/story.test.js` | route test | Modify |
| `client/src/lib/storyScript.ts` | `STORY_SCRIPT_TEMPLATES`, `STORY_VOICES` mirrors | Create |
| `client/src/lib/storyApi.ts` | `scriptToAudio(idea, templateId, voiceId)` | Modify |
| `client/src/lib/__tests__/storyApi.test.ts` | scriptToAudio test | Modify |
| `client/src/components/story/ScriptForm.tsx` | the script form | Create |
| `client/src/components/story/__tests__/ScriptForm.test.tsx` | form test | Create |
| `client/src/pages/StoryVideoPage.tsx` | entry-mode toggle + script mode | Modify |
| `client/src/pages/__tests__/StoryVideoPage.test.tsx` | script-entry tests | Modify |
| `server/public/**` | rebuilt bundle | Modify |

---

## Task 1: Backend — script templates

**Files:**
- Create: `server/src/lib/story/scriptTemplates.js`
- Test: `server/src/lib/story/scriptTemplates.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/lib/story/scriptTemplates.test.js
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
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `node --test server/src/lib/story/scriptTemplates.test.js`
Expected: module not found.

- [ ] **Step 3: Implement**

```javascript
// server/src/lib/story/scriptTemplates.js
/**
 * Story Video script templates. `prompt` is the tone/structure guidance fed to
 * the refiner; `targetSeconds` sets the narration length. `custom` adds no tone.
 */
export const SCRIPT_TEMPLATES = [
  {
    id: "devotional-30",
    label: "30s Devotional",
    targetSeconds: 30,
    prompt: "Write a warm, encouraging devotional. Open with a relatable feeling, turn to a hopeful biblical truth, and close with a short call to trust God.",
  },
  {
    id: "teaching-60",
    label: "60s Teaching",
    targetSeconds: 60,
    prompt: "Write a clear, simple Bible teaching on the idea. State one main point, support it with a scriptural thought, and end with a practical takeaway.",
  },
  {
    id: "meditation",
    label: "Scripture Meditation",
    targetSeconds: 45,
    prompt: "Write a calm, slow, reflective scripture meditation. Use gentle, unhurried sentences and invite the listener to dwell on the truth.",
  },
  {
    id: "testimony",
    label: "Testimony / Encouragement",
    targetSeconds: 45,
    prompt: "Write an uplifting, first-person encouragement in a testimony tone. Be hopeful and personal, ending with assurance.",
  },
  {
    id: "custom",
    label: "Custom",
    targetSeconds: 40,
    prompt: "",
  },
];

/** Look up a template by id; falls back to the custom template. */
export function templateById(id) {
  return SCRIPT_TEMPLATES.find((t) => t.id === id) || SCRIPT_TEMPLATES.find((t) => t.id === "custom");
}
```

- [ ] **Step 4: Run, confirm PASS**

Run: `node --test server/src/lib/story/scriptTemplates.test.js`

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/src/lib/story/scriptTemplates.js server/src/lib/story/scriptTemplates.test.js
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story): script templates"
```

---

## Task 2: Backend — `refineScript`

**Files:**
- Create: `server/src/lib/story/scriptRefine.js`
- Test: `server/src/lib/story/scriptRefine.test.js`

Pure transform with an injected LLM (mirrors `sceneSegmenter.js`'s `_setLlmImpl` seam). Idea + template → narration text. On LLM failure → return the raw idea (never dead-ends).

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/lib/story/scriptRefine.test.js
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { refineScript, _setLlmImpl, _resetLlmImpl } from "./scriptRefine.js";
import { templateById } from "./scriptTemplates.js";

afterEach(() => _resetLlmImpl());

describe("refineScript", () => {
  test("returns the LLM's narration, trimmed of quotes/markdown", async () => {
    _setLlmImpl(async () => '"When life feels heavy, God is near."');
    const out = await refineScript({ idea: "god is near in hard times", template: templateById("devotional-30") });
    assert.equal(out, "When life feels heavy, God is near.");
  });

  test("includes the template prompt and a word target in the LLM prompt", async () => {
    let seen = "";
    _setLlmImpl(async (p) => { seen = p; return "ok"; });
    await refineScript({ idea: "trust", template: templateById("teaching-60") });
    assert.match(seen, /clear, simple Bible teaching/i); // from teaching-60 prompt
    assert.match(seen, /\b\d{2,3}\b/); // a word-count target appears
    assert.match(seen, /trust/);       // the idea is included
  });

  test("falls back to the raw idea when the LLM throws", async () => {
    _setLlmImpl(async () => { throw new Error("down"); });
    const out = await refineScript({ idea: "  keep going  ", template: templateById("custom") });
    assert.equal(out, "keep going");
  });

  test("falls back to the raw idea when the LLM returns empty", async () => {
    _setLlmImpl(async () => "   ");
    const out = await refineScript({ idea: "hold on", template: templateById("custom") });
    assert.equal(out, "hold on");
  });
});
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `node --test server/src/lib/story/scriptRefine.test.js`
Expected: module not found.

- [ ] **Step 3: Implement**

```javascript
// server/src/lib/story/scriptRefine.js

// Injected LLM completion (prompt:string)=>Promise<string>. Default does the
// gpt-4o-mini -> gemini-2.0-flash fallback, same shape as sceneSegmenter.js.
let _llm = defaultLlmComplete;
export function _setLlmImpl(impl) { _llm = impl; }
export function _resetLlmImpl() { _llm = defaultLlmComplete; }

const WORDS_PER_SEC = 2.5;

/**
 * Refine a rough idea into a clean narration script (~template.targetSeconds).
 * @param {{ idea:string, template:{prompt:string,targetSeconds:number} }} args
 * @returns {Promise<string>} narration text (falls back to the idea on failure)
 */
export async function refineScript({ idea, template }) {
  const raw = String(idea || "").trim();
  if (!raw) return "";
  const targetWords = Math.max(20, Math.round((template?.targetSeconds || 40) * WORDS_PER_SEC));
  const prompt = [
    "You are scripting a short spoken voiceover for a Christian social video.",
    template?.prompt ? template.prompt : "Clean up the idea into a clear, natural spoken narration.",
    `Aim for about ${targetWords} words (roughly ${template?.targetSeconds || 40} seconds of speech).`,
    "Return ONLY the narration text to be spoken — no markdown, no quotes, no headings, no stage directions.",
    "",
    "Idea:",
    raw,
  ].join("\n");

  let text = "";
  try {
    text = clean(await _llm(prompt));
  } catch {
    text = "";
  }
  return text || raw;
}

function clean(s) {
  let t = String(s || "").trim();
  // strip a single wrapping pair of quotes and any ```fences```
  t = t.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

// Default dual-provider completion. Mirrors sceneSegmenter.js / generateScripts.js.
async function defaultLlmComplete(prompt) {
  return (await openaiComplete(prompt)) ?? (await geminiComplete(prompt)) ?? "";
}
async function openaiComplete(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.startsWith("your-")) return null;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.7 }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch { return null; }
}
async function geminiComplete(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.startsWith("your-")) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7 } }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? null;
  } catch { return null; }
}
```

- [ ] **Step 4: Run, confirm PASS**

Run: `node --test server/src/lib/story/scriptRefine.test.js`

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/src/lib/story/scriptRefine.js server/src/lib/story/scriptRefine.test.js
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story): refineScript (idea -> narration, LLM + fallback)"
```

---

## Task 3: Backend — `POST /api/story/script-to-audio`

**Files:**
- Modify: `server/src/routes/story.js`
- Test: `server/src/routes/story.test.js`

Refine → Edge TTS → move the mp3 into `req.ctx.outputDir` (transcribe-guard-safe) → `{ ok, file, script }`. TTS is behind a mockable seam.

- [ ] **Step 1: Add the failing test** (inside the existing `describe("story routes", ...)`)

```javascript
  test("POST /script-to-audio refines + synthesizes + returns an in-scope audio path", async () => {
    const { _setLlmImpl, _resetLlmImpl } = await import("../lib/story/scriptRefine.js");
    const { _setTtsImpl, _resetTtsImpl } = await import("./story.js");
    _setLlmImpl(async () => "Refined narration.");
    // Fake TTS: write a temp mp3 outside outputDir and return its path.
    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");
    const fakeSrc = path.join(os.tmpdir(), `fake-tts-${Date.now()}.mp3`);
    fs.writeFileSync(fakeSrc, "ID3fake");
    _setTtsImpl(async () => ({ ok: true, file: fakeSrc, provider: "edge", voice: "x" }));

    try {
      const { req, res } = mockReqRes({ body: { idea: "trust God", templateId: "devotional-30" }, dataDir, outputDir });
      await handlerFor("post", "/script-to-audio")(req, res);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.script, "Refined narration.");
      // returned file is inside outputDir and exists
      assert.ok(res.payload.file.startsWith(outputDir.replace(/\\/g, "/")) || res.payload.file.startsWith(outputDir));
      assert.ok(fs.existsSync(res.payload.file));
    } finally {
      _resetLlmImpl(); _resetTtsImpl();
    }
  });

  test("POST /script-to-audio 400s on empty idea", async () => {
    const { req, res } = mockReqRes({ body: { idea: "  ", templateId: "custom" }, dataDir, outputDir });
    await handlerFor("post", "/script-to-audio")(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.ok, false);
  });
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `node --test server/src/routes/story.test.js`
Expected: FAIL — no `/script-to-audio` handler and `_setTtsImpl` not exported.

- [ ] **Step 3: Implement** in `server/src/routes/story.js`

(a) Add imports near the top (with the other lib imports):
```javascript
import { refineScript } from "../lib/story/scriptRefine.js";
import { templateById } from "../lib/story/scriptTemplates.js";
import { synthesizeEdgeTts } from "../lib/edgeTts.js";
import { v4 as uuid } from "uuid";
```
(If `uuid` is already imported in story.js, don't duplicate.)

(b) Add the mockable TTS seam near the other seams (`_setTranscribeImpl` etc.):
```javascript
let _ttsFn = synthesizeEdgeTts;
export function _setTtsImpl(impl) { _ttsFn = impl; }
export function _resetTtsImpl() { _ttsFn = synthesizeEdgeTts; }
```

(c) Add the route after `POST /:id/transcribe` (so it sits with the creation-flow routes), BEFORE the `/:id/...` parameterised routes is not required — Express matches exact `/script-to-audio` regardless, but place it BEFORE `router.get("/:id", ...)` to avoid any `:id` shadowing of GET; for POST there is no conflict. Add:
```javascript
// POST /script-to-audio — idea + template -> refined narration -> Edge TTS mp3,
// moved into the caller's output dir so it passes the /transcribe guard.
router.post("/script-to-audio", async (req, res) => {
  try {
    const idea = String(req.body?.idea || "").trim();
    if (idea.length < 3) return res.status(400).json({ ok: false, error: "idea is required" });
    const template = templateById(req.body?.templateId);
    const voiceId = req.body?.voiceId ? String(req.body.voiceId) : undefined;

    const script = await refineScript({ idea, template });
    const tts = await _ttsFn({ text: script, voiceId });
    if (!tts?.ok || !tts.file) {
      return res.status(502).json({ ok: false, error: tts?.error || "voice synthesis failed" });
    }

    // Move the TTS mp3 into the caller's output dir (edgeTts writes to global OUTPUT_DIR).
    if (!fs.existsSync(req.ctx.outputDir)) fs.mkdirSync(req.ctx.outputDir, { recursive: true });
    const dest = path.join(req.ctx.outputDir, `story-tts-${uuid()}.mp3`);
    try {
      fs.renameSync(tts.file, dest);
    } catch {
      fs.copyFileSync(tts.file, dest);
      try { fs.unlinkSync(tts.file); } catch {}
    }
    return res.json({ ok: true, file: dest.replace(/\\/g, "/"), script });
  } catch (e) {
    const msg = String(e?.message || e);
    const status = /disabled|required/i.test(msg) ? 400 : 500;
    return res.status(status).json({ ok: false, error: msg });
  }
});
```

- [ ] **Step 4: Run, confirm PASS**

Run: `node --test server/src/routes/story.test.js` → all pass. Then `cd server && npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/src/routes/story.js server/src/routes/story.test.js
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story): POST /script-to-audio (refine + Edge TTS -> in-scope mp3)"
```

---

## Task 4: Client — template/voice mirrors + `storyApi.scriptToAudio`

**Files:**
- Create: `client/src/lib/storyScript.ts`
- Modify: `client/src/lib/storyApi.ts`
- Test: `client/src/lib/__tests__/storyApi.test.ts`

- [ ] **Step 1: Write the failing test** (add to `client/src/lib/__tests__/storyApi.test.ts`, inside the existing `describe('storyApi', ...)`)

```typescript
  it('scriptToAudio posts idea/template/voice and returns the audio file path', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, file: '/out/story-tts-1.mp3', script: 'hi' } });
    const file = await storyApi.scriptToAudio('an idea', 'devotional-30', 'en-US-GuyNeural');
    expect(spy).toHaveBeenCalledWith('/api/story/script-to-audio', { idea: 'an idea', templateId: 'devotional-30', voiceId: 'en-US-GuyNeural' }, undefined, expect.objectContaining({ timeout: expect.any(Number) }));
    expect(file).toBe('/out/story-tts-1.mp3');
  });

  it('scriptToAudio throws the server error on failure', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 502, error: 'voice synthesis failed' });
    await expect(storyApi.scriptToAudio('x', 'custom', 'v')).rejects.toThrow('voice synthesis failed');
  });
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `cd client && npx vitest run src/lib/__tests__/storyApi.test.ts`

- [ ] **Step 3: Implement**

`client/src/lib/storyScript.ts`:
```typescript
export interface ScriptTemplateOption { id: string; label: string }
export interface VoiceOption { id: string; label: string }

// Mirror of the backend template ids (labels only; backend owns the prompts).
export const STORY_SCRIPT_TEMPLATES: ScriptTemplateOption[] = [
  { id: 'devotional-30', label: '30s Devotional' },
  { id: 'teaching-60', label: '60s Teaching' },
  { id: 'meditation', label: 'Scripture Meditation' },
  { id: 'testimony', label: 'Testimony / Encouragement' },
  { id: 'custom', label: 'Custom' },
];

// Curated free Microsoft Edge neural voices.
export const STORY_VOICES: VoiceOption[] = [
  { id: 'en-US-GuyNeural', label: 'Guy — US, male' },
  { id: 'en-US-AriaNeural', label: 'Aria — US, female' },
  { id: 'en-GB-RyanNeural', label: 'Ryan — UK, male' },
  { id: 'en-NG-AbeoNeural', label: 'Abeo — Nigeria, male' },
  { id: 'en-NG-EzinneNeural', label: 'Ezinne — Nigeria, female' },
];
```

Add to the `storyApi` object in `client/src/lib/storyApi.ts` (after `uploadAudio`). Add a timeout constant near the existing `GENERATE_IMAGES_TIMEOUT_MS`:
```typescript
const SCRIPT_TO_AUDIO_TIMEOUT_MS = 2 * 60_000;
```
```typescript
  async scriptToAudio(idea: string, templateId: string, voiceId?: string): Promise<string> {
    const res = await api.post('/api/story/script-to-audio', { idea, templateId, voiceId }, undefined, { timeout: SCRIPT_TO_AUDIO_TIMEOUT_MS });
    if (!res.ok || !res.data?.file) throw new Error(res.error || 'Voice generation failed');
    return res.data.file as string;
  },
```

- [ ] **Step 4: Run, confirm PASS**

Run: `cd client && npx vitest run src/lib/__tests__/storyApi.test.ts`

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/lib/storyScript.ts client/src/lib/storyApi.ts client/src/lib/__tests__/storyApi.test.ts
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): script template/voice mirrors + storyApi.scriptToAudio"
```

---

## Task 5: Client — `ScriptForm` component

**Files:**
- Create: `client/src/components/story/ScriptForm.tsx`
- Test: `client/src/components/story/__tests__/ScriptForm.test.tsx`

Self-contained form: template `<select>`, idea `<textarea>`, voice `<select>`, "Generate voiceover" button (disabled while idea is blank or `busy`). On submit calls `onGenerate(idea, templateId, voiceId)`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/story/__tests__/ScriptForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScriptForm } from '../ScriptForm';

describe('ScriptForm', () => {
  it('disables Generate until the idea has text', async () => {
    render(<ScriptForm onGenerate={vi.fn()} busy={false} />);
    const btn = screen.getByRole('button', { name: /generate voiceover/i });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/your idea/i), 'trust God in hard times');
    expect(btn).toBeEnabled();
  });

  it('calls onGenerate with idea, default template, and default voice', async () => {
    const onGenerate = vi.fn();
    render(<ScriptForm onGenerate={onGenerate} busy={false} />);
    await userEvent.type(screen.getByLabelText(/your idea/i), 'hope in the morning');
    await userEvent.click(screen.getByRole('button', { name: /generate voiceover/i }));
    expect(onGenerate).toHaveBeenCalledWith('hope in the morning', 'devotional-30', 'en-US-GuyNeural');
  });

  it('Generate is disabled while busy', () => {
    render(<ScriptForm onGenerate={vi.fn()} busy={true} />);
    expect(screen.getByRole('button', { name: /generating|generate voiceover/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `cd client && npx vitest run src/components/story/__tests__/ScriptForm.test.tsx`

- [ ] **Step 3: Implement**

```tsx
// client/src/components/story/ScriptForm.tsx
import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { STORY_SCRIPT_TEMPLATES, STORY_VOICES } from '../../lib/storyScript';

interface ScriptFormProps {
  onGenerate: (idea: string, templateId: string, voiceId: string) => void;
  busy: boolean;
}

export function ScriptForm({ onGenerate, busy }: ScriptFormProps) {
  const [idea, setIdea] = useState('');
  const [templateId, setTemplateId] = useState(STORY_SCRIPT_TEMPLATES[0].id);
  const [voiceId, setVoiceId] = useState(STORY_VOICES[0].id);
  const canGenerate = idea.trim().length > 0 && !busy;

  return (
    <div className="space-y-3">
      <label className="block text-sm text-gray-300">
        Template
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-white focus:border-primary-400 focus:outline-none"
        >
          {STORY_SCRIPT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>

      <label className="block text-sm text-gray-300">
        Your idea (rough is fine)
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          rows={4}
          placeholder="trusting god when life is hard and dark, hope comes in the morning"
          className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-white focus:border-primary-400 focus:outline-none"
        />
      </label>

      <label className="block text-sm text-gray-300">
        Voice
        <select
          value={voiceId}
          onChange={(e) => setVoiceId(e.target.value)}
          className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-white focus:border-primary-400 focus:outline-none"
        >
          {STORY_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </label>

      <button
        type="button"
        disabled={!canGenerate}
        onClick={() => onGenerate(idea.trim(), templateId, voiceId)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 py-3 text-sm font-semibold text-dark-900 hover:bg-primary-400 disabled:opacity-50"
      >
        {busy ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
        {busy ? 'Generating voiceover…' : 'Generate voiceover'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run, confirm PASS**

Run: `cd client && npx vitest run src/components/story/__tests__/ScriptForm.test.tsx`

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/components/story/ScriptForm.tsx client/src/components/story/__tests__/ScriptForm.test.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): ScriptForm component"
```

---

## Task 6: Client — entry-mode toggle in StoryVideoPage

**Files:**
- Modify: `client/src/pages/StoryVideoPage.tsx`
- Test: `client/src/pages/__tests__/StoryVideoPage.test.tsx`

Add an `entryMode` toggle (Upload / Write a script) above the upload control; script mode renders `ScriptForm`; "Generate voiceover" calls `scriptToAudio` then sets `pendingAudio` (reusing the ready panel + `startPipeline`).

- [ ] **Step 1: Add failing tests** (inside the existing `describe('StoryVideoPage', ...)`)

```tsx
  it('switches to script mode and generates a voiceover, then shows the ready panel', async () => {
    vi.spyOn(storyApi, 'scriptToAudio').mockResolvedValue('/out/story-tts-1.mp3');
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /write a script/i }));
    await userEvent.type(screen.getByLabelText(/your idea/i), 'hope in the morning');
    await userEvent.click(screen.getByRole('button', { name: /generate voiceover/i }));
    expect(await screen.findByRole('button', { name: /use full audio/i })).toBeInTheDocument();
    expect(storyApi.scriptToAudio).toHaveBeenCalledWith('hope in the morning', 'devotional-30', 'en-US-GuyNeural');
  });

  it('shows the upload button in upload mode (default)', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /upload a sermon/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `cd client && npx vitest run src/pages/__tests__/StoryVideoPage.test.tsx`
Expected: no "Write a script" toggle yet.

- [ ] **Step 3: Implement** in `client/src/pages/StoryVideoPage.tsx`

(a) Import ScriptForm and storyApi is already imported:
```tsx
import { ScriptForm } from '../components/story/ScriptForm';
```
(b) Add entry-mode state with the other state:
```tsx
  const [entryMode, setEntryMode] = useState<'upload' | 'script'>('upload');
```
(c) Add a `handleGenerateScript`:
```tsx
  const handleGenerateScript = async (idea: string, templateId: string, voiceId: string) => {
    setBusy(true);
    try {
      setDefaultTitle(idea.slice(0, 60));
      const path = await storyApi.scriptToAudio(idea, templateId, voiceId);
      setPendingAudio(path);
    } catch (e) {
      toast.error((e as Error).message || 'Voice generation failed');
    } finally {
      setBusy(false);
    }
  };
```
(d) In the Step-1 render, the current `else` branch shows `<>upload button + input</>`. Wrap it so the entry-mode toggle sits above, and script mode swaps in `ScriptForm`. Replace the final `) : (` upload branch (the one after the `pendingAudio ?` branch) with:
```tsx
          ) : (
            <div className="space-y-3">
              <div className="inline-flex rounded-lg border border-white/10 p-0.5 text-sm">
                <button
                  type="button"
                  onClick={() => setEntryMode('upload')}
                  className={`rounded-md px-3 py-1 ${entryMode === 'upload' ? 'bg-white/10 text-white' : 'text-gray-400'}`}
                >
                  Upload audio
                </button>
                <button
                  type="button"
                  onClick={() => setEntryMode('script')}
                  className={`rounded-md px-3 py-1 ${entryMode === 'script' ? 'bg-white/10 text-white' : 'text-gray-400'}`}
                >
                  Write a script
                </button>
              </div>

              {entryMode === 'script' ? (
                <ScriptForm onGenerate={handleGenerateScript} busy={busy} />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-4 py-8 text-sm text-gray-300 hover:border-primary-400 cursor-pointer"
                  >
                    <Upload size={18} />
                    Upload a sermon (MP3/M4A/MP4)
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*,video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handlePickFile(f);
                      e.target.value = '';
                    }}
                  />
                </>
              )}
            </div>
          )}
```
NOTE: keep the `busy ?` spinner branch and the `pendingAudio ?` ready-panel branch exactly as they are; this only changes the final upload `else` branch. The hidden file input must remain mounted whenever upload mode is shown.

- [ ] **Step 4: Run, confirm PASS**

Run: `cd client && npx vitest run src/pages/__tests__/StoryVideoPage.test.tsx` → all pass (existing + 2 new). Existing tests default to upload mode, so they're unaffected.

- [ ] **Step 5: Type-check + commit**

Run: `cd client && npx tsc -b 2>&1 | tail -20` → no errors.
```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/pages/StoryVideoPage.tsx client/src/pages/__tests__/StoryVideoPage.test.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): Write-a-script entry mode on Step 1"
```

---

## Task 7: Full sweep + rebuild bundle

- [ ] **Step 1: Run both suites**

Run: `cd server && npm test` → all green. Run: `cd client && npm test` → all green.

- [ ] **Step 2: Build + commit the bundle**

Run: `cd client && npm run build`.
```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/public
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "build(story-ui): rebuild bundle with script entry"
```

---

## Notes for the Implementer

- **TTS seam in the route test:** `_setTtsImpl` lets the route test avoid real Edge TTS. The fake returns a real temp file the route then MOVES into `outputDir`; the test asserts the returned path is in-scope and exists.
- **`refineScript` LLM seam** is separate from `sceneSegmenter`'s — they each own a `_setLlmImpl`. That's intentional (small duplication; a shared `lib/story/llm.js` is a future consolidation, out of scope here).
- **Manual live check (after Task 6):** start the server (Edge TTS is on by default, no key needed), open `/app/story`, click "Write a script", pick a template, type a rough idea, "Generate voiceover" → a `story-tts-*.mp3` is created → the ready panel appears → Use full audio → the pipeline narrates the script with images. Verify a curated voice (incl. the Nigerian one) actually synthesizes; if a voice id is invalid, Edge throws — swap it in `storyScript.ts`.
- **Voice ids** in `storyScript.ts` are standard Azure/Edge neural names; all five are valid in `msedge-tts`, but confirm during the live check.
