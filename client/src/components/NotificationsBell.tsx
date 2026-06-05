import { useEffect, useState, useRef } from 'react';
import { Bell, CheckCircle2, XCircle, ExternalLink, Rocket, Film } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
    useNotifications,
    useUnreadCount,
    markAllRead,
    markRead,
    clearAll,
    startJobPoller,
    type Notification,
} from '../lib/notifications';

function relativeTime(iso: string): string {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const diff = (Date.now() - t) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
}

export function NotificationsBell() {
    const [open, setOpen] = useState(false);
    const notifications = useNotifications();
    const unread = useUnreadCount();
    const navigate = useNavigate();
    const panelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        startJobPoller();
    }, []);

    const handleToggle = () => {
        setOpen((o) => {
            const next = !o;
            if (next) markAllRead();
            return next;
        });
    };

    const handleClick = (n: Notification) => {
        markRead(n.id);
        if (n.href) navigate(n.href);
        setOpen(false);
    };

    return (
        <div className="relative" ref={panelRef}>
            <button
                onClick={handleToggle}
                className="relative p-2 text-content-secondary hover:text-white transition-colors"
                aria-label="Notifications"
            >
                <Bell size={20} />
                {unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-[9px] font-bold text-white flex items-center justify-center shadow-lg shadow-rose-500/40">
                        {unread > 9 ? '9+' : unread}
                    </span>
                )}
            </button>
            {open && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setOpen(false)}
                        aria-hidden
                    />
                    <div className="absolute right-0 top-full mt-2 w-80 max-h-[70vh] overflow-y-auto z-50 bg-dark-950/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl">
                        <div className="flex items-center justify-between p-3 border-b border-white/5 sticky top-0 bg-dark-950/95 backdrop-blur-xl">
                            <span className="text-sm font-semibold text-white">Notifications</span>
                            {notifications.length > 0 && (
                                <button
                                    onClick={clearAll}
                                    className="text-[10px] text-content-secondary hover:text-white uppercase tracking-wider"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        {notifications.length === 0 ? (
                            <div className="p-6 text-center text-xs text-content-tertiary">
                                <Bell size={24} className="mx-auto mb-2 opacity-40" />
                                No notifications yet
                            </div>
                        ) : (
                            <ul className="divide-y divide-white/5">
                                {notifications.map((n) => {
                                    const isCampaign = n.kind === 'campaign_done' || n.kind === 'campaign_failed' || n.kind === 'campaign_render_only';
                                    return (
                                    <li key={n.id}>
                                        <button
                                            onClick={() => handleClick(n)}
                                            className={`w-full text-left p-3 transition-colors flex items-start gap-2 ${isCampaign ? 'bg-amber-500/[0.04] hover:bg-amber-500/[0.08]' : 'hover:bg-white/5'}`}
                                        >
                                            {n.kind === 'campaign_done' ? (
                                                <Rocket size={16} className="text-amber-300 flex-shrink-0 mt-0.5" />
                                            ) : n.kind === 'campaign_render_only' ? (
                                                <Film size={16} className="text-emerald-300 flex-shrink-0 mt-0.5" />
                                            ) : n.kind === 'campaign_failed' ? (
                                                <XCircle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
                                            ) : n.kind === 'job_done' ? (
                                                <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                                            ) : n.kind === 'job_failed' ? (
                                                <XCircle size={16} className="text-rose-400 flex-shrink-0 mt-0.5" />
                                            ) : (
                                                <Bell size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className={`text-xs font-semibold ${n.read ? 'text-content-secondary' : 'text-white'}`}>{n.title}</span>
                                                    <span className="text-[9px] text-content-tertiary flex-shrink-0">{relativeTime(n.createdAt)}</span>
                                                </div>
                                                {n.body && (
                                                    <p className="text-[10px] text-content-secondary mt-0.5 line-clamp-2 break-all">{n.body}</p>
                                                )}
                                                {n.href && (
                                                    <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-primary-300">
                                                        Open <ExternalLink size={10} />
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
