import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import toast from 'react-hot-toast';
import { Sparkles, Mail, ArrowLeft, Globe, ShieldCheck, Rocket, Briefcase, Wand2, Eye, EyeOff, ChevronRight } from 'lucide-react';
import { NotificationsBell } from '../components/NotificationsBell';
import { api } from '../lib/api';
import { firebaseRequestPasswordReset, getFirebaseAuthErrorMessage, isFirebaseClientEnabled } from '../lib/firebase';
import { useVoiceSynthesisDefaults } from '../lib/voiceSynthesisDefaults';
import { LoginBackdrop } from '../components/landing/LoginBackdrop';
import { ApiError } from '../lib/apiError';
import { toastError } from '../lib/errors';

interface JobRow {
    id: string;
    type: string;
    status: string;
    createdAt: string;
    finishedAt?: string;
    error?: string;
    result?: {
        share?: {
            ok?: boolean;
            make?: { ok?: boolean };
            zernio?: { ok?: boolean };
        };
    };
}

function DailyStatsCard() {
    const [stats, setStats] = useState({
        campaignsToday: 0,
        campaignsSuccessToday: 0,
        campaignsFailedToday: 0,
        rendersThisWeek: 0,
        totalJobs: 0,
    });
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        const load = async () => {
            try {
                const res = await api.get('/api/jobs');
                if (res.ok && Array.isArray(res.data?.jobs)) {
                    const jobs: JobRow[] = res.data.jobs;
                    const now = Date.now();
                    const startOfDay = new Date();
                    startOfDay.setHours(0, 0, 0, 0);
                    const dayMs = startOfDay.getTime();
                    const weekMs = now - 7 * 24 * 60 * 60 * 1000;

                    const campaigns = jobs.filter((j) => j.type === 'campaign_auto_post');
                    const campaignsTodayList = campaigns.filter((j) => new Date(j.createdAt).getTime() >= dayMs);
                    const renders = jobs.filter((j) => j.type === 'render_video' || j.type === 'render_waveform');
                    const rendersThisWeek = renders.filter((j) => new Date(j.createdAt).getTime() >= weekMs);

                    // "Published" = the post actually reached a social destination.
                    // A campaign whose render finished but whose dispatch failed
                    // (no webhook configured, Zernio not set, etc.) counts as
                    // failed-to-publish, not published — otherwise the dashboard
                    // lies about real reach.
                    const isPublished = (j: JobRow) => {
                        const share = j.result?.share;
                        if (!share) return false;
                        return Boolean(share.ok || share.zernio?.ok || share.make?.ok);
                    };
                    const publishedToday = campaignsTodayList.filter((j) => j.status === 'done' && isPublished(j));
                    const failedTodayList = campaignsTodayList.filter((j) => j.status === 'failed' || (j.status === 'done' && !isPublished(j)));
                    setStats({
                        campaignsToday: campaignsTodayList.length,
                        campaignsSuccessToday: publishedToday.length,
                        campaignsFailedToday: failedTodayList.length,
                        rendersThisWeek: rendersThisWeek.length,
                        totalJobs: jobs.length,
                    });
                }
            } finally {
                setLoading(false);
            }
        };
        load();
        const t = setInterval(load, 30_000); // refresh every 30s
        return () => clearInterval(t);
    }, []);

    const Stat = ({ value, label, accent }: { value: number; label: string; accent?: string }) => (
        <div className="rounded-[13px] bg-[rgba(216,184,120,0.04)] border border-[rgba(216,184,120,0.08)] px-2.5 py-3">
            <div className="text-[22px] font-bold leading-none" style={{ color: accent || '#f4ecdc' }}>{loading ? '…' : value}</div>
            <div className="text-[9px] font-medium uppercase tracking-wide text-bf-muted mt-1.5">{label}</div>
        </div>
    );

    return (
        <div className="card !p-4">
            <div className="flex items-center justify-between mb-3.5">
                <div className="text-[12px] font-semibold text-bf-cream">Today</div>
                <button onClick={() => navigate('/app/jobs')} className="text-[9px] font-semibold uppercase tracking-[0.12em] text-bf-goldDeep hover:text-bf-gold">
                    All jobs →
                </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
                <Stat value={stats.campaignsToday} label="Campaigns" accent="#e6c98a" />
                <Stat value={stats.campaignsSuccessToday} label="Published" accent="#6fcf97" />
                <Stat value={stats.campaignsFailedToday} label="Failed" accent={stats.campaignsFailedToday > 0 ? '#e08a8a' : '#a99f8b'} />
                <Stat value={stats.rendersThisWeek} label="Renders 7d" />
                <Stat value={stats.totalJobs} label="All jobs" />
            </div>
        </div>
    );
}

