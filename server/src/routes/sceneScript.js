import fs from "fs";
import path from "path";
import { Router } from "express";
import { DATA_DIR, OUTPUT_DIR } from "../lib/paths.js";
import { isSeedanceConfigured } from "../lib/videoGen/providers/seedance.js";
import { wouldExceedCap, ledgerSummary } from "../lib/videoGen/spend.js";
import { similarClips } from "../lib/visualLibrary/store.js";
import { projectFromMarkdown, MAX_MARKDOWN_CHARS } from "../lib/sceneScript/model.js";
import {
  createProject, readProject, updateProject, listProjects, deleteProject, isProjectId,
} from "../lib/sceneScript/projectStore.js";
import { VOICES, DEFAULT_ENSEMBLE, ROOM_SIZES, normaliseCast, isVoiceName } from "../lib/sceneScript/cast.js";
import { startVoicing, isVoicing, lineAudioKey, withTimeline, recoverInterruptedVoicing } from "../lib/sceneScript/voiceStage.js";
import {
  startShots, isOrderingShots, cancelShots, estimateShots, useLibraryClip, shotPrompt, resumeShots,
} from "../lib/sceneScript/shotStage.js";
import { suggestShotPrompts } from "../lib/sceneScript/shotDirector.js";
import { startRender, isRendering, cancelRender, renderBlockers, recoverInterruptedRender } from "../lib/sceneScript/renderStage.js";
import { isBedRef } from "../lib/sceneScript/music.js";

/**
 * Scene scripts: paste an authored cinematic script, voice it word for word,
 * order its shots, render it. Super admins only (Phase 1): one BytePlus
 * balance pays for every clip, so the spend ledger lives in the shared
 * DATA_DIR. Mounted behind requireAuth + withUserScope + requireSuperAdmin.
 */

const MAX_LINE_CHARS = 500;
const MAX_PROMPT_CHARS = 1500;
const MAX_LOOK_CHARS = 600;

const fail = (res, status, code, error, extra = {}) => res.status(status).json({ ok: false, code, error, ...extra });
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

function needsVoice(project) {
  return project.lines.some((l) => !l.audio || l.audio.key !== lineAudioKey(l, project.cast));
}

const busy = (id) => isVoicing(id) || isOrderingShots(id) || isRendering(id);

/** The project as the page sees it: stored fields plus what is derived from them. */
function view(ctx, raw) {
  const project = recoverInterruptedRender(recoverInterruptedVoicing(raw));
  const { source, ...rest } = project;
  const aspect = project.meta?.aspect;
  return {
    ...rest,
    source: { ignored: source.ignored, warnings: source.warnings, parsedAt: source.parsedAt },
    shots: project.shots.map((s) => ({
      ...s,
      effectivePrompt: shotPrompt(project, s),
      similar: s.clip?.status === "done" ? [] : similarClips(ctx.dataDir, shotPrompt(project, s), { aspect }).map((x) => ({ id: x.clip.id, url: x.clip.url, posterUrl: x.clip.posterUrl, prompt: x.clip.prompt, score: x.score })),
    })),
    needsVoice: needsVoice(project),
    estimate: estimateShots(project),
    blockers: renderBlockers(ctx, project),
    running: { voice: isVoicing(project.id), shots: isOrderingShots(project.id), render: isRendering(project.id) },
  };
}

function applyLines(project, edits) {
  if (!Array.isArray(edits)) return project;
  const byId = new Map(edits.filter((e) => e && typeof e.id === "string").map((e) => [e.id, e]));
  return {
    ...project,
    lines: project.lines.map((l) => {
      const e = byId.get(l.id);
      if (!e) return l;
      const text = str(e.text, MAX_LINE_CHARS);
      return {
        ...l,
        ...(text ? { text } : {}),
        ...(e.speaker !== undefined && project.cast[e.speaker] ? { speaker: e.speaker } : {}),
        ...(e.voice === null ? { voice: undefined } : isVoiceName(e.voice) ? { voice: e.voice } : {}),
        ...(e.rate === null ? { rate: undefined } : typeof e.rate === "string" ? { rate: e.rate } : {}),
        ...(e.pitch === null ? { pitch: undefined } : typeof e.pitch === "string" ? { pitch: e.pitch } : {}),
        ...(e.gapAfter === null ? { gapAfter: undefined }
          : Number.isFinite(Number(e.gapAfter)) && e.gapAfter !== "" ? { gapAfter: Math.max(0, Math.min(10, Number(e.gapAfter))) } : {}),
      };
    }),
  };
}

function applyShots(project, edits) {
  if (!Array.isArray(edits)) return project;
  const byId = new Map(edits.filter((e) => e && typeof e.id === "string").map((e) => [e.id, e]));
  return {
    ...project,
    shots: project.shots.map((s) => {
      const e = byId.get(s.id);
      if (!e) return s;
      const prompt = e.prompt === null ? null : str(e.prompt, MAX_PROMPT_CHARS);
      const offset = Number(e.offsetSec);
      return {
        ...s,
        ...(prompt !== undefined ? { prompt: prompt || null, suggested: false } : {}),
        ...(e.accept === true ? { suggested: false } : {}),
        ...(Number.isFinite(offset) ? { offsetSec: Math.max(-3, Math.min(10, offset)) } : {}),
      };
    }),
  };
}

