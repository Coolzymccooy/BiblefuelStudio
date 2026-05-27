import { useState } from 'react';
import toast from 'react-hot-toast';
import { Mail, RefreshCcw, LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

/**
 * Blocks the /app shell until the signed-in user has verified their email.
 *
 * Why client-side AND server-side: server already 403s expensive routes on
 * unverified users via requireVerifiedEmail middleware, but the dashboard
 * shell still rendered. That left users staring at half-working UI and
 * mysterious errors when they clicked things. This gate hides the shell
 * entirely until they click the Firebase verify link in their inbox.
 *
 * Super-admin bypasses (see useAuth.checkStatus).
 */
export function VerifyEmailGate() {
    const { email, resendVerificationEmail, refreshAfterVerify, logout, isLoading, error } = useAuth();
    const [resentAt, setResentAt] = useState<number | null>(null);

    const handleResend = async () => {
        const ok = await resendVerificationEmail();
        if (ok) {
            setResentAt(Date.now());
            toast.success('Verification email re-sent. Check your inbox.');
        } else {
            toast.error('Could not re-send the email. Try again in a moment.');
        }
    };

    const handleRefresh = async () => {
        const ok = await refreshAfterVerify();
        if (ok) toast.success("You're in.");
    };

    return (
        <div className="min-h-screen bg-editorial-ink text-editorial-paper flex items-center justify-center p-6">
            <div className="max-w-md w-full bg-editorial-dark border border-white/10 rounded-2xl p-8 shadow-2xl">
                <div className="flex items-center justify-center w-14 h-14 mx-auto rounded-full bg-editorial-gold/10 border border-editorial-gold/30 mb-5">
                    <Mail size={24} className="text-editorial-gold" />
                </div>

                <h1 className="font-displaySerif text-2xl text-center mb-2">Verify your email</h1>
                <p className="text-center text-sm text-editorial-muted mb-1">
                    We sent a verification link to
                </p>
                <p className="text-center text-sm font-mono break-all mb-6">
                    {email || 'your inbox'}
                </p>

                <div className="space-y-3 text-[13px] leading-relaxed text-editorial-paper/80">
                    <p>
                        Open the email and click the link. It can land in Promotions or Spam — search for
                        <span className="font-semibold"> "Biblefuel"</span> or <span className="font-semibold">"firebaseapp.com"</span>.
                    </p>
                    <p>
                        Once you've clicked it, come back here and tap <span className="font-semibold">I've verified</span>.
                    </p>
                </div>

                {error && (
                    <div className="mt-5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[12px] text-amber-200">
                        {error}
                    </div>
                )}

                <div className="mt-6 space-y-2">
                    <button
                        onClick={handleRefresh}
                        disabled={isLoading}
                        className="w-full rounded-sm bg-editorial-gold px-4 py-3 font-sans text-[11px] font-semibold uppercase tracking-[1.8px] text-editorial-ink disabled:opacity-50 hover:bg-editorial-gold/90 transition-colors flex items-center justify-center gap-2"
                    >
                        <RefreshCcw size={14} />
                        {isLoading ? 'Checking...' : "I've verified"}
                    </button>

                    <button
                        onClick={handleResend}
                        disabled={isLoading || (resentAt !== null && Date.now() - resentAt < 30_000)}
                        className="w-full rounded-sm border border-white/20 px-4 py-3 font-sans text-[11px] uppercase tracking-[1.8px] text-editorial-paper hover:bg-white/5 transition-colors disabled:opacity-40"
                    >
                        {resentAt && Date.now() - resentAt < 30_000 ? 'Sent — wait 30s' : 'Re-send verification email'}
                    </button>

                    <button
                        onClick={logout}
                        className="w-full rounded-sm px-4 py-3 font-sans text-[11px] uppercase tracking-[1.8px] text-editorial-muted hover:text-editorial-paper transition-colors flex items-center justify-center gap-2"
                    >
                        <LogOut size={12} />
                        Sign out
                    </button>
                </div>

                <p className="mt-6 text-center text-[11px] text-editorial-muted">
                    Stuck? Email <a href="mailto:hello@tiwaton.co.uk" className="underline">hello@tiwaton.co.uk</a> and we'll help.
                </p>
            </div>
        </div>
    );
}