interface AutoPublishStatus {
    canAutoPublish: boolean;
    destinations: string[];
    isSuperAdmin: boolean;
}

function AutoPublishCard() {
    const [isLaunching, setIsLaunching] = useState(false);
    const [recentJobId, setRecentJobId] = useState<string | null>(null);
    const [status, setStatus] = useState<AutoPublishStatus | null>(null);
    const navigate = useNavigate();
    const [voiceDefaults] = useVoiceSynthesisDefaults();

    // Pre-flight: ask the server whether this user has any destination
    // connected. If not, the card switches to "render-only" mode — the
    // button still works (generates the video) but the wording and toast
    // make it clear nothing will be auto-posted. Avoids the misleading
    // "Auto-Publish failed" red toast users used to get when the video
    // actually rendered fine — there was just nowhere to post it.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const res = await api.get<AutoPublishStatus>('/api/social/auto-publish-status');
            if (cancelled) return;
            if (res.ok && res.data) setStatus(res.data);
        })();
        return () => { cancelled = true; };
    }, []);

    const renderOnly = status !== null && !status.canAutoPublish;

    const handleAutoPublish = async () => {
        setIsLaunching(true);
        try {
            // When the user hasn't opened Voice Synthesis Defaults yet we
            // still want kinetic captions, not the legacy 6-line fallback.
            // 'general' resolves to cinematic-default preset; Whisper-based
            // forced-alignment kicks in if the TTS provider doesn't supply
            // word timestamps natively.
            const voicePayload = voiceDefaults.enabled
                ? {
                      narrationCategory: voiceDefaults.category,
                      preferredProvider: voiceDefaults.providerOverride || undefined,
                      forcedAlignmentFallback: voiceDefaults.cinematicMode,
                      kineticCaptions: true,
                  }
                : {
                      narrationCategory: 'general',
                      forcedAlignmentFallback: true,
                      kineticCaptions: true,
                  };
            const res = await api.post('/api/jobs/enqueue', {
                type: 'campaign_auto_post',
                payload: {
                    aspect: 'portrait',
                    durationSec: 20,
                    destination: 'webhook',
                    ...voicePayload,
                },
            });
            if (res.ok && res.data?.job?.id) {
                setRecentJobId(res.data.job.id);
                toast.success(renderOnly
                    ? "Generating your video — you'll be notified when it's ready (not auto-posted, see Settings)"
                    : "Auto-Publish started — you'll be notified when the video is live");
            } else {
                // Surface the rich payload (bucket/used/limit/hint for quota,
                // structured codes for everything else) via the friendly
                // toast translator instead of dumping the raw error string.
                const payload = (res.data as Record<string, unknown>) || {};
                const code = String(payload.error || res.error || 'AUTO_PUBLISH_FAILED');
                toastError(new ApiError(code, code, payload));
            }
        } catch (err) {
            toastError(err);
        } finally {
            setIsLaunching(false);
        }
    };

    const pillGreen = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium text-bf-success';
    const pillGreenStyle = { background: 'rgba(111,207,151,0.14)', border: '1px solid rgba(111,207,151,0.28)' };

    return (
        <div
            className="relative overflow-hidden rounded-bf-lg p-[22px] border"
            style={{
                borderColor: renderOnly ? 'rgba(111,207,151,0.30)' : 'rgba(230,201,138,0.28)',
                background: renderOnly
                    ? 'linear-gradient(155deg,rgba(111,207,151,0.14),rgba(216,184,120,0.03) 55%,transparent)'
                    : 'linear-gradient(155deg,rgba(230,201,138,0.16),rgba(216,184,120,0.03) 55%,transparent)',
            }}
        >
            <div className="pointer-events-none absolute -top-8 -right-5 h-[150px] w-[150px] rounded-full" style={{ background: 'radial-gradient(circle,rgba(230,201,138,0.22),transparent 70%)' }} />
            <div className="relative">
                <div className="flex items-center gap-2.5">
                    <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] border" style={{ borderColor: renderOnly ? 'rgba(111,207,151,0.3)' : 'rgba(230,201,138,0.3)', background: renderOnly ? 'rgba(111,207,151,0.12)' : 'rgba(230,201,138,0.12)' }}>
                        <Rocket size={22} className={renderOnly ? 'text-bf-success' : 'text-[#f0d49a]'} />
                    </div>
                    <div className="font-semibold text-[17px] text-bf-cream">
                        {renderOnly ? 'Generate a fresh video' : 'Auto-Publish a fresh post'}
                    </div>
                </div>

                <p className="mt-3 text-[12px] leading-relaxed text-[#c0b49c]">
                    {renderOnly
                        ? 'One click chains: script → background → voice → render. Ready to download or share manually.'
                        : <>One click chains: <span className="text-bf-gold">script → background → voice → render → TikTok / YouTube.</span></>}
                    {' '}Needs at least one background in your Library.
                </p>

                {renderOnly && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ border: '1px solid rgba(230,201,138,0.3)', background: 'rgba(230,201,138,0.08)', color: '#e6c98a' }}>
                        <span aria-hidden className="shrink-0">⚠︎</span>
                        <div className="flex-1">
                            <strong className="font-semibold">Render-only mode.</strong>{' '}
                            No destination connected yet — the video generates but won&apos;t auto-post.{' '}
                            <Link to="/app/settings" className="underline decoration-bf-goldDeep/60 hover:text-bf-cream">Set up Auto-Publish →</Link>
                        </div>
                    </div>
                )}

                <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                    <span className={pillGreen} style={pillGreenStyle}><Sparkles size={12} /> Kinetic captions on</span>
                    {voiceDefaults.enabled ? (
                        <span className={pillGreen} style={pillGreenStyle}>
                            <Wand2 size={12} /> Voice: {voiceDefaults.category}{voiceDefaults.cinematicMode ? ' · cinematic' : ''}
                        </span>
                    ) : (
                        <Link to="/app/settings" className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium text-content-secondary hover:text-bf-cream" style={{ background: 'rgba(216,184,120,0.06)', border: '1px solid rgba(216,184,120,0.16)' }}>
                            <Wand2 size={12} /> Voice off — enable
                        </Link>
                    )}
                    {status?.destinations?.map((d) => (
                        <span key={d} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium text-bf-gold" style={{ background: 'rgba(230,201,138,0.12)', border: '1px solid rgba(230,201,138,0.24)' }}>
                            ✓ {d === 'zernio' ? 'TikTok (Zernio)' : d === 'webhook' ? 'Webhook' : d}
                        </span>
                    ))}
                </div>

                {recentJobId && (
                    <p className="mt-2 font-mono text-[11px] text-bf-success">Last job: {recentJobId} — watch the bell, or open Jobs.</p>
                )}

                <div className="mt-4 flex gap-2">
                    <button onClick={handleAutoPublish} disabled={isLaunching} className="btn btn-primary h-[50px] flex-1 gap-2 rounded-[14px] disabled:opacity-60">
                        <Rocket size={17} />
                        {isLaunching ? 'Starting…' : renderOnly ? 'Generate Video' : 'Auto-Publish Now'}
                    </button>
                    <button onClick={() => navigate('/app/jobs')} className="btn btn-secondary h-[50px] px-4 rounded-[14px]" aria-label="Jobs">
                        <Briefcase size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}

