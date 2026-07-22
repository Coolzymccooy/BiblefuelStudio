import { Router } from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildTimelineRenderPlan } from '../lib/timelineRender/planner.js';
import { renderTimelineProof } from '../lib/timelineRender/proofRenderer.js';
import { OUTPUT_DIR } from '../lib/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, '../..');

const jobs = new Map();
let _renderTimelineProof = renderTimelineProof;

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

  try {
    const proofResult = await _renderTimelineProof(job.plan, {
      serverRoot: SERVER_ROOT,
      outputDir: OUTPUT_DIR,
      outputPath: path.join(OUTPUT_DIR, 'timeline', `${job.jobId}.mp4`),
    });

    job.progress = 100;
    job.completedAt = Date.now();
    job.publicUrl = proofResult.publicUrl || null;
    job.file = proofResult.outputPath || null;
    job.ignoredPlaceholders = proofResult.ignoredPlaceholders || 0;
    job.generatedVoiceovers = proofResult.generatedVoiceovers || [];

    if (proofResult.ok) {
      job.status = 'completed';
      job.phase = 'done';
      job.error = null;
      job.note = 'Timeline proof render completed. Chatterbox VO placeholders were synthesized and mixed when present.';
    } else {
      job.status = 'failed';
      job.phase = 'failed';
      job.error = proofResult.error || 'Timeline proof render failed';
      job.note = 'Timeline proof render failed before producing a playable MP4.';
    }
  } catch (e) {
    job.status = 'failed';
    job.phase = 'failed';
    job.progress = 100;
    job.completedAt = Date.now();
    job.error = String(e?.message || e);
    job.note = 'Timeline proof render failed before producing a playable MP4.';
  }
}

const router = Router();

router.post('/render', (req, res) => {
  try {
    const plan = buildTimelineRenderPlan(req.body?.project, {
      quality: req.body?.quality || req.body?.project?.renderSettings?.quality || 'proof_720p',
    });

    if (!plan.ok) {
      return res.status(400).json({ ok: false, error: plan.error || 'INVALID_TIMELINE_PROJECT' });
    }

    const jobId = `timeline-${randomUUID()}`;
    const job = {
      jobId,
      userId: req.ctx?.userId || 'anon',
      status: 'queued',
      phase: 'queued',
      progress: 0,
      plan,
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

    setTimeout(() => {
      runTimelineJob(job).catch((e) => {
        job.status = 'failed';
        job.phase = 'failed';
        job.progress = 100;
        job.completedAt = Date.now();
        job.error = String(e?.message || e);
      });
    }, 0);

    return res.status(202).json(serializeJob(job));
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get('/render/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  return res.json(serializeJob(job));
});

export default router;
