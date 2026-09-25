//
// Resend HTTP transport. Pure fetch — no SDK dependency.
// Returns a stub when RESEND_API_KEY is unset (offline / dev / tests).
// Never throws to the caller — failures return { ok: false, error }.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function createEmailTransport(config = {}) {
  const apiKey = String(config.apiKey || '').trim();
  const defaultFrom = String(config.from || '').trim();
  const defaultReplyTo = String(config.replyTo || '').trim();
  const log = typeof config.log === 'function' ? config.log : defaultLog;
  const fetchImpl = config.fetchImpl || globalThis.fetch;

  if (!apiKey) {
    log('warn', '[email] RESEND_API_KEY not set — using stub transport (no real delivery)');
    return async (payload) => {
      log('info', '[email/stub] would send email', {
        to: payload?.to,
        subject: payload?.subject,
        textPreview: (payload?.text || '').slice(0, 120),
      });
      return { ok: true, id: 'stub-' + Date.now().toString(36), transport: 'stub' };
    };
  }

  if (!defaultFrom) {
    throw new Error('[email] MAIL_FROM is required when RESEND_API_KEY is set');
  }

  return async (payload) => {
    if (!payload?.to || !payload?.subject || !payload?.html) {
      return { ok: false, error: 'INVALID_PAYLOAD', transport: 'resend' };
    }

    const body = {
      from: defaultFrom,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      reply_to: payload.replyTo || defaultReplyTo || undefined,
      headers: payload.headers,
    };

    try {
      const res = await fetchImpl(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const data = await safeJson(res);
      if (!res.ok) {
        const message = data?.message || data?.error || `HTTP ${res.status}`;
        log('error', '[email/resend] send failed', { to: payload.to, status: res.status, message });
        return { ok: false, error: message, transport: 'resend' };
      }

      const id = String(data?.id || '');
      log('info', '[email/resend] sent', { to: payload.to, subject: payload.subject, id });
      return { ok: true, id, transport: 'resend' };
    } catch (err) {
      const message = err?.message || String(err);
      log('error', '[email/resend] threw', { to: payload.to, message });
      return { ok: false, error: message, transport: 'resend' };
    }
  };
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

function defaultLog(level, msg, meta) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta !== undefined) fn(msg, meta); else fn(msg);
}
