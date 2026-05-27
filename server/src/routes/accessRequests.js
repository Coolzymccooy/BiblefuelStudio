//
// Public, unauthenticated endpoint that receives Request-Access form
// submissions from the landing page. NOT mounted under requireAuth.

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { getUsersStore } from '../auth.js';

const submissionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  org: z.string().trim().min(1).max(200),
  pitch: z.string().trim().min(1).max(500),
  hp_url: z.string().max(2000).default(''),
});

/**
 * Inspect history for `email` and return a reason to reject the submission,
 * or null when the request should go through. Rules:
 *
 *   - Email is already a registered user        → ALREADY_REGISTERED
 *   - Email has an APPROVED request on file      → ALREADY_APPROVED
 *   - Email has a PENDING request on file        → ALREADY_PENDING
 *
 * Denied applicants ARE allowed to re-submit — the operator may have
 * changed their mind, and forcing them to email manually is hostile UX.
 */
async function classifyDuplicate(store, email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;

  try {
    const users = getUsersStore();
    const isRegistered = (users.users || []).some(
      (u) => String(u?.email || '').trim().toLowerCase() === target,
    );
    if (isRegistered) {
      return {
        code: 'ALREADY_REGISTERED',
        message: 'This email already has a Biblefuel Studio account. Try signing in instead.',
      };
    }
  } catch {
    // Non-fatal: if users.json read fails we let the duplicate check fall
    // through to the access-request side rather than 500ing the public form.
  }

  if (typeof store?.list === 'function') {
    const all = await store.list();
    const priorApproved = all
      .filter((r) => String(r?.email || '').trim().toLowerCase() === target && r.status === 'approved')
      .sort((a, b) => (Date.parse(b?.reviewedAt || b?.createdAt || '') || 0) - (Date.parse(a?.reviewedAt || a?.createdAt || '') || 0))[0];
    if (priorApproved) {
      return {
        code: 'ALREADY_APPROVED',
        message: 'You\'re already approved for Biblefuel Studio — head to the studio and sign up with this email.',
      };
    }
    const priorPending = all.find((r) => String(r?.email || '').trim().toLowerCase() === target && r.status === 'pending');
    if (priorPending) {
      return {
        code: 'ALREADY_PENDING',
        message: 'We\'ve already received a request for this email and it\'s waiting for review.',
      };
    }
  }

  return null;
}

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
      // Block obvious duplicates BEFORE we write a new record or send the
      // notification email. Saves the operator inbox spam from people
      // re-submitting after they've already been approved/are pending.
      const duplicate = await classifyDuplicate(store, data.email);
      if (duplicate) {
        log.info?.('[access-requests] duplicate blocked', { email: data.email, code: duplicate.code });
        return res.status(409).json({
          ok: false,
          code: duplicate.code,
          error: duplicate.message,
        });
      }

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
