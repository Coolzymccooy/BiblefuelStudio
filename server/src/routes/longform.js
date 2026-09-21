import { Router } from "express";
import path from "path";
import { LONGFORM_TEMPLATES, longformTemplateById } from "../lib/longform/templates.js";
import { planLongformScript } from "../lib/longform/scriptPlanner.js";
import { narrateSections } from "../lib/longform/narration.js";
import { wordsFromSections } from "../lib/longform/sectionTimings.js";
import { suggestTemplate } from "../lib/longform/suggestTemplate.js";
import { transcribeAudio } from "../lib/stt/index.js";
import { buildImportedTranscript } from "../lib/story/scriptImport.js";
import { createProject, readProject, writeProject, STORY_STATUS } from "../lib/story/projectStore.js";
import { runStoryPipeline } from "./story.js";

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

// Confines a client-supplied audio path to the operator's own output
// directory. Uses path.resolve (lexical only — it never touches the
// filesystem or follows symlinks) so a path that merely *names* somewhere
// outside outputDir, e.g. via `..` segments, is rejected before anything
// ever tries to read it.
function confineToOutputDir(ctx, candidate) {
  const resolved = path.resolve(String(candidate || ""));
  const root = path.resolve(ctx.outputDir);
  return resolved.startsWith(root + path.sep) || resolved === root ? resolved : null;
}

// Projects with a narration run currently in flight (same pattern as
// story.js's cancelledProjects). Without this, a double-click or an
// impatient "Resume" click during a stalled-but-actually-still-running
// narration would start a second `_narrate` over the same chunk cache
// directory concurrently. A server restart empties the set, so a genuinely
// stalled project (the process died) can still be resumed.
const activeNarrations = new Set();

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
  }));
  return out.every((s) => s.text) ? out : null;
}

router.post("/draft", async (req, res) => {
  try {
    let idea = String(req.body?.idea || "").trim();
    if (!idea && req.body?.audioPath) {
      const audioPath = confineToOutputDir(req.ctx, req.body.audioPath);
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
      scene: { targetSceneSec: template.scene.targetSceneSec, maxScenes: template.scene.maxScenes },
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
  const onProgress = ({ done, total }) => {
    try {
      const fresh = readProject(ctx.dataDir, projectId);
      if (fresh && fresh.status === STORY_STATUS.NARRATING) {
        writeProject(ctx.dataDir, { ...fresh, longform: { ...fresh.longform, progress: { done, total } }, updatedAt: Date.now() });
      }
    } catch { /* progress persistence is best-effort */ }
  };
  const narrated = await _narrate({ sections: project.longform.sections, template, voiceId: resolvedVoiceId, workDir }, { onProgress });
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

router.post("/:id/narrate", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  if (!project.longform?.sections?.length) return res.status(400).json({ ok: false, error: "project has no sections to narrate" });
  if (!longformTemplateById(project.longform.templateId)) return res.status(400).json({ ok: false, error: "project's template is unknown" });
  if (activeNarrations.has(project.projectId)) {
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
  activeNarrations.add(project.projectId);
  runNarration(ctx, project.projectId, voiceId)
    .catch((e) => {
      const fresh = readProject(ctx.dataDir, project.projectId);
      if (fresh) writeProject(ctx.dataDir, { ...fresh, status: STORY_STATUS.ERROR, error: String(e?.message || e) });
    })
    .finally(() => { activeNarrations.delete(project.projectId); });
  return res.json({ ok: true, project: started });
});

export default router;
