import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { pageWidthClass } from '../lib/pageWidth';
import { CompletionBanner } from './CompletionBanner';
import {
    Menu, X, FileText, List, Briefcase, Image, Mic, Film, Video, Package, LogOut, LogIn,
    Settings, HelpCircle, Wand2, BookOpen, Home, ShieldCheck, Clapperboard, Sparkles, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/Button';
import { AUTH_INVALID_EVENT } from '../lib/api';
import { NotificationsBell } from './NotificationsBell';
import { VerifyEmailGate } from './VerifyEmailGate';
import { ReportIssueWidget } from './ReportIssueWidget';

// Full page list for the desktop sidebar + mobile drawer. `superOnly` items are
// hidden for non-super-admins (the server still enforces the gate).
const navItems = [
    { path: '/app', label: 'Home', icon: Home },
    { path: '/app/create', label: 'Create', icon: Sparkles },
    { path: '/app/wizard', label: 'Wizard', icon: Wand2 },
    { path: '/app/scripts', label: 'Scripts', icon: FileText },
    { path: '/app/story', label: 'Story Video', icon: Clapperboard },
    { path: '/app/series', label: 'Series', icon: BookOpen },
    { path: '/app/studio', label: 'Studio', icon: Video },
    { path: '/app/voice-audio', label: 'Voice & Audio', icon: Mic },
    { path: '/app/timeline', label: 'Timeline', icon: Film },
    { path: '/app/backgrounds', label: 'Backgrounds', icon: Image },
    { path: '/app/render', label: 'Render', icon: Video },
    { path: '/app/queue', label: 'Queue', icon: List },
    { path: '/app/jobs', label: 'Jobs', icon: Briefcase },
    { path: '/app/gumroad', label: 'Gumroad', icon: Package, superOnly: true },
];

// Which bottom tab lights up for a given route. Create/Studio are hubs whose
// tools also activate their tab so the user always knows where they are.
const createGroup = ['/app/create', '/app/wizard', '/app/scripts', '/app/story', '/app/series'];
const studioGroup = ['/app/studio', '/app/voice-audio', '/app/timeline', '/app/backgrounds', '/app/render', '/app/queue'];

export function Layout() {
    const [drawerOpen, setDrawerOpen] = useState(false);
    const { token, emailVerified, isSuperAdmin, isLoading, error: authError, logout, checkStatus } = useAuth();
    // A validation failure that is NOT a rejection: the app stays usable.
    const sessionCheckFailed = Boolean(authError) && !/expired|login again/i.test(String(authError));
    const location = useLocation();
    const navigate = useNavigate();
    const [loadingExpired, setLoadingExpired] = useState(false);
    // Give validation a few seconds, then show the app anyway. A stalled
    // check must never cost the operator their navigation.
    useEffect(() => {
        if (!isLoading) { setLoadingExpired(false); return; }
        const t = window.setTimeout(() => setLoadingExpired(true), 4000);
        return () => window.clearTimeout(t);
    }, [isLoading]);

    useEffect(() => {
        const t = setTimeout(() => setLoadingExpired(true), 2500);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => { checkStatus(); }, [checkStatus]);

    useEffect(() => {
        const onAuthInvalid = () => {
            logout();
            if (location.pathname.startsWith('/app') && location.pathname !== '/app') {
                navigate('/app', { replace: true });
            }
        };
        window.addEventListener(AUTH_INVALID_EVENT, onAuthInvalid as EventListener);
        return () => window.removeEventListener(AUTH_INVALID_EVENT, onAuthInvalid as EventListener);
    }, [logout, navigate, location.pathname]);

    // Auth fence for the studio: unauthed visitors on any /app/* sub-route get
    // bounced back to the /app sign-in screen.
    useEffect(() => {
        if (!token && location.pathname.startsWith('/app') && location.pathname !== '/app') {
            navigate('/app', { replace: true });
        }
    }, [token, location.pathname, navigate]);

    // Close the drawer + reset scroll on navigation.
    useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

    useEffect(() => {
        const prev = document.body.style.overflow;
        if (drawerOpen) document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [drawerOpen]);

    const isActive = (path: string) => location.pathname === path;
    const inGroup = (group: string[]) => group.includes(location.pathname);
    const isStandaloneAuth = !token && location.pathname === '/app';

    if (isStandaloneAuth) {
        return (
            <main className="min-h-screen relative">
                <div className="relative z-10"><Outlet /></div>
            </main>
        );
    }

    if (token && isLoading && !loadingExpired) {
        return (
            <div className="min-h-screen bg-bf-bg flex flex-col items-center justify-center gap-4 px-6 text-center">
                <div className="h-7 w-7 rounded-full border-2 border-bf-gold/30 border-t-bf-gold animate-spin" />
                <p className="text-sm text-content-secondary">Checking your session…</p>
                <button
                    type="button"
                    onClick={() => setLoadingExpired(true)}
                    className="text-sm font-semibold text-bf-gold underline-offset-4 hover:underline"
                >
                    Continue anyway
                </button>
            </div>
        );
    }

    // Only gate on a verification we actually CONFIRMED. If the check could
    // not reach the API (restart, flaky phone connection), showing this gate
    // takes away the nav, the drawer and the editor for no reason.
    if (token && !emailVerified && !sessionCheckFailed) {
        return <VerifyEmailGate />;
    }

    const visibleNav = navItems.filter((item) => !item.superOnly || isSuperAdmin);

    const bottomTabs = [
        { label: 'Home', icon: Home, to: '/app', active: isActive('/app') },
        { label: 'Create', icon: Sparkles, to: '/app/create', active: inGroup(createGroup) },
        { label: 'Studio', icon: Clapperboard, to: '/app/studio', active: inGroup(studioGroup) },
        { label: 'Jobs', icon: Briefcase, to: '/app/jobs', active: isActive('/app/jobs') },
        { label: 'Menu', icon: Menu, onClick: () => setDrawerOpen(true), active: drawerOpen },
    ];

    return (
        <div className="min-h-screen flex flex-col lg:flex-row font-sans text-bf-cream">
            {/* ── Desktop sidebar (warm, inherits the new tokens) ── */}
            <aside className="hidden lg:flex fixed top-0 left-0 z-40 w-64 h-screen lg:static bg-bf-bg2/80 backdrop-blur-xl border-r border-[rgba(216,184,120,0.10)] flex-col">
                <div className="p-6">
                    <Link to="/" className="block font-displaySerif text-2xl font-semibold text-bf-cream hover:opacity-90 transition-opacity" title="Back to landing page">
                        Biblefuel<span className="font-normal italic text-bf-goldDeep"> Studio</span>
                    </Link>
                </div>
                <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto custom-scrollbar">
                    {visibleNav.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.path);
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`relative flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all group ${active
                                    ? 'bg-[rgba(230,201,138,0.08)] text-bf-gold font-semibold border border-[rgba(230,201,138,0.22)]'
                                    : 'text-bf-cream/[.88] hover:bg-white/[0.04] hover:text-bf-cream border border-transparent'}`}
                            >
                                {/* One signal for "you are here": a gold bar on the left. */}
                                {active && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-bf-gold" />}
                                <Icon size={19} className={active ? 'text-bf-gold' : 'text-bf-sub group-hover:text-bf-cream'} />
                                <span className="font-medium text-sm tracking-wide">{item.label}</span>
                            </Link>
                        );
                    })}
                    {isSuperAdmin && (
                        <Link to="/app/admin" className={`flex items-center gap-3 px-4 py-2.5 rounded-xl mt-2 border-t border-[rgba(216,184,120,0.08)] pt-4 transition-all ${isActive('/app/admin') ? 'text-bf-gold font-semibold' : 'text-bf-cream/[.88] hover:text-bf-cream'}`}>
                            <ShieldCheck size={19} className={isActive('/app/admin') ? 'text-bf-gold' : 'text-bf-sub'} />
                            <span className="font-medium text-sm tracking-wide">Admin</span>
                        </Link>
                    )}
                </nav>
                <div className="p-4 border-t border-[rgba(216,184,120,0.08)]">
                    <div className="flex items-center justify-between px-4 py-3 bg-bf-card rounded-xl border border-[rgba(216,184,120,0.12)]">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-bf-success animate-bfpulse" />
                            <span className="text-xs font-medium text-content-secondary">Online</span>
                        </div>
                        <button onClick={logout} className="text-content-secondary hover:text-bf-danger transition-colors p-1" title="Sign out"><LogOut size={18} /></button>
                    </div>
                    <div className="mt-4 flex justify-between text-xs text-content-tertiary px-2">
                        <span className="font-mono">v3.0.0</span>
                        <Link to="/app/settings" className="hover:text-bf-gold transition-colors flex items-center gap-1"><Settings size={12} /> Settings</Link>
                        <Link to="/app/help" className="hover:text-bf-gold transition-colors flex items-center gap-1"><HelpCircle size={12} /> Help</Link>
                    </div>
                </div>
            </aside>

            {/* ── Main content ── */}
            <main className="flex-1 lg:overflow-y-auto lg:h-screen relative scroll-smooth selection:bg-[rgba(216,184,120,0.25)]">
                {token && (
                    <div className="hidden lg:block absolute top-4 right-6 z-30"><NotificationsBell /></div>
                )}
                {/* key on pathname replays the bffade screen entrance on navigate */}
                <div
                    key={location.pathname}
                    // Width is per-screen: editing surfaces (timeline, studio) get
                    // near-full width on desktop, two-pane screens get a wider
                    // column, and reading/form screens stay narrow. See pageWidth.
                    className={`mx-auto w-full ${pageWidthClass(location.pathname)} px-[18px] pt-5 lg:pt-8 lg:px-8 pb-[calc(88px+env(safe-area-inset-bottom))] lg:pb-16 animate-bffade`}
                >
                    {/* Job outcomes announce themselves here rather than only
                        in the bell, so a finished or failed render is seen. */}
                    <CompletionBanner />
                    <Outlet />
                </div>
            </main>

            <ReportIssueWidget />

            {/* ── Mobile bottom tab bar ── */}
            <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-bf-bg/95 backdrop-blur-xl border-t border-[rgba(216,184,120,0.12)] pb-[env(safe-area-inset-bottom)]">
                <div className="flex items-stretch">
                    {bottomTabs.map((tab) => {
                        const Icon = tab.icon;
                        const inner = (
                            <div className="relative flex flex-col items-center gap-1 flex-1 pt-2.5 pb-2">
                                <span className={`absolute top-0 h-[3px] w-5 rounded-full transition-opacity ${tab.active ? 'bg-bf-gold opacity-100' : 'opacity-0'}`} />
                                <Icon size={21} className={tab.active ? 'text-bf-gold' : 'text-[#776e5b]'} strokeWidth={tab.active ? 2.2 : 1.9} />
                                <span className={`text-[10px] font-medium tracking-wide ${tab.active ? 'text-bf-gold' : 'text-[#776e5b]'}`}>{tab.label}</span>
                            </div>
                        );
                        return tab.to
                            ? <Link key={tab.label} to={tab.to} className="flex-1 flex">{inner}</Link>
                            : <button key={tab.label} onClick={tab.onClick} className="flex-1 flex" aria-label={tab.label}>{inner}</button>;
                    })}
                </div>
            </nav>

            {/* ── Mobile drawer (right slide-over) ── */}
            {drawerOpen && (
                <div className="lg:hidden fixed inset-0 z-50">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setDrawerOpen(false)} />
                    <div
                        className="absolute right-0 top-0 h-full w-[290px] max-w-[86vw] bg-bf-card2 border-l border-[rgba(216,184,120,0.14)] flex flex-col shadow-2xl"
                        style={{ animation: 'slideUp .28s ease both' }}
                    >
                        <div className="flex items-center justify-between px-5 pt-[calc(14px+env(safe-area-inset-top))] pb-4 border-b border-[rgba(216,184,120,0.10)]">
                            <div className="font-displaySerif text-xl font-semibold text-bf-cream">Menu</div>
                            <button onClick={() => setDrawerOpen(false)} className="w-9 h-9 rounded-lg flex items-center justify-center text-bf-muted hover:text-bf-cream hover:bg-[rgba(216,184,120,0.08)]" aria-label="Close menu">
                                <X size={20} />
                            </button>
                        </div>
                        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5 custom-scrollbar">
                            {visibleNav.map((item) => {
                                const Icon = item.icon;
                                const active = isActive(item.path);
                                return (
                                    <Link key={item.path} to={item.path} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${active ? 'bg-[rgba(216,184,120,0.10)] text-bf-gold' : 'text-content-secondary'}`}>
                                        <Icon size={18} className={active ? 'text-bf-gold' : 'text-bf-muted'} />
                                        <span className="font-medium text-sm">{item.label}</span>
                                        <ChevronRight size={16} className="ml-auto text-bf-faint" />
                                    </Link>
                                );
                            })}
                            {isSuperAdmin && (
                                <Link to="/app/admin" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-content-secondary">
                                    <ShieldCheck size={18} className="text-bf-goldDeep" />
                                    <span className="font-medium text-sm">Admin</span>
                                    <ChevronRight size={16} className="ml-auto text-bf-faint" />
                                </Link>
                            )}
                            <div className="my-2 border-t border-[rgba(216,184,120,0.08)]" />
                            <Link to="/app/settings" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-content-secondary"><Settings size={18} className="text-bf-muted" /><span className="font-medium text-sm">Settings</span></Link>
                            <Link to="/app/help" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-content-secondary"><HelpCircle size={18} className="text-bf-muted" /><span className="font-medium text-sm">Help</span></Link>
                        </nav>
                        <div className="px-3 pb-[calc(14px+env(safe-area-inset-bottom))] pt-2 border-t border-[rgba(216,184,120,0.10)]">
                            <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-bf-danger hover:bg-[rgba(224,138,138,0.08)]">
                                <LogOut size={18} /><span className="font-medium text-sm">Sign out</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {!token && (
                <div className="lg:hidden fixed bottom-4 inset-x-4 z-40">
                    <Link to="/app"><Button className="w-full justify-center"><LogIn size={16} className="mr-2" /> Sign in</Button></Link>
                </div>
            )}
        </div>
    );
}