function applyCues(project, edits) {
  if (!Array.isArray(edits)) return project;
  const byId = new Map(edits.filter((e) => e && typeof e.id === "string").map((e) => [e.id, e]));
  return {
    ...project,
    music: {
      ...project.music,
      cues: project.music.cues.map((c) => {
        const e = byId.get(c.id);
        if (!e) return c;
        const offset = Number(e.offsetSec);
        return {
          ...c,
          ...(isBedRef(e.bed) ? { bed: e.bed, bedSuggested: false } : {}),
          ...(Number.isFinite(offset) ? { offsetSec: Math.max(0, Math.min(3600, offset)) } : {}),
        };
      }),
    },
  };
}

function applyEdit(project, body) {
  let next = { ...project };
  const title = str(body.title, 120);
  if (title) next.meta = { ...next.meta, title };
  if (body.cast && typeof body.cast === "object") next.cast = normaliseCast(body.cast, next.cast);
  if (body.look && typeof body.look === "object") {
    next.look = {
      ...next.look,
      ...(str(body.look.lead, MAX_LOOK_CHARS) !== undefined ? { lead: str(body.look.lead, MAX_LOOK_CHARS) } : {}),
      ...(str(body.look.peopleNote, MAX_LOOK_CHARS) !== undefined ? { peopleNote: str(body.look.peopleNote, MAX_LOOK_CHARS) } : {}),
      ...(str(body.look.style, MAX_LOOK_CHARS) !== undefined ? { style: str(body.look.style, MAX_LOOK_CHARS) } : {}),
    };
  }
  if (body.captions && typeof body.captions.enabled === "boolean") next.captions = { enabled: body.captions.enabled };
  if (body.endCard && typeof body.endCard === "object") {
    next.endCard = { reference: str(body.endCard.reference, 80) ?? "", text: str(body.endCard.text, 200) ?? "" };
  }
  next = applyCues(applyShots(applyLines(next, body.lines), body.shots), body.cues);
  return next.timeline ? withTimeline(next) : next;
}

