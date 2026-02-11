import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import toast from 'react-hot-toast';
import { Sparkles, Play, Archive, Mail, ArrowLeft, Globe, Mic, Film, Video, HelpCircle, Cpu, List, Zap } from 'lucide-react';
import { api } from '../lib/api';

export function HomePage() {
    const { token, hasUser, isLoading, error: authError, checkStatus, setup, login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [setupKey, setSetupKey] = useState('');
    const [view, setView] = useState<'login' | 'setup' | 'forgot-password'>('login');
    const [localError, setLocalError] = useState<string | null>(null);

    useEffect(() => {
        checkStatus();
    }, [checkStatus]);

    // Reset view based on hasUser status if we are in default state
    useEffect(() => {
        if (!hasUser && view === 'login') setView('setup');
        if (hasUser && view === 'setup') setView('login');
    }, [hasUser]);

    const handleSetup = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError(null);
        const success = await setup(email, password, setupKey);
        if (success) toast.success('Account created successfully!');
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError(null);
        const success = await login(email, password);
        if (success) toast.success('Login successful!');
    };

    const handleForgotPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError(null);
        try {
            const res = await api.post('/api/auth/forgot-password', { email });
            if (res.ok) {
                toast.success('Reset link sent to your email (simulated)');
                setView('login');
            } else {
                setLocalError(res.error || 'Failed to request reset');
            }
        } catch (err) {
            setLocalError('An unexpected error occurred');
        }
    };

    const handleGoogleLogin = () => {
        // Redirect to backend Google Auth route
        window.location.href = 'http://localhost:10000/api/auth/google';
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
        <div className="min-h-[80vh] flex flex-col items-center justify-center p-4 sm:p-6 animate-fade-in">
            <div className="lg:hidden w-full max-w-md text-center mb-8">
                <h2 className="text-3xl sm:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-400 to-indigo-400 font-display mb-2">
                    Biblefuel Studio
                </h2>
                <p className="text-gray-400 text-sm sm:text-base">Login to access your workspace</p>
            </div>

            <div className="w-full max-w-md space-y-6">
                {view === 'setup' && (
                    <Card title="One-Time Setup">
                        <form onSubmit={handleSetup} className="space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1.5 ml-1">Setup Key</label>
                                <Input
                                    type="password"
                                    value={setupKey}
                                    onChange={(e) => setSetupKey(e.target.value)}
                                    placeholder="Enter ADMIN_SETUP_KEY from .env"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1.5 ml-1">Email</label>
                                <Input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="admin@example.com"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1.5 ml-1">Password</label>
                                <Input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Min 8 characters"
                                    required
                                    minLength={8}
                                />
                            </div>
                            <Button type="submit" className="w-full" isLoading={isLoading}>
                                Create Account
                            </Button>
                        </form>
                    </Card>
                )}

                {view === 'login' && (
                    <Card title="Welcome Back">
                        <form onSubmit={handleLogin} className="space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1.5 ml-1">Email</label>
                                <Input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="admin@example.com"
                                    required
                                />
                            </div>
                            <div>
                                <div className="flex justify-between items-center mb-1.5 ml-1">
                                    <label className="block text-sm font-medium text-gray-400">Password</label>
                                    <button
                                        type="button"
                                        onClick={() => setView('forgot-password')}
                                        className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                                    >
                                        Forgot Password?
                                    </button>
                                </div>
                                <Input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Enter password"
                                    required
                                />
                            </div>
                            <Button type="submit" className="w-full" isLoading={isLoading}>
                                Login
                            </Button>

                            <div className="relative my-6">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t border-white/10" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-dark-900 px-2 text-gray-500">Or continue with</span>
                                </div>
                            </div>

                            <Button
                                type="button"
                                variant="secondary"
                                className="w-full bg-white text-black hover:bg-gray-200 border-none"
                                onClick={handleGoogleLogin}
                            >
                                <Globe size={18} className="mr-2" />
                                Google
                            </Button>
                        </form>
                    </Card>
                )}

                {view === 'forgot-password' && (
                    <Card title="Reset Password">
                        <form onSubmit={handleForgotPassword} className="space-y-5">
                            <p className="text-sm text-gray-400">
                                Enter your email address and we'll send you a link to reset your password.
                            </p>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1.5 ml-1">Email</label>
                                <Input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="admin@example.com"
                                    required
                                />
                            </div>
                            <Button type="submit" className="w-full" isLoading={isLoading}>
                                <Mail size={16} className="mr-2" />
                                Send Reset Link
                            </Button>

                            <button
                                type="button"
                                onClick={() => setView('login')}
                                className="w-full flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
                            >
                                <ArrowLeft size={16} />
                                Back to Login
                            </button>
                        </form>
                    </Card>
                )}

                {error && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-200 rounded-xl text-sm text-center animate-in slide-in-from-top-2">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}
