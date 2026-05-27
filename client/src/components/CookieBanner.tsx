import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';

const STORAGE_KEY = 'BF_COOKIE_CONSENT';

interface ConsentRecord {
    acceptedAt: string;
    version: number;
}

const CURRENT_VERSION = 1;

function readConsent(): ConsentRecord | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as ConsentRecord;
        if (!parsed || parsed.version !== CURRENT_VERSION) return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeConsent() {
    const rec: ConsentRecord = {
        acceptedAt: new Date().toISOString(),
        version: CURRENT_VERSION,
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
    } catch {
        // localStorage blocked — banner will show again next visit; fine.
    }
}

/**
 * Minimal cookie/storage notice for UK/EU compliance (PECR + ePrivacy).
 *
 * We use:
 *   - Firebase Auth session (strictly necessary — exempt from consent)
 *   - localStorage for app state (functional — discloseable, not strict)
 *   - No third-party analytics, no advertising cookies
 *
 * The banner is a notice-with-acknowledge pattern, not a granular consent
 * manager. That's fine here because none of the storage is non-essential
 * in the GDPR sense; all of it serves the user's direct expectation of
 * the service. Bump CURRENT_VERSION when the privacy notice changes
 * materially — that forces re-acknowledgement.
 */
export function CookieBanner() {
    const [show, setShow] = useState(false);

    useEffect(() => {
        if (!readConsent()) setShow(true);
    }, []);

    if (!show) return null;

    const accept = () => {
        writeConsent();
        setShow(false);
    };

    return (
        <div
            role="dialog"
            aria-label="Cookie notice"
            className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:px-6 sm:pb-6"
        >
            <div className="mx-auto max-w-3xl rounded-xl border border-editorial-ink/15 bg-editorial-paper shadow-[0_18px_60px_rgba(20,16,12,0.18)] backdrop-blur supports-[backdrop-filter]:bg-editorial-paper/95">
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <div className="flex-1 text-[13px] leading-relaxed text-editorial-body">
                        <p className="font-bodyserif">
                            Biblefuel stores your sign-in and a little of your draft work locally so you can pick up where you left off. We don't use third-party trackers or advertising cookies.{' '}
                            <Link to="/privacy" className="underline underline-offset-4 hover:text-editorial-ink">
                                Privacy notice
                            </Link>
                            .
                        </p>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3">
                        <button
                            onClick={accept}
                            className="rounded-sm bg-editorial-ink px-5 py-2.5 font-sans text-[11px] font-semibold uppercase tracking-[1.6px] text-editorial-paper hover:bg-editorial-dark transition-colors"
                        >
                            Got it
                        </button>
                        <button
                            onClick={accept}
                            aria-label="Dismiss"
                            className="text-editorial-muted hover:text-editorial-ink transition-colors p-1"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
