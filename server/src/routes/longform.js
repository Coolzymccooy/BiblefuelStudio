import { Router } from "express";
import path from "path";
import { LONGFORM_TEMPLATES, longformTemplateById } from "../lib/longform/templates.js";
import { planLongformScript } from "../lib/longform/scriptPlanner.js";
import { parsePastedScript } from "../lib/longform/scriptParser.js";
import { lookupVerses } from "../lib/bible/scriptureApi.js";
import { narrateSections } from "../lib/longform/narration.js";
import { wordsFromSections } from "../lib/longform/sectionTimings.js";
import { suggestTemplate } from "../lib/longform/suggestTemplate.js";
import { transcribeAudio } from "../lib/stt/index.js";
import { buildImportedTranscript } from "../lib/story/scriptImport.js";
import { createProject, readProject, writeProject, STORY_STATUS } from "../lib/story/projectStore.js";
import { runStoryPipeline, isCancelled, clearCancelled } from "./story.js";
import { markNarrationActive, clearNarrationActive, isNarrationActive } from "../lib/longform/narrationRegistry.js";
import { confineToDir } from "../lib/confinePath.js";
import { quota } from "../middleware/quota.js";

let _plan = planLongformScript;
export function _setPlanImpl(fn) { _plan = fn; }
export function _resetPlanImpl() { _plan = planLongformScript; }
let _narrate = narrateSections;
export function _setNarrateImpl(fn) { _narrate = fn; }
export function _resetNarrateImpl() { _narrate = narrateSections; }
let _pipeline = runStoryPipeline;
export function _setPipelineImpl(fn) { _pipeline = fn; }
export function _resetPipelineImpl() { _pipeline = runStoryPipeline; }
let _transcribe = transcribeAudio;
export function _setTranscribeImpl(fn) { _transcribe = fn; }
export function _resetTranscribeImpl() { _transcribe = transcribeAudio; }
// The render quota is charged on the two expensive POSTs only (draft = LLM
// calls, narrate = TTS), never on templates/sections/reopen. Injectable so
// tests can prove which routes carry it without a real usage store.
let _quota = quota;
export function _setQuotaImpl(fn) { _quota = fn; }
export function _resetQuotaImpl() { _quota = quota; }
function renderQuota(req, res, next) { return _quota("render")(req, res, next); }

// Narration runs in flight are tracked in narrationRegistry.js (shared with
// story.js's GET /:id liveness report). Without it, a double-click or an
// impatient "Resume" click during a slow-but-healthy narration would start
// a second `_narrate` over the same chunk cache directory concurrently.

// Matches story.js's cancel wording so the client's "^cancelled" check treats
// a cancelled narration exactly like a cancelled image run.
const CANCELLED_MESSAGE = "Cancelled.";

const router = Router();

router.get("/templates", (_req, res) => {
  res.json({ ok: true, templates: LONGFORM_TEMPLATES.map((t) => ({ id: t.id, label: t.label, kind: t.kind, targetSec: t.targetSec })) });
});

function normaliseSections(list) {
  if (!Array.isArray(list)) return null;
  const out = list.map((s) => ({
    heading: String(s?.heading || "").trim() || "Section",
    reference: s?.reference ? String(s.reference).trim() : null,
    verseText: String(s?.verseText || "").trim(),
    text: String(s?.text || "").trim(),
    targetSec: Math.max(20, Math.round(Number(s?.targetSec) || 60)),
    ...(Number.isFinite(Number(s?.startMs)) ? { startMs: Number(s.startMs) } : {}),
    ...(Number.isFinite(Number(s?.endMs)) ? { endMs: Number(s.endMs) } : {}),
    // Pasted-script structure: a continuation shares its chapter and may carry
    // its own pause. Dropping these on save would turn every [pause] into a
    // fresh chapter and a default-length gap.
    ...(s?.continuation ? { continuation: true } : {}),
    ...(Number(s?.pauseBeforeMs) > 0 ? { pauseBeforeMs: Math.round(Number(s.pauseBeforeMs)) } : {}),
  }));
  return out.every((s) => s.text) ? out : null;
}

// A pasted script is parsed, never planned: the author's words are the words.
// Verse text is still fetched verbatim by reference. Injectable for tests.
let _parse = parsePastedScript;
export function _setParseImpl(fn) { _parse = fn; }
export function _resetParseImpl() { _parse = parsePastedScript; }
const SCRIPT_MAX_CHARS = 60_000;

