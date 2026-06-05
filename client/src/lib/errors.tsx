import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { isApiError, ApiError } from './apiError';

/**
 * Server error code → user-facing friendly text + optional CTA.
 *
 * Add new entries here when a backend route starts returning a structured
 * error code that the UI should explain. Keep the title short (5-6 words),
 * the detail to a single sentence, and the actionTo path actionable.
 */
export interface FriendlyError {
  title: string;
  detail?: string;
  actionLabel?: string;
  actionTo?: string;
}

const QUOTA_BUCKET_LABEL: Record<string, string> = {
  scripts: 'script generations',
  tts: 'voice generations',
  render: 'video renders',
  imageGen: 'AI artwork generations',
};

export function translateError(err: unknown): FriendlyError {
  if (!isApiError(err)) {
    return {
      title: err instanceof Error ? err.message : 'Something went wrong.',
    };
  }
  return mapApiError(err);
}

function mapApiError(err: ApiError): FriendlyError {
  const code = err.code;
  const p = err.payload;

  // QUOTA_EXCEEDED — the plan's daily bucket is full. We have bucket/used/limit/hint.
  if (code === 'QUOTA_EXCEEDED') {
    const bucket = String(p.bucket || '');
    const used = Number(p.used);
    const limit = Number(p.limit);
    const label = QUOTA_BUCKET_LABEL[bucket] || `${bucket} requests`;
    const usage =
      Number.isFinite(used) && Number.isFinite(limit) ? ` (${used}/${limit} used)` : '';
    return {
      title: `Daily ${label} limit reached${usage}`,
      detail: String(p.hint || 'Resets at midnight UTC, or upgrade to Premium for unlimited.'),
      actionLabel: 'Plan & usage',
      actionTo: '/app/settings',
    };
  }

  // Library is empty — Auto-Publish can't pick a background.
  if (code.includes('requires at least one background')) {
    return {
      title: 'Library is empty',
      detail: 'Auto-Publish needs at least one background. Add a clip or image to your Backgrounds library first.',
      actionLabel: 'Open Backgrounds',
      actionTo: '/app/backgrounds',
    };
  }

  // Email verification gate (Phase 2 multitenancy).
  if (code === 'EMAIL_NOT_VERIFIED') {
    return {
      title: 'Verify your email first',
      detail: "Check your inbox for the verification link — we sent it when you signed up.",
    };
  }

  // External service not wired up — soft-failure for optional providers.
  if (code === 'PAYMENTS_NOT_CONFIGURED') {
    return {
      title: 'Billing not available',
      detail: "Premium upgrades aren't enabled on this server yet.",
    };
  }
  if (code === 'POSTIZ_NOT_CONFIGURED') {
    return {
      title: 'Auto-publishing not configured',
      detail: 'Connect a Postiz instance in Settings to enable cross-platform publishing.',
      actionLabel: 'Settings',
      actionTo: '/app/settings',
    };
  }

  // Auth rate limit
  if (code === 'RATE_LIMITED' || /too many|rate.?limit/i.test(code)) {
    return {
      title: 'Too many requests',
      detail: 'Please wait a minute and try again.',
    };
  }

  // FFmpeg pipeline failed (audio process, render, treatment). The raw
  // exit codes (4294967262 = Windows -34, 1 = generic, 8 = invalid arg)
  // don't help end users — translate to something actionable. Specific
  // exit-code hints help when we recognise them; otherwise we point the
  // user at the most common root causes.
  if (/^ffmpeg failed/i.test(code) || code === 'FFMPEG_FAILED') {
    const exitCode = String(p.exitCode || code.match(/\d+/)?.[0] || '');
    let hint = 'The audio/video pipeline failed mid-process. ';
    if (exitCode === '4294967262' || exitCode === '-34') {
      hint += 'This often means the input file was moved, locked, or has an unsupported codec.';
    } else if (exitCode === '1') {
      hint += 'Usually a malformed input or an FFmpeg filter mismatch.';
    } else {
      hint += 'Try again with a different source clip; if it persists the operator should check ffmpeg logs.';
    }
    return {
      title: "Audio processing didn't complete",
      detail: hint,
      actionLabel: 'Try Voice & Audio again',
      actionTo: '/app/voice-audio',
    };
  }

  // TTS providers exhausted — all fallback paths failed. Distinct from
  // QUOTA_EXCEEDED (which is the local app's per-day cap, not the upstream
  // provider's billing wall).
  if (/no alignment|tts (failed|unavailable)|elevenlabs.*quota|edge.?tts.*fail/i.test(code)) {
    return {
      title: 'Voice generation unavailable right now',
      detail: 'All configured TTS providers failed (provider quota or network). Try uploading or recording audio instead.',
      actionLabel: 'Voice & Audio',
      actionTo: '/app/voice-audio',
    };
  }

  // Fallback — show the raw code rather than blank-toasting.
  return {
    title: err.message || code || 'Something went wrong.',
  };
}

/**
 * Drop-in replacement for `toast.error(err.message)`. Renders a friendly
 * title + detail and, if applicable, a CTA Link the user can click to
 * resolve the issue (open Backgrounds, Settings, etc.).
 *
 * Example:
 *   try {
 *     await seriesApi.generate(input);
 *   } catch (err) {
 *     toastError(err);
 *   }
 */
export function toastError(err: unknown): void {
  const f = translateError(err);

  toast.custom(
    (t) => (
      <div className="rounded-xl border border-rose-500/30 bg-dark-900/95 backdrop-blur-md p-3.5 shadow-xl max-w-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.6)]" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm text-gray-100">{f.title}</div>
            {f.detail && (
              <div className="mt-1 text-xs leading-relaxed text-content-secondary">{f.detail}</div>
            )}
            {f.actionLabel && f.actionTo && (
              <Link
                to={f.actionTo}
                onClick={() => toast.dismiss(t.id)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-300 hover:text-primary-200"
              >
                {f.actionLabel} →
              </Link>
            )}
          </div>
          <button
            type="button"
            onClick={() => toast.dismiss(t.id)}
            className="text-content-secondary hover:text-gray-200 transition-colors text-xs"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    ),
    { duration: 8000 },
  );
}
