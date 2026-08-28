import { useCallback, useEffect, useState } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { Youtube, ExternalLink, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

interface YouTubeStatus {
    serverConfigured: boolean;
    connected: boolean;
    channelTitle: string;
    channelId: string;
    connectedAt: string;
}

/**
 * Per-user "Connect YouTube" card. Lives on Settings, visible to everyone
 * (super-admin AND regular users — unlike the Social Automation panel
 * which exposes raw OAuth keys and is operator-only).
 *
 * Click flow:
 *   1. User clicks Connect → we POST /youtube/connect, server returns
 *      an authUrl with our userId signed into the OAuth state param.
 *   2. We open the authUrl in a popup → Google's consent screen.
 *   3. After consent, Google redirects to /api/social/youtube/callback,
 *      our server exchanges the code, saves the refresh_token + channel
 *      info to the user's social.json, and serves a tiny HTML page that
 *      postMessages back to this opener window and self-closes.
 *   4. We listen for that message, refresh the status, and show
 *      "Connected to <channel name>".
 *
 * If the operator hasn't set YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET
 * in env, the server reports serverConfigured=false and we render an
 * informational state instead of the Connect button — no point letting
 * the user click something that can't possibly work.
 */
export function YouTubeConnectCard() {
    const [status, setStatus] = useState<YouTubeStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);

    const loadStatus = useCallback(async () => {
        const res = await api.get<YouTubeStatus>('/api/social/youtube/status');
        if (res.ok && res.data) setStatus(res.data);
        setLoading(false);
    }, []);

    useEffect(() => {
        loadStatus();
    }, [loadStatus]);

    // Listen for the callback page's postMessage so we can refresh status
    // the moment Google redirects back, instead of making the user manually
    // reload. Same-origin check keeps this safe from cross-origin spam.
    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const data = event.data as { type?: string; ok?: boolean } | null;
            if (data?.type !== 'biblefuel:youtube-oauth') return;
            if (data.ok) {
                toast.success('YouTube connected ✓');
                void loadStatus();
            } else {
                toast.error('YouTube connection failed');
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [loadStatus]);

    const handleConnect = async () => {
        setConnecting(true);
        try {
            const res = await api.get<{ authUrl: string }>('/api/social/youtube/connect');
            if (!res.ok || !res.data?.authUrl) {
                toast.error(res.error || 'Could not start YouTube connection');
                return;
            }
            // Popup width/height tuned for Google's OAuth screen. Centered
            // on the parent window so multi-monitor users don't get the
            // popup on the wrong display.
            const w = 520;
            const h = 720;
            const left = Math.max(0, (window.screen.width - w) / 2);
            const top = Math.max(0, (window.screen.height - h) / 2);
            const popup = window.open(
                res.data.authUrl,
                'biblefuel_yt_oauth',
                `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`,
            );
            if (!popup) {
                // Popup blocker — fall back to opening in the same tab. The
                // callback's "Back to Settings" link gets them back here.
                window.location.href = res.data.authUrl;
            }
        } finally {
            setConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        if (!confirm('Disconnect your YouTube account from Biblefuel? Auto-publish to YouTube will stop until you reconnect.')) {
            return;
        }
        setDisconnecting(true);
        try {
            const res = await api.post('/api/social/youtube/disconnect');
            if (res.ok) {
                toast.success('YouTube disconnected');
                await loadStatus();
            } else {
                toast.error(res.error || 'Disconnect failed');
            }
        } finally {
            setDisconnecting(false);
        }
    };

    if (loading) {
        return (
            <Card title="Connections" className="border-white/10">
                <div className="flex items-center gap-2 text-sm text-content-secondary py-4">
                    <Loader2 size={16} className="animate-spin" /> Loading…
                </div>
            </Card>
        );
    }

    return (
        <Card title="Connections" className="border-white/10">
            <p className="text-xs text-content-secondary mb-4">
                Connect your accounts so Auto-Publish posts to <span className="text-gray-200">your</span> channels.
            </p>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 flex-shrink-0">
                    <Youtube size={24} className="text-rose-300" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-white">YouTube</h4>
                        {status?.connected ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#7fb5aa]/15 border border-[#7fb5aa]/30 text-[#a5cec6] text-[10px] font-semibold">
                                <CheckCircle2 size={10} /> Connected
                            </span>
                        ) : status?.serverConfigured ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-500/15 border border-gray-500/30 text-gray-300 text-[10px] font-semibold">
                                Not connected
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[10px] font-semibold">
                                <AlertCircle size={10} /> Server setup needed
                            </span>
                        )}
                    </div>
                    {status?.connected ? (
                        <p className="text-xs text-content-secondary mt-1">
                            {status.channelTitle ? (
                                <>
                                    Posting to <strong className="text-gray-200">{status.channelTitle}</strong>
                                </>
                            ) : (
                                'Posting to your YouTube channel.'
                            )}
                            {status.connectedAt && (
                                <> · Connected {new Date(status.connectedAt).toLocaleDateString()}</>
                            )}
                        </p>
                    ) : status?.serverConfigured ? (
                        <p className="text-xs text-content-secondary mt-1">
                            One-click sign in with Google. Auto-Publish will upload Shorts to your channel as Private by default.
                        </p>
                    ) : (
                        <p className="text-xs text-amber-200/80 mt-1">
                            YouTube connection isn't available on this server. The operator needs to set <code className="text-amber-200">YOUTUBE_CLIENT_ID</code> and <code className="text-amber-200">YOUTUBE_CLIENT_SECRET</code> in environment variables.
                        </p>
                    )}
                </div>
                <div className="flex flex-shrink-0">
                    {status?.connected ? (
                        <Button
                            variant="secondary"
                            className="text-xs h-9 px-3 border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                            onClick={handleDisconnect}
                            isLoading={disconnecting}
                        >
                            Disconnect
                        </Button>
                    ) : status?.serverConfigured ? (
                        <Button
                            className="text-xs h-9 px-4 bg-rose-500 hover:bg-rose-400 text-white border-rose-500/40 font-semibold"
                            onClick={handleConnect}
                            isLoading={connecting}
                        >
                            <ExternalLink size={14} className="mr-1.5" />
                            Connect
                        </Button>
                    ) : null}
                </div>
            </div>

            {/* Future destinations land in the same card. We'll add
                Make/Zapier webhook (existing per-user storage) and TikTok
                (via Zernio) here when we ship those flows. */}
        </Card>
    );
}
