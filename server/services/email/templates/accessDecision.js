//
// Outbound emails sent TO the requester when the operator approves or denies
// their landing-page access request. The visual language matches the
// existing access-request notification: serif headlines, warm cream
// background, muted gold accents — so the requester sees consistent
// Biblefuel branding from first contact through onboarding.

import { escapeHtml } from '../escape.js';

const oneLine = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

/**
 * Approval email. Tells the user their email is now eligible for signup
 * and points them at the signup page. signupUrl falls back to a sensible
 * default if the env var is unset.
 *
 * @param {{ name?: string, email: string, signupUrl?: string }} fields
 */
export function renderAccessApprovedEmail({ name, email, signupUrl }) {
  const safeName = escapeHtml(name || 'there');
  const safeEmail = escapeHtml(email);
  const url = String(signupUrl || 'https://biblefuel.tiwaton.co.uk/app').trim();
  const safeUrl = escapeHtml(url);

  const subject = oneLine(`Your Biblefuel Studio access is approved`);
  const preview = `Welcome — you can now sign up at Biblefuel Studio.`;

  const html = `<!DOCTYPE html>
<html><body style="margin:0; background:#faf6ee; padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ee; padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background:#ffffff; border-radius:16px; padding:32px 32px 28px; box-shadow:0 1px 3px rgba(26,22,16,0.06);">
        <tr><td>
          <div style="font-family:'Cormorant Garamond', Georgia, serif; font-size:32px; line-height:1.2; color:#1a1610; font-weight:500; margin:0 0 6px;">
            You're in.
          </div>
          <div style="font-family:Georgia, serif; color:#a08760; font-size:14px; letter-spacing:0.04em; margin:0 0 24px;">
            BIBLEFUEL STUDIO · ACCESS APPROVED
          </div>

          <p style="font-family:Georgia, serif; color:#3a3328; font-size:16px; line-height:1.6; margin:0 0 16px;">
            Hi ${safeName},
          </p>
          <p style="font-family:Georgia, serif; color:#3a3328; font-size:16px; line-height:1.6; margin:0 0 16px;">
            Your request to join Biblefuel Studio has been approved. You can now sign up using <strong>${safeEmail}</strong>.
          </p>

          <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr><td style="background:#c2a261; border-radius:10px;">
              <a href="${safeUrl}" style="display:inline-block; padding:14px 26px; font-family:Georgia, serif; font-size:15px; color:#1a1610; text-decoration:none; font-weight:600; letter-spacing:0.02em;">
                Start your account →
              </a>
            </td></tr>
          </table>

          <p style="font-family:Georgia, serif; color:#5a5147; font-size:14px; line-height:1.6; margin:0 0 8px;">
            One note: sign in with the email above. Other addresses won't get through the gate.
          </p>
          <p style="font-family:Georgia, serif; color:#5a5147; font-size:13px; line-height:1.6; margin:24px 0 0; padding-top:20px; border-top:1px solid #efe8d8;">
            Questions? Just reply to this email and we'll help.
          </p>
        </td></tr>
      </table>

      <div style="font-family:Georgia, serif; color:#a08760; font-size:12px; margin-top:16px; letter-spacing:0.04em;">
        BIBLEFUEL STUDIO
      </div>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `You're in — Biblefuel Studio access approved`,
    ``,
    `Hi ${name || 'there'},`,
    ``,
    `Your request to join Biblefuel Studio has been approved. You can now sign up using ${email}.`,
    ``,
    `Sign up: ${url}`,
    ``,
    `One note: sign in with the email above. Other addresses won't get through the gate.`,
    ``,
    `Questions? Just reply to this email and we'll help.`,
    ``,
    `— Biblefuel Studio`,
  ].join('\n');

  return { subject, html, text, preview };
}

/**
 * Denial email. Kept gentle and short — the goal is to acknowledge the
 * request without making the person feel rejected. No CTA other than reply.
 *
 * @param {{ name?: string, email: string, reason?: string }} fields
 */
export function renderAccessDeniedEmail({ name, email, reason }) {
  const safeName = escapeHtml(name || 'there');
  const safeReason = reason ? `<p style="font-family:Georgia, serif; color:#5a5147; font-size:14px; line-height:1.6; margin:16px 0 0;">${escapeHtml(reason)}</p>` : '';

  const subject = oneLine(`About your Biblefuel Studio request`);
  const preview = `An update on your Biblefuel Studio access request.`;

  const html = `<!DOCTYPE html>
<html><body style="margin:0; background:#faf6ee; padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ee; padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background:#ffffff; border-radius:16px; padding:32px 32px 28px;">
        <tr><td>
          <div style="font-family:'Cormorant Garamond', Georgia, serif; font-size:28px; line-height:1.3; color:#1a1610; font-weight:500; margin:0 0 6px;">
            Thanks for asking
          </div>
          <div style="font-family:Georgia, serif; color:#a08760; font-size:13px; letter-spacing:0.04em; margin:0 0 24px;">
            BIBLEFUEL STUDIO
          </div>

          <p style="font-family:Georgia, serif; color:#3a3328; font-size:16px; line-height:1.6; margin:0 0 16px;">
            Hi ${safeName},
          </p>
          <p style="font-family:Georgia, serif; color:#3a3328; font-size:16px; line-height:1.6; margin:0 0 16px;">
            We've reviewed your request to join Biblefuel Studio and we're unable to approve it at this time.
          </p>
          ${safeReason}
          <p style="font-family:Georgia, serif; color:#5a5147; font-size:13px; line-height:1.6; margin:24px 0 0; padding-top:20px; border-top:1px solid #efe8d8;">
            If anything has changed, reply to this email and we'll take another look.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Thanks for asking`,
    ``,
    `Hi ${name || 'there'},`,
    ``,
    `We've reviewed your request to join Biblefuel Studio and we're unable to approve it at this time.`,
    reason ? `\n${reason}` : '',
    ``,
    `If anything has changed, reply to this email and we'll take another look.`,
    ``,
    `— Biblefuel Studio`,
  ].filter(Boolean).join('\n');

  return { subject, html, text, preview };
}
