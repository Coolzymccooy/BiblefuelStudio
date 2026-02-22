import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import toast from 'react-hot-toast';
import { Sparkles, Play, Archive, Mail, ArrowLeft, Globe, Mic, Film, Video, HelpCircle, Cpu, List, Zap, ShieldCheck, CirclePlus, Search, BarChart3, Heart, MessageCircle } from 'lucide-react';
import { api } from '../lib/api';
import { firebaseRequestPasswordReset, getFirebaseAuthErrorMessage, isFirebaseClientEnabled } from '../lib/firebase';

export function HomePage() {
    const {
        token,
        hasUser,
        firebaseEnabled,
        isLoading,
        error: authError,
        checkStatus,
        setup,
        login,
        signupWithFirebaseEmail,
        loginWithFirebaseEmail,
        loginWithFirebaseGoogle,
    } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [setupKey, setSetupKey] = useState('');
    const [view, setView] = useState<'login' | 'setup' | 'forgot-password'>('login');
    const [localError, setLocalError] = useState<string | null>(null);
    const useFirebaseAuth = firebaseEnabled && isFirebaseClientEnabled();

    useEffect(() => {
        checkStatus();
    }, [checkStatus]);

    // Reset view based on hasUser status if we are in default state
    useEffect(() => {
        if (useFirebaseAuth) return;
        if (!hasUser && view === 'login') setView('setup');
        if (hasUser && view === 'setup') setView('login');
    }, [hasUser, useFirebaseAuth, view]);

    const handleSetup = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError(null);
        const success = useFirebaseAuth
            ? await signupWithFirebaseEmail(email, password)
            : await setup(email, password, setupKey);
        if (success) toast.success('Account created successfully!');
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
                    <p className="text-gray-400 text-base sm:text-lg max-w-2xl">
                        Your AI-powered content creation studio.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card title="Quick Start & Workflow">
                        <div className="space-y-4">
                            <p className="text-sm text-gray-400">Follow this order to build your content:</p>
                            <ol className="space-y-3 text-gray-300">
                                {[
                                    { step: 1, text: "Generate scripts", area: "Scripts", icon: Sparkles },
                                    { step: 2, text: "Add to Queue & Export", area: "Queue", icon: Archive },
                                    { step: 3, text: "Get Backgrounds", area: "Pexels", icon: Play },
                                    { step: 4, text: "Generate Voice", area: "Voice & Audio", icon: Mic },
                                    { step: 5, text: "Edit Timeline", area: "Timeline", icon: Film },
                                    { step: 6, text: "Render Video", area: "Render", icon: Video },
                                    { step: 7, text: "Share to Socials", area: "Share", icon: Globe },
                                ].map((item) => (
                                    <li key={item.step} className="flex gap-4 items-start p-2 rounded-lg hover:bg-white/5 transition-colors group">
                                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary-500/10 text-primary-400 font-bold text-xs ring-1 ring-primary-500/20 group-hover:bg-primary-500/20 group-hover:ring-primary-500/40 transition-all">
                                            {item.step}
                                        </span>
                                        <span className="text-sm">
                                            {item.text.replace(item.area, '')}
                                            <strong className="text-primary-300 font-medium border-b border-primary-500/10 pb-0.5">{item.area}</strong>
                                            {item.text.split(item.area)[1] || ''}
                                        </span>
                                    </li>
                                ))}
                            </ol>
                            <Link to="/help" className="block w-full">
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
                                <p className="text-xs text-gray-400">
                                    Queue multiple videos and render them all at once in the background. Check the <strong className="text-gray-300">Jobs</strong> tab for status.
                                </p>
                            </div>
                            <div className="p-3 bg-indigo-500/5 rounded-xl border border-indigo-500/10">
                                <h4 className="text-sm font-bold text-indigo-400 flex items-center gap-2 mb-1">
                                    <List size={14} /> Global Queue
                                </h4>
                                <p className="text-xs text-gray-400">
                                    Your Queue is central. Add scripts once, then pull them into any other tool (Timeline, Backgrounds) instantly.
                                </p>
                            </div>
                            <div className="p-3 bg-emerald-500/5 rounded-xl border border-emerald-500/10">
                                <h4 className="text-sm font-bold text-emerald-400 flex items-center gap-2 mb-1">
                                    <Zap size={14} /> One-Click Workflow
                                </h4>
                                <p className="text-xs text-gray-400">
                                    Use the "Apply to Timeline" buttons to skip the manual file picking. We track everything for you.
                                </p>
                            </div>
                        </div>
                    </Card>
                </div>

                <Card className="mt-6 border-t font-mono text-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-gray-400">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                            <span>System Authenticated</span>
                        </div>
                        <span className="text-gray-600">v3.0.0</span>
                    </div>
                </Card>
            </div>
        );
    }

    // Auth Views
    return (
        <div className="relative min-h-screen overflow-hidden bg-[#070b14] px-2 py-2 sm:px-5 sm:py-5 animate-fade-in">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(128,145,176,0.2),transparent_48%),radial-gradient(circle_at_15%_85%,rgba(45,60,96,0.3),transparent_46%),radial-gradient(circle_at_85%_83%,rgba(27,43,70,0.28),transparent_42%)]" />

            <div className="relative mx-auto flex min-h-[calc(100vh-1rem)] w-full max-w-[1640px] items-center justify-center overflow-hidden rounded-[2.1rem] border border-[#e1e8f3]/25 bg-[linear-gradient(155deg,#cdd4df_0%,#bcc7d7_45%,#b3c0d3_100%)] shadow-[0_45px_130px_rgba(0,0,0,0.5)]">
                <div className="pointer-events-none absolute -left-24 -top-24 h-[340px] w-[340px] rounded-full bg-white/35 blur-[110px]" />
                <div className="pointer-events-none absolute right-[-110px] top-[20%] h-[380px] w-[380px] rounded-full bg-sky-200/20 blur-[130px]" />
                <div className="pointer-events-none absolute left-1/2 top-[56%] h-[360px] w-[780px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(139,151,172,0.42)_0%,rgba(130,143,165,0.16)_48%,rgba(130,143,165,0)_78%)] blur-[32px]" />

                <div className="relative z-10 flex w-full max-w-[1160px] flex-col items-center justify-center gap-8 px-4 py-8 md:flex-row md:gap-14 md:px-8 md:py-12">
                    <div className="order-2 w-full max-w-[368px] md:order-1 md:[transform:perspective(1650px)_rotateY(16deg)_rotateZ(-8deg)]">
                        <div className="flex h-[640px] w-full flex-col rounded-[2rem] border border-white/10 bg-[#10131d] p-5 shadow-[0_34px_110px_rgba(0,0,0,0.62)]">
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    { icon: Heart, className: 'text-pink-400' },
                                    { icon: CirclePlus, className: 'text-indigo-300' },
                                    { icon: Sparkles, className: 'text-amber-300' },
                                    { icon: MessageCircle, className: 'text-sky-300' },
                                    { icon: BarChart3, className: 'text-rose-400' },
                                    { icon: Search, className: 'text-violet-300' },
                                ].map((item, idx) => (
                                    <div key={idx} className="group relative flex h-[88px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#0c1019]">
                                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_18%,rgba(106,117,255,0.45),rgba(12,16,25,0.96)_62%)] opacity-95 transition-opacity duration-300 group-hover:opacity-100" />
                                        <item.icon size={30} className={`relative z-10 ${item.className}`} />
                                    </div>
                                ))}
                            </div>

                            <div className="mt-auto px-1 pb-2 text-center">
                                <h2 className="text-[60px] leading-none text-white drop-shadow-[0_10px_26px_rgba(0,0,0,0.55)]" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                                    Biblefuel
                                </h2>
                                <p className="mx-auto mt-4 max-w-[270px] text-sm leading-5 text-gray-400">
                                    Create faith-driven content, render, and publish in one flow.
                                </p>
                                <Button
                                    className="mt-7 h-12 w-full border-none bg-[#3f6dff] text-white shadow-[0_16px_34px_rgba(44,94,255,0.35)] hover:bg-[#4a75ff]"
                                    onClick={() => setView(view === 'login' ? 'setup' : 'login')}
                                >
                                    {view === 'login' ? 'Create account' : 'Back to login'}
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="order-1 w-full max-w-[390px] md:order-2 md:[transform:perspective(1650px)_rotateY(-14deg)_rotateZ(6deg)]">
                        <div className="flex min-h-[640px] w-full flex-col rounded-[2rem] border border-white/10 bg-[#10131d] p-5 shadow-[0_34px_110px_rgba(0,0,0,0.64)] sm:p-6">
                            <div className="mb-5 flex items-center gap-3">
                                <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/12 p-2.5">
                                    <ShieldCheck className="text-indigo-300" size={18} />
                                </div>
                                <div className="rounded-2xl border border-blue-500/30 bg-blue-500/12 p-2.5">
                                    <Globe className="text-blue-300" size={18} />
                                </div>
                            </div>

                            <h1 className="text-[52px] leading-[0.95] text-white font-black tracking-[-0.03em]">
                                {view === 'forgot-password' ? 'Reset access' : view === 'setup' ? 'Create account' : "Let's sign you in"}
                            </h1>
                            <p className="mt-2 text-sm text-gray-400">
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
                                    <Input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Password"
                                        required
                                        minLength={8}
                                        className="h-11 rounded-xl border-white/10 bg-[#1a1f2d] text-gray-100 placeholder:text-gray-500"
                                    />
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
                                    <button
                                        type="button"
                                        onClick={() => setView('login')}
                                        className="w-full text-sm text-gray-400 hover:text-white transition-colors"
                                    >
                                        Already have an account? <span className="font-semibold text-blue-300">Sign in</span>
                                    </button>
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
                                    <Input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Password"
                                        required
                                        className="h-11 rounded-xl border-white/10 bg-[#1a1f2d] text-gray-100 placeholder:text-gray-500"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setView('forgot-password')}
                                        className="text-xs text-gray-400 hover:text-blue-300 transition-colors"
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
                                        className="w-full text-sm text-gray-400 hover:text-white transition-colors"
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
                                        className="w-full flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
                                    >
                                        <ArrowLeft size={16} />
                                        Back to login
                                    </button>
                                </form>
                            )}

                            {error && (
                                <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200 text-center">
                                    {error}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
