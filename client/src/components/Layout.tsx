import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import {
    Menu, X, FileText, List, Briefcase, Image, Mic, Film, Video, Package, LogOut, LogIn, Shield, Settings, HelpCircle, Wand2
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/Button';

const navItems = [
    { path: '/', label: 'Home', icon: Shield },
    { path: '/wizard', label: 'Wizard', icon: Wand2 },
    { path: '/scripts', label: 'Scripts', icon: FileText },
    { path: '/queue', label: 'Queue', icon: List },
    { path: '/jobs', label: 'Jobs', icon: Briefcase },
    { path: '/backgrounds', label: 'Backgrounds', icon: Image },
    { path: '/voice-audio', label: 'Voice & Audio', icon: Mic },
    { path: '/timeline', label: 'Timeline', icon: Film },
    { path: '/render', label: 'Render', icon: Video },
    { path: '/gumroad', label: 'Gumroad', icon: Package },
];

const quickActions = [
    { path: '/scripts', label: 'Scripts', icon: FileText },
    { path: '/voice-audio', label: 'Voice', icon: Mic },
    { path: '/render', label: 'Render', icon: Video },
    { path: '/jobs', label: 'Jobs', icon: Briefcase },
];

export function Layout() {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const { token, logout } = useAuth();
    const location = useLocation();

    const isActive = (path: string) => location.pathname === path;

    return (
        <div className="min-h-screen flex flex-col lg:flex-row font-sans text-gray-100">
            {/* Mobile Header */}
            <header className="lg:hidden bg-dark-900/80 backdrop-blur-md border-b border-white/10 sticky top-0 z-50 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="text-gray-300 hover:text-white transition-colors">
                        {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                    </button>
                    <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-400 to-indigo-400 font-display">
                        Biblefuel Studio
                    </span>
                </div>

                {/* Mobile Auth Button */}
                {token && (
                    <button onClick={logout} className="p-2 text-gray-400 hover:text-white transition-colors">
                        <LogOut size={20} />
                    </button>
                )}
            </header>

            {/* Sidebar Navigation */}
            <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:h-screen
        bg-dark-900/40 backdrop-blur-xl border-r border-white/5 flex flex-col
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
                <div className="p-6 hidden lg:block">
                    <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-400 to-indigo-400 font-display neon-text">
                        Biblefuel<span className="font-light text-white drop-shadow-sm">Studio</span>
                    </h1>
                </div>

                <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto custom-scrollbar">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.path);
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group ${active
                                    ? 'bg-primary-500/10 text-primary-400 shadow-neon shadow-primary-500/10 border border-primary-500/20'
                                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-100 hover:pl-5'
                                    }`}
                            >
                                <Icon size={20} className={`${active ? 'text-primary-400 drop-shadow-[0_0_8px_rgba(56,189,248,0.4)]' : 'text-gray-500 group-hover:text-gray-300'} transition-all`} />
                                <span className={`font-medium tracking-wide ${active ? 'neon-text' : ''}`}>{item.label}</span>
                                {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-400 shadow-[0_0_8px_rgba(56,189,248,0.8)] animate-pulse" />}
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-white/5">
                    {token ? (
                        <div className="flex items-center justify-between px-4 py-3 bg-dark-800/50 rounded-xl border border-white/5">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse"></div>
                                <span className="text-xs font-medium text-gray-400">Online</span>
                            </div>
                            <button
                                onClick={logout}
                                className="text-gray-400 hover:text-red-400 transition-colors p-1"
                                title="Logout"
                            >
                                <LogOut size={18} />
                            </button>
                        </div>
                    ) : (
                        <Link to="/">
                            <Button className="w-full justify-center">
                                <LogIn size={16} className="mr-2" />
                                Login
                            </Button>
                        </Link>
                    )}

                    <div className="mt-4 flex justify-between text-xs text-gray-600 px-2">
                        <span>v3.0.0</span>
                        <Link to="/settings" className="hover:text-primary-400 transition-colors flex items-center gap-1">
                            <Settings size={12} /> Settings
                        </Link>
                        <Link to="/help" className="hover:text-primary-400 transition-colors flex items-center gap-1">
                            <HelpCircle size={12} /> Help
                        </Link>
                    </div>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto min-h-screen lg:h-screen relative scroll-smooth selection:bg-primary-500/30">
                {/* Background Glow Effects */}
                <div className="fixed -top-24 -right-24 w-96 h-96 bg-primary-600/20 rounded-full blur-[128px] pointer-events-none animate-pulse-subtle" />
                <div className="fixed bottom-0 left-0 w-64 h-64 bg-indigo-600/10 rounded-full blur-[96px] pointer-events-none" />

                <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 relative z-10 pb-36 animate-fade-in">
                    <Outlet />
                </div>
            </main>

            {/* Mobile Overlay */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
                    onClick={() => setIsMobileMenuOpen(false)}
                />
            )}

            {/* Mobile Quick Actions */}
            <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-dark-900/90 backdrop-blur-md border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
                <div className="flex items-center justify-around px-3 py-2">
                    {quickActions.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.path);
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-[10px] font-semibold uppercase tracking-wider ${active
                                    ? 'text-primary-300 bg-primary-500/10'
                                    : 'text-gray-400 hover:text-white'
                                    }`}
                            >
                                <Icon size={18} className={active ? 'text-primary-300' : 'text-gray-500'} />
                                {item.label}
                            </Link>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
