//
// Renders the internal notification email sent to the operator whenever
// someone submits the Request Access form on the landing page.

import { escapeHtml } from '../escape.js';

// Email subjects must never contain CR/LF — a malicious value could
// otherwise inject fake headers (Bcc, Reply-To, etc.) on the wire.
const oneLine = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

export function renderAccessRequestEmail({ name, email, org, pitch, ip, createdAt }) {
  const subject = `New access request — ${oneLine(name)} (${oneLine(org)})`;

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeOrg = escapeHtml(org);
  const safePitch = escapeHtml(pitch);
  const safeIp = escapeHtml(ip);
  const safeCreatedAt = escapeHtml(createdAt);

  const html = `<!DOCTYPE html>
<html><body style="font-family: Georgia, serif; color: #1a1610; background: #faf6ee; padding: 24px;">
  <h2 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; margin: 0 0 16px;">
    New access request
  </h2>
  <p style="color:#5a5147; margin: 0 0 20px;">From biblefuel.tiwaton.co.uk · ${safeCreatedAt}</p>
  <table style="border-collapse: collapse;">
    <tr><td style="padding:6px 16px 6px 0; color:#a08760;">Name</td><td>${safeName}</td></tr>
    <tr><td style="padding:6px 16px 6px 0; color:#a08760;">Email</td><td>${safeEmail}</td></tr>
    <tr><td style="padding:6px 16px 6px 0; color:#a08760;">Org</td><td>${safeOrg}</td></tr>
    <tr><td style="padding:6px 16px 6px 0; color:#a08760; vertical-align:top;">Pitch</td><td>${safePitch}</td></tr>
    <tr><td style="padding:6px 16px 6px 0; color:#a08760;">IP</td><td>${safeIp}</td></tr>
  </table>
  <p style="color:#5a5147; margin: 24px 0 0; font-size: 13px;">
    Reply to this email to respond directly to ${safeName}.
  </p>
</body></html>`;

  const text = [
    `New access request from biblefuel.tiwaton.co.uk`,
    ``,
    `Name:     ${name}`,
    `Email:    ${email}`,
    `Org:      ${org}`,
    `Pitch:    ${pitch}`,
    ``,
    `IP:       ${ip}`,
    `Received: ${createdAt}`,
    ``,
    `Reply to this email to respond directly to ${name}.`,
  ].join('\n');

  const preview = `${name} · ${org}`;

  return { subject, html, text, preview, replyTo: email };
}