export function HomePage() {
    const {
        token,
        hasUser,
        firebaseEnabled,
        isLoading,
        error: authError,
        setup,
        login,
        signupWithFirebaseEmail,
        loginWithFirebaseEmail,
        loginWithFirebaseGoogle,
    } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirm, setPasswordConfirm] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
    const [setupKey, setSetupKey] = useState('');
    const [view, setView] = useState<'login' | 'setup' | 'forgot-password'>('login');
    const [localError, setLocalError] = useState<string | null>(null);
    const useFirebaseAuth = firebaseEnabled && isFirebaseClientEnabled();

    // Layout already fires checkStatus on mount, and the store now coalesces
    // concurrent calls. No need to double-fire from here.

    // Default view selection. The landing page's primary auth CTA is "Sign
    // in" — visitors who reach /app are overwhelmingly returning users, so
    // we land on login and let them tap Register to switch.
    //
    // The legacy non-Firebase setup-key flow (operator's first-boot
    // bootstrap with zero users) is the one case where we auto-route to
    // setup. We have to wait for /auth/status to resolve before deciding,
    // otherwise the initial render fires with stale defaults and flips
    // everyone to signup before Firebase mode is known.
    const initialViewPicked = useRef(false);
    useEffect(() => {
        if (initialViewPicked.current) return;
        if (isLoading) return;
        // /auth/status returned: firebaseEnabled and hasUser are now truthful.
        initialViewPicked.current = true;
        if (useFirebaseAuth) {
            setView('login');
            return;
        }
        if (!hasUser) {
            setView('setup');
            return;
        }
        setView('login');
    }, [useFirebaseAuth, hasUser, isLoading]);

    const handleSetup = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError(null);
        if (password !== passwordConfirm) {
            setLocalError("Passwords don't match. Please re-enter them.");
            return;
        }
        const success = useFirebaseAuth
            ? await signupWithFirebaseEmail(email, password)
            : await setup(email, password, setupKey);
        if (success) {
            localStorage.setItem('BF_HAS_ACCOUNT', '1');
            toast.success('Account created — check your inbox to verify your email');
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError(null);
        const success = useFirebaseAuth
            ? await loginWithFirebaseEmail(email, password)
            : await login(email, password);
        if (success) toast.success('Login successful!');
    };

    const handleForgotPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError(null);
        try {
            if (useFirebaseAuth) {
                await firebaseRequestPasswordReset(email);
                toast.success('Password reset email sent');
                setView('login');
                return;
            }
            const res = await api.post('/api/auth/forgot-password', { email });
            if (res.ok) {
                toast.success('Reset link sent to your email (simulated)');
                setView('login');
            } else {
                setLocalError(res.error || 'Failed to request reset');
            }
        } catch (err) {
            if (useFirebaseAuth) {
                setLocalError(getFirebaseAuthErrorMessage(err, 'Unable to send reset email right now.'));
            } else {
                setLocalError('An unexpected error occurred');
            }
        }
    };

    const handleGoogleLogin = async () => {
        if (useFirebaseAuth) {
            const success = await loginWithFirebaseGoogle();
            if (success) toast.success('Login successful!');
            return;
        }
        window.location.href = `${api.baseUrl || window.location.origin}/api/auth/google`;
    };

    const error = localError || authError;

    if (token) {
        const workflow = [
            { text: 'Generate scripts', to: '/app/scripts' },
            { text: 'Add to queue & export', to: '/app/queue' },
            { text: 'Get backgrounds', to: '/app/backgrounds' },
            { text: 'Generate voice', to: '/app/voice-audio' },
            { text: 'Edit timeline', to: '/app/timeline' },
            { text: 'Render video', to: '/app/render' },
            { text: 'Share to socials', to: '/app/render#share-kit' },
        ];
        return (
            <div className="space-y-5">
                {/* Greeting */}
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-[12px] text-content-secondary">Peace be with you,</div>
                        <div className="font-displaySerif text-[26px] font-semibold leading-none text-bf-cream mt-0.5">Welcome back</div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Global bell already lives in the desktop shell corner — avoid a duplicate. */}
                        <span className="lg:hidden"><NotificationsBell /></span>
                        <div className="flex h-[38px] w-[38px] items-center justify-center rounded-xl border border-[rgba(216,184,120,0.2)] font-semibold text-bf-gold" style={{ background: 'linear-gradient(150deg,#4a3d24,#251c10)' }}>✦</div>
                    </div>
                </div>

                <AutoPublishCard />
                <DailyStatsCard />

                {/* The workflow */}
                <div className="card !p-4">
                    <div className="font-displaySerif text-[19px] font-semibold text-bf-cream">The workflow</div>
                    <div className="mt-0.5 mb-3 text-[11px] text-bf-muted">Follow the order, or jump anywhere.</div>
                    <div className="flex flex-col">
                        {workflow.map((w, i) => (
                            <Link key={w.to} to={w.to} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[rgba(216,184,120,0.05)]">
                                <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-[rgba(216,184,120,0.24)] bg-[rgba(216,184,120,0.10)] text-[11px] font-semibold text-bf-goldDeep tabular-nums">{i + 1}</div>
                                <div className="flex-1 text-[13px] font-medium text-[#d8cdb6]">{w.text}</div>
                                <ChevronRight size={18} className="text-bf-faint transition-transform group-hover:translate-x-0.5" />
                            </Link>
                        ))}
                    </div>
                    <Link to="/app/help" className="btn btn-secondary mt-3 h-9 w-full justify-center text-xs">View the full automation guide</Link>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-center gap-2 font-mono text-[10px] text-bf-faint">
                    <div className="h-1.5 w-1.5 rounded-full bg-bf-success animate-bfpulse" />
                    System authenticated · v3.0.0
                </div>
            </div>
        );
    }

    // Auth Views — split layout: scripture stage on the left (lg+), form on
    // the right. Below lg, only the form is shown so mobile users land on
    // the action immediately without scrolling past a verse.
    return (
        <div className="relative min-h-screen overflow-hidden bg-[#070504] animate-fade-in">
            {/* Ambient depth — same warm halos behind both panels so the
                seam between them doesn't read as a hard divider. */}
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(212,175,110,0.10),transparent_50%),radial-gradient(circle_at_90%_88%,rgba(107,79,31,0.16),transparent_50%)]" />

            <div className="relative grid min-h-screen lg:grid-cols-[1.05fr_minmax(420px,0.85fr)]">
                {/* LEFT — scripture stage. Hidden below lg. */}
                <div className="relative hidden border-r border-editorial-gold/10 bg-[linear-gradient(165deg,#1a1610_0%,#0c0805_60%,#070504_100%)] lg:block">
                    <LoginBackdrop />
                </div>

                {/* RIGHT — form column. Holds the full sign-in flow on every
                    breakpoint. On mobile this column is the whole page. */}
                <div className="relative z-10 flex items-center justify-center px-5 py-10 sm:px-8 sm:py-14 lg:px-12">
                    {/* Back-to-home affordance. Top-left on lg+, top-right on
                        mobile (where the wordmark sits below it). Always
                        present so users can exit the auth flow. */}
                    <Link
                        to="/"
                        className="absolute left-5 top-5 z-20 inline-flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-[2px] text-editorial-gold/70 hover:text-editorial-goldLite transition-colors sm:left-8 sm:top-8 lg:left-12 lg:top-10"
                        title="Back to home"
                    >
                        <span aria-hidden="true">←</span>
                        Back to home
                    </Link>

                    <div className="flex w-full max-w-[440px] flex-col items-center gap-6">
                        {/* Wordmark only appears on mobile/tablet — on lg the
                            left panel already carries the brand. Clickable so
                            tapping the brand returns to the landing page. */}
                        <Link to="/" className="flex items-center gap-3 lg:hidden" title="Back to home">
                            <span
                                className="font-displaySerif italic text-[40px] leading-none tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-editorial-cream via-editorial-goldLite to-editorial-gold drop-shadow-[0_12px_30px_rgba(212,175,110,0.25)] sm:text-[44px]"
                            >
                                Biblefuel
                            </span>
                        </Link>

                        <div className="w-full">
                        <div className="flex w-full flex-col rounded-[2rem] border border-editorial-gold/15 bg-[#15110a] p-5 shadow-[0_34px_110px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(212,175,110,0.10)] sm:p-6">
                            <div className="mb-5 flex items-center gap-3">
                                <div className="rounded-2xl border border-editorial-gold/30 bg-editorial-gold/10 p-2.5">
                                    <ShieldCheck className="text-editorial-goldLite" size={18} />
                                </div>
                                <div className="rounded-2xl border border-editorial-cream/20 bg-editorial-cream/[0.06] p-2.5">
                                    <Globe className="text-editorial-cream" size={18} />
                                </div>
                            </div>

                            <h1 className="font-displaySerif text-[44px] leading-[1.0] text-bf-cream font-semibold tracking-[-0.005em]">
                                {view === 'forgot-password' ? 'Reset access' : view === 'setup' ? 'Create account' : "Let's sign you in."}
                            </h1>
                            <p className="mt-2 text-help">
                                {view === 'forgot-password'
                                    ? 'Enter your email and continue.'
                                    : view === 'setup'
                                        ? 'Build your studio account in seconds.'
                                        : 'Welcome back. Your studio is ready.'}
                            </p>

                            {firebaseEnabled && !useFirebaseAuth && (
                                <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs text-content-secondary">
                                    Firebase server auth is enabled, but client Firebase keys are missing. Using local auth fallback.
                                </div>
                            )}

                            {view === 'setup' && (
                                <form onSubmit={handleSetup} className="mt-6 space-y-3">
                                    {!useFirebaseAuth && (
                                        <Input
                                            type="password"
                                            value={setupKey}
                                            onChange={(e) => setSetupKey(e.target.value)}
                                            placeholder="Setup key"
                                            required
                                            className="h-11 rounded-xl border-[rgba(216,184,120,0.14)] bg-bf-input text-bf-cream placeholder:text-bf-muted"
                                        />
                                    )}
                                    <Input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="Email"
                                        required
                                        className="h-11 rounded-xl border-[rgba(216,184,120,0.14)] bg-bf-input text-bf-cream placeholder:text-bf-muted"
                                    />
                                    <div className="relative">
                                        <Input
                                            type={showPassword ? 'text' : 'password'}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder="Password"
                                            required
                                            minLength={8}
                                            className="h-11 rounded-xl border-[rgba(216,184,120,0.14)] bg-bf-input pr-11 text-bf-cream placeholder:text-bf-muted"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword((v) => !v)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-content-secondary hover:text-gray-100 transition-colors"
                                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                                            tabIndex={-1}
                                        >
                                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                    <div className="relative">
                                        <Input
                                            type={showPasswordConfirm ? 'text' : 'password'}
                                            value={passwordConfirm}
                                            onChange={(e) => setPasswordConfirm(e.target.value)}
                                            placeholder="Confirm password"
                                            required
                                            minLength={8}
                                            className="h-11 rounded-xl border-[rgba(216,184,120,0.14)] bg-bf-input pr-11 text-bf-cream placeholder:text-bf-muted"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPasswordConfirm((v) => !v)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-content-secondary hover:text-gray-100 transition-colors"
                                            aria-label={showPasswordConfirm ? 'Hide password' : 'Show password'}
                                            tabIndex={-1}
                                        >
                                            {showPasswordConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                    <Button type="submit" className="mt-1 h-11 w-full border-none bg-gradient-to-b from-[#e9cd8d] to-[#cba85f] text-[#221703] font-semibold shadow-[0_12px_26px_-8px_rgba(216,184,120,0.5)] hover:brightness-[1.03]" isLoading={isLoading}>
                                        Create account
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        className="h-11 w-full border-none bg-white text-gray-700 hover:bg-gray-200"
                                        onClick={handleGoogleLogin}
                                    >
                                        <Globe size={16} className="mr-2" />
                                        Sign up with Google
                                    </Button>
                                    <div className="flex flex-col items-center gap-2 pt-1">
                                        <button
                                            type="button"
                                            onClick={() => setView('login')}
                                            className="text-sm text-content-secondary hover:text-white transition-colors"
                                        >
                                            Already have an account? <span className="font-semibold text-bf-gold">Sign in</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setView('forgot-password')}
                                            className="text-xs text-content-tertiary hover:text-bf-gold transition-colors"
                                        >
                                            Forgot password?
                                        </button>
                                    </div>
                                </form>
                            )}

                            {view === 'login' && (
                                <form onSubmit={handleLogin} className="mt-6 space-y-3">
                                    <Input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="Email"
                                        required
                                        className="h-11 rounded-xl border-[rgba(216,184,120,0.14)] bg-bf-input text-bf-cream placeholder:text-bf-muted"
                                    />
                                    <div className="relative">
                                        <Input
                                            type={showPassword ? 'text' : 'password'}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder="Password"
                                            required
                                            className="h-11 rounded-xl border-[rgba(216,184,120,0.14)] bg-bf-input pr-11 text-bf-cream placeholder:text-bf-muted"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword((v) => !v)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-content-secondary hover:text-gray-100 transition-colors"
                                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                                            tabIndex={-1}
                                        >
                                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setView('forgot-password')}
                                        className="text-xs text-content-tertiary hover:text-bf-gold transition-colors"
                                    >
                                        Forgot password?
                                    </button>
                                    <Button type="submit" className="h-11 w-full border-none bg-gradient-to-b from-[#e9cd8d] to-[#cba85f] text-[#221703] font-semibold shadow-[0_12px_26px_-8px_rgba(216,184,120,0.5)] hover:brightness-[1.03]" isLoading={isLoading}>
                                        Sign in
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        className="h-11 w-full border-none bg-white text-gray-700 hover:bg-gray-200"
                                        onClick={handleGoogleLogin}
                                    >
                                        <Globe size={16} className="mr-2" />
                                        Continue with Google
                                    </Button>
                                    <button
                                        type="button"
                                        onClick={() => setView('setup')}
                                        className="w-full text-sm text-content-secondary hover:text-white transition-colors"
                                    >
                                        Don&apos;t have an account? <span className="font-semibold text-bf-gold">Register</span>
                                    </button>
                                </form>
                            )}

                            {view === 'forgot-password' && (
                                <form onSubmit={handleForgotPassword} className="mt-6 space-y-3">
                                    <Input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="Email"
                                        required
                                        className="h-11 rounded-xl border-[rgba(216,184,120,0.14)] bg-bf-input text-bf-cream placeholder:text-bf-muted"
                                    />
                                    <Button type="submit" className="h-11 w-full border-none bg-gradient-to-b from-[#e9cd8d] to-[#cba85f] text-[#221703] font-semibold shadow-[0_12px_26px_-8px_rgba(216,184,120,0.5)] hover:brightness-[1.03]" isLoading={isLoading}>
                                        <Mail size={16} className="mr-2" />
                                        Send reset link
                                    </Button>
                                    <button
                                        type="button"
                                        onClick={() => setView('login')}
                                        className="w-full flex items-center justify-center gap-2 text-sm text-content-secondary hover:text-white transition-colors"
                                    >
                                        <ArrowLeft size={16} />
                                        Back to login
                                    </button>
                                </form>
                            )}

                            {error && (() => {
                                const lower = String(error).toLowerCase();
                                const isRateLimited =
                                    lower.includes('too many') ||
                                    lower.includes('rate limit') ||
                                    lower.includes('429');
                                // Approval gate gets a distinct, louder banner —
                                // a generic warning blends in with "wrong password"
                                // and users miss the actual action required (request
                                // access from the landing page first).
                                const isApprovalBlocked =
                                    lower.includes("hasn't been approved") ||
                                    lower.includes('not approved');
                                if (isApprovalBlocked) {
                                    return (
                                        <div className="mt-4 rounded-xl border-2 border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm">
                                            <div className="flex items-start gap-3">
                                                <div className="w-8 h-8 rounded-full bg-white/[0.04] flex items-center justify-center flex-shrink-0 mt-0.5">
                                                    <span className="text-content-secondary font-bold text-lg leading-none">!</span>
                                                </div>
                                                <div className="text-left">
                                                    <div className="text-content-secondary font-semibold text-sm mb-1">
                                                        Account not approved yet
                                                    </div>
                                                    <div className="text-content-secondary text-[13px] leading-relaxed mb-3">
                                                        {error}
                                                    </div>
                                                    <a
                                                        href="/#request-access"
                                                        className="inline-flex items-center gap-1.5 text-content-secondary hover:text-content-secondary text-[13px] font-medium underline underline-offset-2"
                                                    >
                                                        Go to request access form →
                                                    </a>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }
                                const message = isRateLimited
                                    ? 'Too many attempts in a short window. Please wait a minute and try again.'
                                    : error;
                                return (
                                    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-content-secondary text-center backdrop-blur-sm">
                                        {message}
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            </div>
            </div>
        </div>
    );
}
