import { useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle, X, ExternalLink } from 'lucide-react';
import { useCompletionAlert, dismissAlert } from '../lib/completionAlert';
import { markRead } from '../lib/notifications';

/**
 * Sticky banner announcing that a job finished.
 *
 * Job completions previously landed only in the bell's list, so a user who
 * clicked "Generate Video" and looked away had no idea it was done — and a
 * FAILED render looked exactly like one still running. This puts the outcome
 * in front of them.
 *
 * It does not auto-dismiss. The user started the task; closing the result is
 * their call, not a timer's. It sits above the content rather than over it, so
 * it never covers the controls someone is mid-way through using.
 */
const TONE = {
    success: {
        Icon: CheckCircle2,
        wrap: 'border-[#7fb5aa]/40 bg-[#7fb5aa]/10',
        icon: 'text-[#8fc2b8]',
        title: 'text-[#c4ddd8]',
    },
    warning: {
        Icon: AlertTriangle,
        wrap: 'border-amber-500/40 bg-amber-500/10',
        icon: 'text-amber-300',
        title: 'text-amber-100',
    },
    error: {
        Icon: XCircle,
        wrap: 'border-red-500/40 bg-red-500/10',
        icon: 'text-red-300',
        title: 'text-red-100',
    },
} as const;

export function CompletionBanner() {
    const alert = useCompletionAlert();
    const navigate = useNavigate();
    if (!alert) return null;

    const tone = TONE[alert.tone];
    const { Icon } = tone;

    const open = () => {
        markRead(alert.id);
        dismissAlert();
        if (alert.href) navigate(alert.href);
    };

    return (
        <div
            role="status"
            aria-live="polite"
            className={`mb-4 flex items-start gap-3 rounded-xl border px-4 py-3 ${tone.wrap}`}
        >
            <Icon size={20} className={`mt-0.5 shrink-0 ${tone.icon}`} />
            <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${tone.title}`}>{alert.title}</p>
                {alert.body && (
                    <p className="mt-0.5 break-all text-xs text-content-secondary">{alert.body}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                    {alert.href && (
                        <button
                            type="button"
                            onClick={open}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
                        >
                            <ExternalLink size={12} />
                            Open
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={dismissAlert}
                        className="rounded-lg px-3 py-1.5 text-xs text-content-secondary transition hover:text-white"
                    >
                        Dismiss
                    </button>
                </div>
            </div>
            <button
                type="button"
                onClick={dismissAlert}
                aria-label="Dismiss notification"
                className="shrink-0 rounded p-1 text-content-tertiary transition hover:text-white"
            >
                <X size={16} />
            </button>
        </div>
    );
}
