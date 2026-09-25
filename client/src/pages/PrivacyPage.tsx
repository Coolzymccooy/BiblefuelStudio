import { Link } from 'react-router-dom';

/**
 * Lightweight privacy notice covering what Biblefuel stores, why, and how to
 * delete an account. Linked from the cookie banner and the landing footer.
 * Not legal advice — operators using this in production should have it
 * reviewed against their local jurisdiction.
 */
export function PrivacyPage() {
    return (
        <div className="min-h-screen bg-editorial-paper text-editorial-body">
            <div className="mx-auto max-w-2xl px-5 py-12 sm:px-8 sm:py-20">
                <Link to="/" className="font-sans text-[11px] uppercase tracking-[1.5px] text-editorial-muted hover:text-editorial-ink">
                    ← Back
                </Link>

                <h1 className="mt-6 font-displaySerif text-3xl text-editorial-ink sm:text-4xl">
                    Privacy notice
                </h1>
                <p className="mt-2 text-[12px] text-editorial-muted">Last updated: 2026-05-27</p>

                <section className="mt-10 space-y-4 font-bodyserif text-[15px] leading-relaxed">
                    <h2 className="font-displaySerif text-xl text-editorial-ink">What we store</h2>
                    <ul className="ml-5 list-disc space-y-2">
                        <li><strong>Account:</strong> the email address and password hash you sign up with (held by Firebase Authentication on Google's infrastructure).</li>
                        <li><strong>Your work:</strong> the scripts you write, voice files you generate, and videos you render — stored on our servers under a per-user data directory keyed to your account.</li>
                        <li><strong>Usage counts:</strong> a daily tally of scripts / TTS / renders / image generations to enforce free-tier limits. No content of those requests is kept beyond what you can see in your own dashboard.</li>
                        <li><strong>Payment metadata (if you upgrade):</strong> Stripe customer + subscription IDs and renewal dates. Card details are held by Stripe, not by us.</li>
                        <li><strong>Local storage on this device:</strong> your sign-in token plus draft state (last selected background, audio history, render preferences) so the studio remembers where you left off.</li>
                    </ul>
                </section>

                <section className="mt-8 space-y-4 font-bodyserif text-[15px] leading-relaxed">
                    <h2 className="font-displaySerif text-xl text-editorial-ink">What we don't store</h2>
                    <ul className="ml-5 list-disc space-y-2">
                        <li>No third-party advertising or behavioural-tracking cookies.</li>
                        <li>No social network pixels (Facebook, TikTok, etc.).</li>
                        <li>No analytics services profiling you across sites.</li>
                    </ul>
                </section>

                <section className="mt-8 space-y-4 font-bodyserif text-[15px] leading-relaxed">
                    <h2 className="font-displaySerif text-xl text-editorial-ink">Email</h2>
                    <p>
                        We send a verification email via Firebase when you create an account. If you submit the Request Access form, we receive a notification email through Resend (an EU-hosted transactional email provider). We don't add you to a marketing list — we'll only reply directly to the address you submit.
                    </p>
                </section>

                <section className="mt-8 space-y-4 font-bodyserif text-[15px] leading-relaxed">
                    <h2 className="font-displaySerif text-xl text-editorial-ink">Your rights</h2>
                    <p>
                        You can delete your account at any time from <Link to="/app/settings" className="underline">Settings → Danger zone</Link>. That wipes your per-user data directory on our servers and removes your Firebase Auth record. We keep nothing in cold storage.
                    </p>
                    <p>
                        If you'd like a copy of your data before deleting, or have any other privacy question, email{' '}
                        <a href="mailto:hello@tiwaton.co.uk" className="underline">hello@tiwaton.co.uk</a> and we'll respond within 30 days.
                    </p>
                </section>

                <section className="mt-8 space-y-4 font-bodyserif text-[15px] leading-relaxed">
                    <h2 className="font-displaySerif text-xl text-editorial-ink">Operator</h2>
                    <p>
                        Biblefuel is operated by Tiwaton LTD, registered in the UK.
                    </p>
                </section>

                <div className="mt-12">
                    <Link
                        to="/"
                        className="inline-block rounded-sm bg-editorial-ink px-5 py-3 font-sans text-[11px] font-medium uppercase tracking-[1.6px] text-editorial-paper"
                    >
                        Back to landing
                    </Link>
                </div>
            </div>
        </div>
    );
}