export function createSceneScriptRouter({ ledgerDir = DATA_DIR, deps = {} } = {}) {
  const router = Router();

  const load = (req, res) => {
    if (!isProjectId(req.params.id)) { fail(res, 404, "NOT_FOUND", "Scene script not found."); return null; }
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) fail(res, 404, "NOT_FOUND", "Scene script not found.");
    return project;
  };
  const markdownOf = (req, res) => {
    const md = req.body?.markdown;
    if (typeof md !== "string" || !md.trim()) { fail(res, 400, "BAD_REQUEST", "Paste a script first."); return null; }
    if (md.length > MAX_MARKDOWN_CHARS) { fail(res, 413, "TOO_LONG", `Scripts are limited to ${MAX_MARKDOWN_CHARS.toLocaleString("en-GB")} characters.`); return null; }
    return md;
  };

  router.get("/voices", (_req, res) => res.json({ ok: true, voices: VOICES, ensemble: DEFAULT_ENSEMBLE, rooms: ROOM_SIZES }));

  router.post("/parse", (req, res) => {
    const md = markdownOf(req, res);
    if (md === null) return undefined;
    const draft = { id: "preview", ...projectFromMarkdown(md) };
    const { source, ...rest } = draft;
    return res.json({ ok: true, preview: { ...rest, source: { ignored: source.ignored, warnings: source.warnings } }, estimate: estimateShots(draft) });
  });

  router.get("/", (req, res) => res.json({ ok: true, projects: listProjects(req.ctx.dataDir) }));

  router.post("/", (req, res) => {
    const md = markdownOf(req, res);
    if (md === null) return undefined;
    const project = createProject(req.ctx.dataDir, projectFromMarkdown(md));
    return res.status(201).json({ ok: true, project: view(req.ctx, project) });
  });

  router.get("/:id", (req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    return res.json({ ok: true, project: view(req.ctx, project), month: ledgerSummary(ledgerDir), seedance: isSeedanceConfigured() });
  });

  router.patch("/:id", (req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    if (isRendering(project.id)) return fail(res, 409, "RENDERING", "Wait for the render to finish before editing.");
    const saved = updateProject(req.ctx.dataDir, project.id, (p) => applyEdit(p, req.body || {}));
    return res.json({ ok: true, project: view(req.ctx, saved) });
  });

  router.delete("/:id", (req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    if (busy(project.id)) return fail(res, 409, "BUSY", "Stop the running step before deleting this project.");
    deleteProject(req.ctx.dataDir, req.ctx.outputDir, project.id);
    return res.json({ ok: true });
  });

  router.post("/:id/voice", (req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
      return fail(res, 503, "NOT_CONFIGURED", "Azure Speech is not set up on this server.");
    }
    const started = startVoicing(req.ctx, project.id, { deps: deps.voice });
    if (!started) return fail(res, 409, "RUNNING", "This script is already being voiced.");
    return res.json({ ok: true, project: view(req.ctx, started) });
  });

  router.post("/:id/suggest-shots", async (req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    const ids = Array.isArray(req.body?.shotIds) ? req.body.shotIds.filter((x) => typeof x === "string").slice(0, 100) : undefined;
    const r = await suggestShotPrompts(project, { shotIds: ids, llm: deps.llm });
    if (!r.ok) return fail(res, 502, "NO_SUGGESTIONS", r.error);
    const saved = updateProject(req.ctx.dataDir, project.id, (p) => ({
      ...p,
      shots: p.shots.map((s) => (r.prompts[s.id] && s.clip?.status !== "done" ? { ...s, prompt: r.prompts[s.id], suggested: true } : s)),
    }));
    return res.json({ ok: true, project: view(req.ctx, saved) });
  });

  const onlyOf = (body) => (Array.isArray(body?.only) ? body.only.filter((x) => typeof x === "string").slice(0, 100) : undefined);

  router.post("/:id/shots/estimate", (req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    return res.json({ ok: true, estimate: estimateShots(project, onlyOf(req.body)), month: ledgerSummary(ledgerDir) });
  });

  router.post("/:id/shots", (req, res) => {
    if (!isSeedanceConfigured()) return fail(res, 503, "NOT_CONFIGURED", "AI video is not set up on this server.");
    const project = load(req, res);
    if (!project) return undefined;
    if (isOrderingShots(project.id)) return fail(res, 409, "RUNNING", "Clips are already being made for this script.");
    const est = estimateShots(project, onlyOf(req.body));
    if (!est.clips) return fail(res, 400, "NOTHING_TO_ORDER", "Every shot already has a clip.");
    const budget = wouldExceedCap(ledgerDir, est.usd);
    if (budget.exceeded) return fail(res, 409, "BUDGET", budget.error);
    if (est.overBenchmark && req.body?.confirmOverBenchmark !== true) {
      return fail(res, 409, "OVER_BENCHMARK", `This video would cost about $${est.totalUsd.toFixed(2)}, above the $${est.benchmarkUsd} benchmark. Confirm to go ahead.`, { estimate: est });
    }
    const started = startShots(req.ctx, project.id, { only: onlyOf(req.body), ledgerDir, deps: deps.shots });
    if (!started) return fail(res, 409, "RUNNING", "Clips are already being made for this script.");
    return res.json({ ok: true, project: view(req.ctx, started) });
  });

  router.post("/:id/shots/cancel", (req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    cancelShots(project.id);
    return res.json({ ok: true });
  });

  router.post("/:id/shots/:shotId/library", (req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    const r = useLibraryClip(req.ctx, project.id, String(req.params.shotId), String(req.body?.clipId || ""));
    if (!r.ok) return fail(res, r.status, "LIBRARY", r.error);
    return res.json({ ok: true, project: view(req.ctx, r.project) });
  });

  router.post("/:id/render", (req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    if (isRendering(project.id)) return fail(res, 409, "RUNNING", "This script is already rendering.");
    if (isVoicing(project.id) || isOrderingShots(project.id)) return fail(res, 409, "BUSY", "Wait for voicing and clips to finish.");
    const blockers = renderBlockers(req.ctx, project);
    if (needsVoice(project)) blockers.unshift("Some lines changed since they were voiced. Voice them again.");
    if (blockers.length) return fail(res, 409, "NOT_READY", blockers[0], { blockers });
    const started = startRender(req.ctx, project.id, { deps: deps.render });
    if (!started) return fail(res, 409, "RUNNING", "This script is already rendering.");
    return res.json({ ok: true, project: view(req.ctx, started) });
  });

  router.post("/:id/render/cancel", (req, res) => {
    const project = load(req, res);
    if (!project) return undefined;
    cancelRender(project.id);
    return res.json({ ok: true });
  });

  return router;
}

/** Every data folder that has scene scripts: the owner's and each other user's. */
function sceneScriptContexts() {
  const out = [];
  if (fs.existsSync(path.join(DATA_DIR, "scene-scripts"))) out.push({ dataDir: DATA_DIR, outputDir: OUTPUT_DIR });
  const usersDir = path.join(DATA_DIR, "users");
  if (fs.existsSync(usersDir)) {
    for (const sub of fs.readdirSync(usersDir)) {
      const dataDir = path.join(usersDir, sub);
      if (fs.existsSync(path.join(dataDir, "scene-scripts"))) out.push({ dataDir, outputDir: path.join(dataDir, "outputs") });
    }
  }
  return out;
}

/** After a restart: collect clips that were ordered before it. */
export async function resumeSceneScriptShots({ ledgerDir = DATA_DIR } = {}) {
  let count = 0;
  for (const ctx of sceneScriptContexts()) {
    const projects = listProjects(ctx.dataDir).map((p) => readProject(ctx.dataDir, p.id)).filter(Boolean);
    count += await resumeShots(ctx, projects, { ledgerDir });
  }
  return count;
}
