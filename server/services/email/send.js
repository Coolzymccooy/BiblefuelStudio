//
// Top-level send orchestrator. Each "kind" maps a logical occasion to its
// renderer. Callers don't construct HTML themselves — they call sendEmail.

import { renderAccessRequestEmail } from './templates/accessRequest.js';
import { renderAccessApprovedEmail, renderAccessDeniedEmail } from './templates/accessDecision.js';

export function renderEmailRequest(req) {
  if (!req || typeof req !== 'object') throw new Error('renderEmailRequest: missing request');
  switch (req.kind) {
    case 'access-request': {
      const { to, ...fields } = req;
      const rendered = renderAccessRequestEmail(fields);
      return { ...rendered, to };
    }
    case 'access-approved': {
      const { to, ...fields } = req;
      const rendered = renderAccessApprovedEmail(fields);
      return { ...rendered, to };
    }
    case 'access-denied': {
      const { to, ...fields } = req;
      const rendered = renderAccessDeniedEmail(fields);
      return { ...rendered, to };
    }
    default:
      throw new Error(`renderEmailRequest: unknown kind "${req.kind}"`);
  }
}

export async function sendEmail(transport, req) {
  try {
    const { to, subject, html, text, replyTo } = renderEmailRequest(req);
    const result = await transport({ to, subject, html, text, replyTo });
    return { ok: result.ok, kind: req.kind, id: result.id, error: result.error };
  } catch (err) {
    const message = err?.message || String(err);
    return { ok: false, kind: req?.kind || 'unknown', error: message };
  }
}
