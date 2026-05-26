//
// Public, unauthenticated endpoint that receives Request-Access form
// submissions from the landing page. NOT mounted under requireAuth.

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

const submissionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  org: z.string().trim().min(1).max(200),
  pitch: z.string().trim().min(1).max(500),
  hp_url: z.string().max(2000).default(''),
});

export function createAccessRequestsRouter({ store, sendEmail, notifyTo, log = console }) {
  const router = Router();

  const limiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'RATE_LIMITED' },
  });

  router.post('/', limiter, async (req, res) => {
    const parsed = submissionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: 'VALIDATION',
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    const data = parsed.data;

    // Honeypot: silent drop. Return 200 so bots learn nothing.
    if (data.hp_url && data.hp_url.trim().length > 0) {
      return res.status(200).json({ ok: true });
    }

    try {
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
      const record = await store.append({
        name: data.name,
        email: data.email,
        org: data.org,
        pitch: data.pitch,
        ip: String(ip).slice(0, 64),
        userAgent,
      });

      // Fire-and-forget — never block response on email.
      sendEmail({
        kind: 'access-request',
        to: notifyTo,
        name: record.name,
        email: record.email,
        org: record.org,
        pitch: record.pitch,
        ip: record.ip,
        createdAt: record.createdAt,
      }).then((result) => {
        if (!result.ok) {
          log.error?.('[access-requests] email failed', { id: record.id, error: result.error });
        }
      });

      return res.status(200).json({ ok: true });
    } catch (err) {
      log.error?.('[access-requests] server error', err);
      return res.status(500).json({ ok: false, error: 'SERVER' });
    }
  });

  return router;
}
