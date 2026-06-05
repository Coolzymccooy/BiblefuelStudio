import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import toast from 'react-hot-toast';
import { Sparkles, Play, Archive, Mail, ArrowLeft, Globe, Mic, Film, Video, HelpCircle, Cpu, List, Zap, ShieldCheck, Rocket, Briefcase, Wand2, Eye, EyeOff } from 'lucide-react';
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
        <div className="flex-1 min-w-[120px] p-3 rounded-xl bg-white/[0.03] border border-white/10">
            <div className={`text-2xl font-bold ${accent || 'text-white'}`}>{loading ? '…' : value}</div>
            <div className="text-caption tracking-wider mt-1">{label}</div>
        </div>
    );

    return (
        <Card title="Today" className="border-white/10">
            <div className="flex flex-wrap gap-3">
                <Stat value={stats.campaignsToday} label="Campaigns today" accent="text-amber-300" />
                <Stat value={stats.campaignsSuccessToday} label="Published ✓" accent="text-emerald-300" />
                <Stat value={stats.campaignsFailedToday} label="Failed" accent={stats.campaignsFailedToday > 0 ? 'text-rose-300' : 'text-content-secondary'} />
                <Stat value={stats.rendersThisWeek} label="Renders (7d)" />
                <Stat value={stats.totalJobs} label="All-time jobs" />
            </div>
            <div className="mt-3 flex justify-end">
                <button onClick={() => navigate('/app/jobs')} className="text-[10px] uppercase tracking-widest text-primary-300 hover:text-primary-200">
                    View all jobs →
                </button>
            </div>
        </Card>
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

    return (
        <Card className={renderOnly
            ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-primary-500/5 to-transparent'
            : 'border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-primary-500/5 to-transparent'}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-1">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={renderOnly
                        ? 'rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 flex-shrink-0'
                        : 'rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 flex-shrink-0'}>
                        <Rocket size={22} className={renderOnly ? 'text-emerald-300' : 'text-amber-300'} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-lg font-bold text-white">
                            {renderOnly ? 'Generate a fresh video' : 'Auto-Publish a fresh post'}
                        </h3>
                        <p className="text-help mt-1">
                            {renderOnly
                                ? 'One click chains: script → background → voice → render. Your video will be ready to download or share manually.'
                                : <>One click chains: <span className="text-amber-200">script</span> → background → voice → render → Make webhook → TikTok / YouTube.</>}
                            {' '}Requires at least one background in your Library.
                        </p>
                        {/* Render-only banner. Surfaces the same information
                            we wrote into the job's share.skipped reason — but
                            BEFORE the user even clicks the button, so they
                            don't waste 2 minutes wondering why their video
                            didn't post. */}
                        {renderOnly && (
                            <div className="mt-3 text-[12px] flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-400/30 bg-amber-500/[0.08] text-amber-100">
                                <span aria-hidden className="shrink-0">⚠️</span>
                                <div className="flex-1">
                                    <strong className="font-semibold text-amber-200">Render-only mode.</strong>{' '}
                                    Your video will be generated but won't auto-post — you have no destination connected yet.{' '}
                                    <Link to="/app/settings" className="underline decoration-amber-300/60 hover:text-amber-50">Set up Auto-Publish →</Link>
                                </div>
                            </div>
                        )}
                        <div className="mt-2 text-[11px] flex flex-wrap items-center gap-2">
                            {voiceDefaults.enabled ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-200">
                                    <Wand2 size={11} /> Voice Synthesis: {voiceDefaults.category}
                                    {voiceDefaults.cinematicMode ? ' · cinematic' : ''}
                                </span>
                            ) : (
                                <Link to="/app/settings" className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-content-secondary hover:text-gray-200">
                                    <Wand2 size={11} /> Voice Synthesis off · enable in Settings
                                </Link>
                            )}
                            {/* Always present — auto-publish now ships kinetic
                                captions by default, with Whisper alignment as
                                fallback. Tells the user what they're getting. */}
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary-500/15 border border-primary-500/30 text-primary-200">
                                <Sparkles size={11} /> Kinetic captions on
                            </span>
                            {/* Show which destinations are live (super-admin
                                with env Zernio sees "TikTok via Zernio" so
                                they can confirm at a glance things are wired). */}
                            {status?.destinations?.map((d) => (
                                <span key={d} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-200">
                                    ✓ {d === 'zernio' ? 'TikTok (Zernio)' : d === 'webhook' ? 'Webhook' : d}
                                </span>
                            ))}
                        </div>
                        {recentJobId && (
                            <p className="text-[11px] font-mono text-emerald-300 mt-2">
                                Last job: {recentJobId} — watch the bell, or check Jobs.
                            </p>
                        )}
                    </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
                    <Button
                        className={renderOnly
                            ? 'h-11 px-6 bg-emerald-500 hover:bg-emerald-400 text-black font-bold border-emerald-500/40'
                            : 'h-11 px-6 bg-amber-500 hover:bg-amber-400 text-black font-bold border-amber-500/40'}
                        onClick={handleAutoPublish}
                        isLoading={isLaunching}
                    >
                        <Rocket size={16} className="mr-2" />
                        {renderOnly ? 'Generate Video' : 'Auto-Publish Now'}
                    </Button>
                    <Button
                        variant="secondary"
                        className="h-11 px-4 bg-white/5 border-white/10"
                        onClick={() => navigate('/app/jobs')}
                    >
                        <Briefcase size={14} className="mr-2" />
                        Jobs
                    </Button>
                </div>
            </div>
        </Card>
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
        return (
            <div className="space-y-8 animate-fade-in">
                <div className="relative">
                    <div className="absolute -top-10 -left-10 w-32 h-32 bg-primary-500/20 rounded-full blur-3xl pointer-events-none"></div>
                    <h2 className="text-3xl sm:text-4xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-white to-primary-200 leading-tight">
                        Welcome to Biblefuel
                    </h2>
                    <p className="text-content-secondary text-base sm:text-lg max-w-2xl">
                        Your AI-powered content creation studio.
                    </p>
                </div>

                <AutoPublishCard />

                <DailyStatsCard />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card title="Quick Start & Workflow">
                        <div className="space-y-4">
                            <p className="text-help">Follow this order to build your content:</p>
                            <ol className="space-y-2 text-gray-300">
                                {[
                                    { step: 1, text: "Generate scripts", area: "Scripts", to: "/app/scripts", icon: Sparkles },
                                    { step: 2, text: "Add to queue & export", area: "Queue", to: "/app/queue", icon: Archive },
                                    { step: 3, text: "Get backgrounds", area: "Backgrounds", to: "/app/backgrounds", icon: Play },
                                    { step: 4, text: "Generate voice", area: "Voice & Audio", to: "/app/voice-audio", icon: Mic },
                                    { step: 5, text: "Edit timeline", area: "Timeline", to: "/app/timeline", icon: Film },
                                    { step: 6, text: "Render video", area: "Render", to: "/app/render", icon: Video },
                                    { step: 7, text: "Share to socials", area: "Share", to: "/app/render#share-kit", icon: Globe },
                                ].map((item) => (
                                    <li key={item.step} className="flex gap-3 items-center p-2 rounded-lg hover:bg-white/[0.04] transition-colors group">
                                        <span className="flex items-center justify-center w-6 h-6 shrink-0 rounded-full bg-primary-500/10 text-primary-400 font-semibold text-[0.75rem] ring-1 ring-primary-500/20 group-hover:bg-primary-500/20 group-hover:ring-primary-500/40 transition-all tabular-nums">
                                            {item.step}
                                        </span>
                                        <span className="flex-1 min-w-0 text-[0.875rem] text-gray-200 truncate">
                                            {item.text}
                                        </span>
                                        <Link
                                            to={item.to}
                                            className="shrink-0 text-[0.6875rem] font-medium text-primary-300/90 hover:text-primary-200 bg-primary-500/[0.08] hover:bg-primary-500/[0.16] border border-primary-500/15 hover:border-primary-500/30 rounded-full px-2 py-0.5 transition-colors"
                                        >
                                            {item.area}
                                        </Link>
                                    </li>
                                ))}
                            </ol>
                            <Link to="/app/help" className="block w-full">
                                <Button
                                    variant="secondary"
                                    className="w-full mt-4 text-xs h-9 justify-center bg-white/5 border-white/10"
                                >
                                    <HelpCircle size={14} className="mr-2" />
                                    View Full Automation Guide
                                </Button>
                            </Link>
                        </div>
                    </Card>

                    <Card title="Automation Tips">
                        <div className="space-y-4">
                            <div className="p-3 bg-primary-500/5 rounded-xl border border-primary-500/10">
                                <h4 className="text-sm font-bold text-primary-400 flex items-center gap-2 mb-1">
                                    <Cpu size={14} /> Batch Rendering
                                </h4>
                                <p className="text-help">
                                    Queue multiple videos and render them all at once in the background. Check the <strong className="text-gray-300">Jobs</strong> tab for status.
                                </p>
                            </div>
                            <div className="p-3 bg-indigo-500/5 rounded-xl border border-indigo-500/10">
                                <h4 className="text-sm font-bold text-indigo-400 flex items-center gap-2 mb-1">
                                    <List size={14} /> Global Queue
                                </h4>
                                <p className="text-help">
                                    Your Queue is central. Add scripts once, then pull them into any other tool (Timeline, Backgrounds) instantly.
                                </p>
                            </div>
                            <div className="p-3 bg-emerald-500/5 rounded-xl border border-emerald-500/10">
                                <h4 className="text-sm font-bold text-emerald-400 flex items-center gap-2 mb-1">
                                    <Zap size={14} /> One-Click Workflow
                                </h4>
                                <p className="text-help">
                                    Use the "Apply to Timeline" buttons to skip the manual file picking. We track everything for you.
                                </p>
                            </div>
                        </div>
                    </Card>
                </div>

                <Card className="mt-6 border-t font-mono text-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-content-secondary">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                            <span>System Authenticated</span>
                        </div>
                        <span className="text-content-tertiary">v3.0.0</span>
                    </div>
                </Card>
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

                            <h1 className="text-[52px] leading-[0.95] text-white font-black tracking-[-0.03em]">
                                {view === 'forgot-password' ? 'Reset access' : view === 'setup' ? 'Create account' : "Let's sign you in"}
                            </h1>
                            <p className="mt-2 text-help">
                                {view === 'forgot-password'
                                    ? 'Enter your email and continue.'
                                    : view === 'setup'
                                        ? 'Build your studio account in seconds.'
                                        : 'Welcome back. Your studio is ready.'}
                            </p>

                            {firebaseEnabled && !useFirebaseAuth && (
                                <div className="mt-4 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-200">
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
                                            className="h-11 rounded-xl border-white/10 bg-[#1a1f2d] text-gray-100 placeholder:text-gray-500"
                                        />
                                    )}
                                    <Input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="Email"
                                        required
                                        className="h-11 rounded-xl border-white/10 bg-[#1a1f2d] text-gray-100 placeholder:text-gray-500"
                                    />
                                    <div className="relative">
                                        <Input
                                            type={showPassword ? 'text' : 'password'}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder="Password"
                                            required
                                            minLength={8}
                                            className="h-11 rounded-xl border-white/10 bg-[#1a1f2d] pr-11 text-gray-100 placeholder:text-gray-500"
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
                                            className="h-11 rounded-xl border-white/10 bg-[#1a1f2d] pr-11 text-gray-100 placeholder:text-gray-500"
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
                                    <Button type="submit" className="mt-1 h-11 w-full border-none bg-[#3f6dff] text-white shadow-[0_10px_22px_rgba(44,94,255,0.3)] hover:bg-[#4a75ff]" isLoading={isLoading}>
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
                                            Already have an account? <span className="font-semibold text-blue-300">Sign in</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setView('forgot-password')}
                                            className="text-xs text-content-tertiary hover:text-blue-300 transition-colors"
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
                                        className="h-11 rounded-xl border-white/10 bg-[#1a1f2d] text-gray-100 placeholder:text-gray-500"
                                    />
                                    <div className="relative">
                                        <Input
                                            type={showPassword ? 'text' : 'password'}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder="Password"
                                            required
                                            className="h-11 rounded-xl border-white/10 bg-[#1a1f2d] pr-11 text-gray-100 placeholder:text-gray-500"
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
                                        className="text-xs text-content-tertiary hover:text-blue-300 transition-colors"
                                    >
                                        Forgot password?
                                    </button>
                                    <Button type="submit" className="h-11 w-full border-none bg-[#3f6dff] text-white shadow-[0_10px_22px_rgba(44,94,255,0.3)] hover:bg-[#4a75ff]" isLoading={isLoading}>
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
                                        Don&apos;t have an account? <span className="font-semibold text-blue-300">Register</span>
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
                                        className="h-11 rounded-xl border-white/10 bg-[#1a1f2d] text-gray-100 placeholder:text-gray-500"
                                    />
                                    <Button type="submit" className="h-11 w-full border-none bg-[#3f6dff] text-white shadow-[0_10px_22px_rgba(44,94,255,0.3)] hover:bg-[#4a75ff]" isLoading={isLoading}>
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
                                        <div className="mt-4 rounded-xl border-2 border-amber-400/60 bg-amber-400/[0.15] p-4 backdrop-blur-sm">
                                            <div className="flex items-start gap-3">
                                                <div className="w-8 h-8 rounded-full bg-amber-400/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                    <span className="text-amber-100 font-bold text-lg leading-none">!</span>
                                                </div>
                                                <div className="text-left">
                                                    <div className="text-amber-100 font-semibold text-sm mb-1">
                                                        Account not approved yet
                                                    </div>
                                                    <div className="text-amber-100/90 text-[13px] leading-relaxed mb-3">
                                                        {error}
                                                    </div>
                                                    <a
                                                        href="/#request-access"
                                                        className="inline-flex items-center gap-1.5 text-amber-200 hover:text-amber-100 text-[13px] font-medium underline underline-offset-2"
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
                                    <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/[0.07] p-3 text-sm text-amber-100 text-center backdrop-blur-sm">
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
