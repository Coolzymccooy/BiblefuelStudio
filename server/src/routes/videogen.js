import { Router } from 'express';
import crypto from 'crypto';
import { generateTimelineVideo, isVideoGenEnabled } from '../lib/videoGen/index.js';
import { reserveSpend, releaseSpend, settleSpendUsd } from '../lib/videoGen/spend.js';
import { DATA_DIR } from '../lib/paths.js';

/**
 * Veo clips for the Timeline. Veo bills per second of video and reports no
 * cost, so, like Seedance, it is for super admins only, and every order is
 * reserved on the shared AI video ledger first (its monthly cap applies) and
 * charged at the estimate once Google has taken the order.
 */

export const VEO_LEDGER_PREFIX = 'veo:';

/** US$ per second of Veo video. Defaults above the list price, so the cap is never under-counted. */
export function veoUsdPerSecond(env = process.env) {
  const rate = Number(env.VEO_USD_PER_SECOND);
  return Number.isFinite(rate) && rate > 0 ? rate : 0.75;
}

// Refusals that mean Google never took the order, so nothing was charged.
const NOT_CHARGED = new Set(['NOT_CONFIGURED', 'BAD_REQUEST', 'VEO_HTTP_ERROR', 'VEO_OPERATION_MISSING', 'PROVIDER_NOT_IMPLEMENTED']);
const wasNotCharged = (result) => Boolean(result?.skipped) || NOT_CHARGED.has(result?.code);

export function createVideogenRouter({ ledgerDir = DATA_DIR, generate = generateTimelineVideo } = {}) {
  const router = Router();

  router.get('/status', (req, res) => {
    res.json({ ok: true, enabled: Boolean(req.ctx?.isSuperAdmin) && isVideoGenEnabled() });
  });

  async function generateClip(req, res) {
    if (!isVideoGenEnabled()) {
      return res.status(503).json({ ok: false, error: 'NOT_CONFIGURED' });
    }
    if (!req.ctx?.isSuperAdmin) {
      return res.status(403).json({ ok: false, code: 'SUPER_ADMIN_ONLY', error: 'AI video is only available to super admins for now.' });
    }

    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ ok: false, error: 'prompt required' });
    }

    const aspect = ['16:9', '9:16', '1:1'].includes(String(req.body?.aspect))
      ? String(req.body.aspect)
      : '16:9';
    const durationSec = Math.max(4, Math.min(8, Number(req.body?.durationSec) || 8));

    const estimateUsd = Math.round(durationSec * veoUsdPerSecond() * 100) / 100;
    const key = `${VEO_LEDGER_PREFIX}${crypto.randomUUID()}`;
    const reserved = reserveSpend(ledgerDir, key, estimateUsd);
    if (!reserved.ok) {
      return res.status(409).json({ ok: false, code: 'BUDGET', error: reserved.error });
    }

    let result;
    try {
      result = await generate({
        projectId: req.body?.projectId || `timeline-${req.ctx?.userId || 'anon'}`,
        prompt,
        aspect,
        durationSec,
        style: req.body?.style,
        seedImagePath: req.body?.seedImagePath,
      });
    } catch (e) {
      // It may have failed after Google took the order: count it.
      settleSpendUsd(ledgerDir, key, estimateUsd);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }

    if (result?.ok || !wasNotCharged(result)) settleSpendUsd(ledgerDir, key, estimateUsd);
    else releaseSpend(ledgerDir, key);

    if (!result?.ok) {
      const status = result?.code === 'PROVIDER_NOT_IMPLEMENTED' ? 501 : 502;
      return res.status(status).json(result);
    }
    return res.json({ ...result, costUsd: estimateUsd });
  }

  // A ledger that cannot be written (a full disk, say) fails this request,
  // never the server: Express 4 does not catch a rejected handler.
  router.post('/generate', (req, res) => {
    generateClip(req, res).catch((e) => {
      console.error('[video-gen] generate failed:', e?.message || e);
      if (!res.headersSent) res.status(500).json({ ok: false, error: String(e?.message || e) });
    });
  });

  return router;
}

export default createVideogenRouter();
