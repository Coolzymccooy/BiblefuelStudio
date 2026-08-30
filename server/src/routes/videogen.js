import { Router } from 'express';
import { generateTimelineVideo, isVideoGenEnabled } from '../lib/videoGen/index.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json({ ok: true, enabled: isVideoGenEnabled() });
});

router.post('/generate', async (req, res) => {
  try {
    if (!isVideoGenEnabled()) {
      return res.status(503).json({ ok: false, error: 'NOT_CONFIGURED' });
    }

    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ ok: false, error: 'prompt required' });
    }

    const aspect = ['16:9', '9:16', '1:1'].includes(String(req.body?.aspect))
      ? String(req.body.aspect)
      : '16:9';
    const durationSec = Math.max(4, Math.min(8, Number(req.body?.durationSec) || 8));

    const result = await generateTimelineVideo({
      projectId: req.body?.projectId || `timeline-${req.ctx?.userId || 'anon'}`,
      prompt,
      aspect,
      durationSec,
      style: req.body?.style,
      seedImagePath: req.body?.seedImagePath,
    });

    if (!result.ok) {
      const status = result.code === 'PROVIDER_NOT_IMPLEMENTED' ? 501 : 502;
      return res.status(status).json(result);
    }

    return res.json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