async function verseTextFor(reference, translation) {
  const r = await lookupVerses(reference, translation);
  const verses = Array.isArray(r?.verses) ? r.verses : [];
  return verses.map((v) => String(v.text || "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
}

router.post("/draft", renderQuota, async (req, res) => {
  try {
    const script = typeof req.body?.script === "string" ? req.body.script.trim() : "";
    if (script) {
      if (script.length > SCRIPT_MAX_CHARS) return res.status(400).json({ ok: false, error: `script is too long (max ${SCRIPT_MAX_CHARS} characters)` });
      const templateId = String(req.body?.templateId || "").trim() || suggestTemplate(script).templateId;
      const template = longformTemplateById(templateId);
      if (!template) return res.status(400).json({ ok: false, error: "template is required (unknown templateId)" });
      let parsed;
      try {
        parsed = await _parse(script, { lookupVerses: (ref) => verseTextFor(ref, req.body?.translation), defaultPauseMs: template.voice.pauseMs });
      } catch (e) {
        return res.status(400).json({ ok: false, error: String(e?.message || e) });
      }
      const created = createProject(req.ctx.dataDir, {
        title: String(req.body?.title || "").trim() || parsed.title,
        style: req.body?.style,
        aspect: "landscape",
        captions: template.scene.captions,
        scene: { targetSceneSec: template.scene.targetSceneSec, maxScenes: template.scene.maxScenes, beatSec: template.scene.beatSec },
        longform: { templateId: template.id, idea: null, summary: parsed.summary, sections: parsed.sections, source: "pasted" },
      });
      const project = writeProject(req.ctx.dataDir, { ...created, status: STORY_STATUS.DRAFT_SCRIPT });
      return res.json({ ok: true, project });
    }

    let idea = String(req.body?.idea || "").trim();
    if (!idea && req.body?.audioPath) {
      // Lexical only — rejects a path that merely names somewhere outside
      // the caller's outputs before anything tries to read it.
      const audioPath = confineToDir(req.ctx.outputDir, req.body.audioPath);
      if (!audioPath) return res.status(400).json({ ok: false, error: "audioPath must point inside your outputs folder" });
      const transcribed = await _transcribe(audioPath);
      idea = (transcribed?.words || []).map((w) => w.text).join(" ").trim();
      if (!idea) return res.status(400).json({ ok: false, error: "voice note transcription returned no words" });
    }
    if (!idea) return res.status(400).json({ ok: false, error: "idea is required" });

    let suggestion = null;
    let templateId = String(req.body?.templateId || "").trim();
    if (!templateId) {
      suggestion = suggestTemplate(idea);
      templateId = suggestion.templateId;
    }
    const template = longformTemplateById(templateId);
    if (!template) return res.status(400).json({ ok: false, error: "template is required (unknown templateId)" });

    const plan = await _plan({ idea, template, translation: req.body?.translation, targetSec: req.body?.targetSec });
    const created = createProject(req.ctx.dataDir, {
      title: String(req.body?.title || plan.title || "").trim() || plan.title,
      style: req.body?.style,
      aspect: "landscape",
      captions: template.scene.captions,
      scene: { targetSceneSec: template.scene.targetSceneSec, maxScenes: template.scene.maxScenes, beatSec: template.scene.beatSec },
      longform: { templateId: template.id, idea, summary: plan.summary, sections: plan.sections },
    });
    const project = writeProject(req.ctx.dataDir, {
      ...created,
      music: { ...created.music, volume: template.music.volume, autoDuck: template.music.autoDuck },
      status: STORY_STATUS.DRAFT_SCRIPT,
    });
    return res.json({ ok: true, project, ...(suggestion ? { suggestion } : {}) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.patch("/:id/sections", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  if (project.status !== STORY_STATUS.DRAFT_SCRIPT) return res.status(409).json({ ok: false, error: "sections can only be edited while the project is a draft" });
  const sections = normaliseSections(req.body?.sections);
  if (!sections?.length) return res.status(400).json({ ok: false, error: "sections must be a non-empty array with text in every section" });
  const updated = writeProject(req.ctx.dataDir, { ...project, longform: { ...(project.longform || {}), sections } });
  return res.json({ ok: true, project: updated });
});

async function runNarration(ctx, projectId, voiceId) {
  const project = readProject(ctx.dataDir, projectId);
  const template = longformTemplateById(project?.longform?.templateId);
  const workDir = path.join(ctx.outputDir, "longform", projectId);
  // The route persists whatever voice was chosen onto longform.voiceId before
  // calling this function, so a resume (no voiceId in the request body, e.g.
  // the client's stalled-narration Resume path) still uses the voice the user
  // originally picked. This matters beyond consistency: the TTS chunk cache
  // key includes voiceId, so resuming with a different (or missing) voice
  // would silently miss every cached chunk and re-synthesise the whole thing.
  const resolvedVoiceId = voiceId || project?.longform?.voiceId || undefined;
  // Heartbeat: a 30-60 min session can take several minutes to narrate, one
  // provider call at a time. Persisting done/total (and bumping updatedAt)
  // after every chunk keeps the client's stall detector from firing on a
  // slow-but-healthy run. Best-effort, like story.js's persistRenderPct —
  // never let a progress-write failure interrupt the narration itself.
  // The first heartbeat is (0/total) before any provider call, so the UI can
  // show a counter immediately; `provider` is only known once a chunk has
  // actually been voiced (the orchestrator may fall through to a different
  // provider than the template's first preference).
  const persistProgress = ({ done, total, provider }) => {
    try {
      const fresh = readProject(ctx.dataDir, projectId);
      if (fresh && fresh.status === STORY_STATUS.NARRATING) {
        const progress = provider ? { done, total, provider } : { done, total };
        writeProject(ctx.dataDir, { ...fresh, longform: { ...fresh.longform, progress }, updatedAt: Date.now() });
      }
    } catch { /* progress persistence is best-effort */ }
  };
  // Cancel-aware: the shared cancel flag (POST /api/story/:id/cancel) is
  // checked on every chunk heartbeat, so a 30-60 min narration stops within
  // one provider call instead of grinding on.
  const onProgress = (p) => {
    if (isCancelled(projectId)) throw new Error(CANCELLED_MESSAGE);
    persistProgress(p);
  };
  const narrated = await _narrate({ sections: project.longform.sections, template, voiceId: resolvedVoiceId, workDir }, { onProgress });
  if (isCancelled(projectId)) {
    clearCancelled(projectId);
    const cancelled = readProject(ctx.dataDir, projectId);
    if (cancelled) writeProject(ctx.dataDir, { ...cancelled, status: STORY_STATUS.ERROR, error: CANCELLED_MESSAGE });
    return;
  }
  const words = wordsFromSections(narrated.sections);
  const patch = buildImportedTranscript({ script: narrated.sections.map((s) => s.text).join(" "), audioPath: narrated.audioPath, durationMs: narrated.durationMs, words });
  const fresh = readProject(ctx.dataDir, projectId);
  writeProject(ctx.dataDir, {
    ...fresh,
    ...patch,
    longform: { ...fresh.longform, sections: narrated.sections, provider: narrated.provider, voiceId: resolvedVoiceId || null },
    status: STORY_STATUS.SEGMENTING,
  });
  await _pipeline({ dataDir: ctx.dataDir, outputDir: ctx.outputDir }, projectId, narrated.audioPath);
}

router.post("/:id/narrate", renderQuota, (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  if (!project.longform?.sections?.length) return res.status(400).json({ ok: false, error: "project has no sections to narrate" });
  if (!longformTemplateById(project.longform.templateId)) return res.status(400).json({ ok: false, error: "project's template is unknown" });
  if (isNarrationActive(project.projectId)) {
    return res.status(409).json({ ok: false, error: "narration is already running for this project" });
  }
  const voiceId = req.body?.voiceId ? String(req.body.voiceId) : undefined;
  // Persist the chosen voice immediately (not just once narration finishes) so
  // a resume call made with no voiceId — before this run has completed even
  // once — can still fall back to it via runNarration's own resolution.
  const started = writeProject(req.ctx.dataDir, {
    ...project,
    longform: { ...project.longform, voiceId: voiceId || project.longform?.voiceId || null },
    status: STORY_STATUS.NARRATING,
    error: null,
  });
  const ctx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir };
  markNarrationActive(project.projectId);
  clearCancelled(project.projectId); // a fresh run supersedes any earlier cancel
  runNarration(ctx, project.projectId, voiceId)
    .catch((e) => {
      // Recording the failure must never itself become an unhandled
      // rejection (e.g. dataDir unmounted mid-run) — log and move on.
      try {
        const fresh = readProject(ctx.dataDir, project.projectId);
        if (fresh) writeProject(ctx.dataDir, { ...fresh, status: STORY_STATUS.ERROR, error: String(e?.message || e) });
      } catch (e2) {
        console.warn("[longform] failed to record narration error:", e2?.message || e2);
      }
    })
    .finally(() => { clearNarrationActive(project.projectId); });
  return res.json({ ok: true, project: started });
});

// POST /:id/reopen — after a failed narration, drop the project back to the
// outline so the user can edit sections or pick another voice instead of
// starting over. Only valid for a long-form project that is in error.
router.post("/:id/reopen", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  if (!project.longform?.sections?.length) return res.status(400).json({ ok: false, error: "only a long-form project with sections can be reopened" });
  if (project.status !== STORY_STATUS.ERROR) return res.status(400).json({ ok: false, error: "only a project in error can be reopened as a draft" });
  const updated = writeProject(req.ctx.dataDir, { ...project, status: STORY_STATUS.DRAFT_SCRIPT, error: null });
  return res.json({ ok: true, project: updated });
});

export default router;
