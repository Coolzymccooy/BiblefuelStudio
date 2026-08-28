import fs from 'fs';
import { friendlyRenderError } from "../lib/renderErrors.js";
import { Router } from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildTimelineRenderPlan } from '../lib/timelineRender/planner.js';
import { renderTimelineProof } from '../lib/timelineRender/proofRenderer.js';
import { resolveProjectAssets } from '../lib/timelineRender/resolveProjectAssets.js';
import { resolveAssetPath } from './jobs.js';
import { resolveOutputAlias } from '../lib/mediaThumb.js';
import { OUTPUT_DIR } from '../lib/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, '../..');

const jobs = new Map();

/**
 * The proof renderer's `error` is either raw ffmpeg stderr or an already-human
 * message ("Chatterbox unavailable"). Translate the former; pass the latter
 * through untouched — flattening it into friendlyRenderError's generic
 * fallback erased actionable messages from the job record.
 */
function presentRenderError(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const friendly = friendlyRenderError('timeline-render', text);
  return /\(ref: render-exit-/.test(friendly) ? text : friendly;
}
let _renderTimelineProof = renderTimelineProof;

function timelineJobsDir(dataDir) {
  return path.join(dataDir || path.join(SERVER_ROOT, 'data'), 'timeline-render-jobs');
}

function persistTimelineJob(job) {
  if (!job.dataDir) return;
  const dir = timelineJobsDir(job.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${job.jobId}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(serializeJob(job), null, 2));
  fs.renameSync(tmp, file);
}

function readPersistedTimelineJob(dataDir, jobId) {
  const safeId = String(jobId || '').replace(/[^a-z0-9-]/gi, '');
  if (!safeId) return null;
  const file = path.join(timelineJobsDir(dataDir), `${safeId}.json`);
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed?.jobId !== jobId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function safeProjectId(projectId) {
  return String(projectId || '').trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 120);
}

function timelineProjectsDir(dataDir) {
  return path.join(dataDir || path.join(SERVER_ROOT, 'data'), 'timeline-projects');
}

function projectFile(dataDir, projectId) {
  const safeId = safeProjectId(projectId);
  if (!safeId) return null;
  return path.join(timelineProjectsDir(dataDir), `${safeId}.json`);
}

function writeTimelineProject(dataDir, project) {
  const id = safeProjectId(project?.id);
  if (!id) throw new Error('Timeline project id required');
  const dir = timelineProjectsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const record = { ...project, id, updatedAt: Date.now() };
  const file = projectFile(dataDir, id);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
  fs.renameSync(tmp, file);
  return record;
}

function readTimelineProject(dataDir, projectId) {
  const file = projectFile(dataDir, projectId);
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function listTimelineProjects(dataDir) {
  const dir = timelineProjectsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function _setTimelineRendererForTest(fn) {
  _renderTimelineProof = fn;
}

export function _resetTimelineRenderJobsForTest() {
  jobs.clear();
  _renderTimelineProof = renderTimelineProof;
}

function serializeJob(job) {
  const generatedVoiceovers = job.generatedVoiceovers || [];
  const voiceProvidersUsed = Array.from(new Set(generatedVoiceovers.map((v) => v.provider).filter(Boolean)));
  const voiceFallbacks = generatedVoiceovers.flatMap((v) => v.fallbacks || []);
  return {
    ok: true,
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    plan: job.plan,
    publicUrl: job.publicUrl || undefined,
    file: job.file || undefined,
    ignoredPlaceholders: job.ignoredPlaceholders || 0,
    // What the render actually included, and what it left out. Surfaced so the
    // UI can say so plainly — a church that lays out an effects track should
    // be told it was not composed, not left to spot the absence by watching.
    coverage: job.coverage || null,
    warnings: job.warnings || [],
    generatedVoiceovers,
    voiceProvidersUsed,
    voiceFallbacks,
    error: job.error || undefined,
    note: job.note,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
  };
}

async function runTimelineJob(job) {
  job.status = 'running';
  job.phase = 'rendering';
  job.progress = 10;
  job.startedAt = Date.now();
  persistTimelineJob(job);

  try {
    const proofResult = await _renderTimelineProof(job.plan, {
      serverRoot: SERVER_ROOT,
      outputDir: OUTPUT_DIR,
      outputPath: path.join(OUTPUT_DIR, 'timeline', `${job.jobId}.mp4`),
      typographyPreset: job.typographyPreset || undefined,
    });

    job.progress = 100;
    job.completedAt = Date.now();
    job.publicUrl = proofResult.publicUrl || null;
    job.file = proofResult.outputPath || null;
    job.ignoredPlaceholders = proofResult.ignoredPlaceholders || 0;
    job.coverage = proofResult.coverage || null;
    job.warnings = proofResult.warnings || [];
    job.generatedVoiceovers = proofResult.generatedVoiceovers || [];

    if (proofResult.ok) {
      job.status = 'completed';
      job.phase = 'done';
      job.error = null;
      job.note = 'Timeline proof render completed. Chatterbox VO placeholders were synthesized and mixed when present.';
    } else {
      job.status = 'failed';
      job.phase = 'failed';
      job.error = presentRenderError(proofResult.error) || 'Timeline proof render failed';
      job.note = 'Timeline proof render failed before producing a playable MP4.';
    }
    persistTimelineJob(job);
  } catch (e) {
    job.status = 'failed';
    job.phase = 'failed';
    job.progress = 100;
    job.completedAt = Date.now();
    job.error = friendlyRenderError('timeline-render', String(e?.message || e));
    job.note = 'Timeline proof render failed before producing a playable MP4.';
    persistTimelineJob(job);
  }
}

const router = Router();

router.get('/projects', (req, res) => {
  return res.json({ ok: true, projects: listTimelineProjects(req.ctx?.dataDir) });
});

router.put('/projects/:projectId', (req, res) => {
  try {
    const project = req.body?.project;
    if (!project || project.id !== req.params.projectId) return res.status(400).json({ ok: false, error: 'Timeline project id mismatch' });
    buildTimelineRenderPlan(project, { quality: project.renderSettings?.quality || 'proof_720p' });
    const saved = writeTimelineProject(req.ctx?.dataDir, project);
    return res.json({ ok: true, project: saved });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get('/projects/:projectId', (req, res) => {
  const project = readTimelineProject(req.ctx?.dataDir, req.params.projectId);
  if (!project) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  return res.json({ ok: true, project });
});

router.post('/render', (req, res) => {
  try {
    // Library ids (from 'Send backgrounds to B-roll') become real media here.
    const project = resolveProjectAssets(req.body?.project, {
      exists: (v) => { try { return fs.existsSync(resolveOutputAlias(v)); } catch { return false; } },
      resolve: (v) => { try { return resolveAssetPath(v); } catch { return null; } },
    });
    const plan = buildTimelineRenderPlan(project, {
      quality: req.body?.quality || req.body?.project?.renderSettings?.quality || 'proof_720p',
    });

    if (!plan.ok) {
      return res.status(400).json({ ok: false, error: plan.error || 'INVALID_TIMELINE_PROJECT' });
    }

    const jobId = `timeline-${randomUUID()}`;
    const job = {
      jobId,
      userId: req.ctx?.userId || 'anon',
      dataDir: req.ctx?.dataDir,
      status: 'queued',
      phase: 'queued',
      progress: 0,
      plan,
      typographyPreset: typeof req.body?.typographyPreset === 'string' ? req.body.typographyPreset : (project?.renderSettings?.typographyPreset || null),
      publicUrl: null,
      file: null,
      ignoredPlaceholders: 0,
      generatedVoiceovers: [],
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      note: 'Timeline proof render queued.',
    };
    jobs.set(jobId, job);
    persistTimelineJob(job);

    setTimeout(() => {
      runTimelineJob(job).catch((e) => {
        job.status = 'failed';
        job.phase = 'failed';
        job.progress = 100;
        job.completedAt = Date.now();
        job.error = friendlyRenderError('timeline-render', String(e?.message || e));
        persistTimelineJob(job);
      });
    }, 0);

    return res.status(202).json(serializeJob(job));
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get('/render/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (job) return res.json(serializeJob(job));
  const persisted = readPersistedTimelineJob(req.ctx?.dataDir, req.params.jobId);
  if (!persisted) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  if (persisted.status === 'queued' || persisted.status === 'running') {
    persisted.status = 'failed';
    persisted.phase = 'interrupted';
    persisted.progress = 100;
    persisted.error = 'Timeline render was interrupted by a server restart. Please render again.';
  }
  return res.json(persisted);
});

export default router;
