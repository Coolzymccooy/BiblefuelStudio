//
// Renders the alert email sent to the operator when something on the server
// needs attention: a render failed, the disk is nearly full, a backup failed.

import { escapeHtml } from '../escape.js';

const oneLine = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

export function renderOpsAlertEmail({ subject, detail, at }) {
  const title = oneLine(subject).slice(0, 160) || 'Server alert';
  const safeDetail = escapeHtml(detail || '');
  const safeAt = escapeHtml(at || new Date().toISOString());

  const html = `<!DOCTYPE html>
<html><body style="font-family: Georgia, serif; color: #1a1610; background: #faf6ee; padding: 24px;">
  <h2 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; margin: 0 0 16px;">${escapeHtml(title)}</h2>
  <p style="color:#5a5147; margin: 0 0 20px;">biblefuel.tiwaton.co.uk · ${safeAt}</p>
  <pre style="white-space: pre-wrap; font-family: Menlo, Consolas, monospace; font-size: 13px;">${safeDetail}</pre>
</body></html>`;

  const text = `${title}\n${at || ''}\n\n${detail || ''}`;
  return { subject: `[BibleFuel] ${title}`, html, text };
}
