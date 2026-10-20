import { useCallback, useEffect, useState } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { Music2, ExternalLink, CheckCircle2, Loader2 } from 'lucide-react';

interface TikTokStatus {
    serverConfigured: boolean;
    connected: boolean;
    source: 'server' | 'connected' | null;
    username: string;
    connectedAt?: string;
    canConnect: boolean;
}

// What the connect callback appends to /app/settings when it sends the user back.
const CALLBACK_ERRORS: Record<string, string> = {
    cancelled: 'TikTok connection was cancelled.',
    expired: 'That TikTok sign-in link expired. Click Connect to try again.',
    not_found: 'Zernio did not report a TikTok account for you. Try connecting again.',
    failed: 'TikTok could not be connected. Try again in a minute.',
};

/**
 * Per-user "Connect TikTok" card. TikTok posts go out through Zernio: the
 * operator's account comes from the server settings, everyone else connects
 * their own TikTok here, under the server's Zernio key.
 *
 * Zernio's sign-in is a full-page redirect, not a popup: the server sends the
 * user back to /app/settings?tiktok=connected (or ?tiktok_error=<reason>),
 * which this card reads once, reports, and strips from the address bar.
 */
export function TikTokConnectCard() {
    const [status, setStatus] = useState<TikTokStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);

    const loadStatus = useCallback(async () => {
        const res = await api.get<TikTokStatus>('/api/social/tiktok/status');
        if (res.ok && res.data) setStatus(res.data);
        setLoading(false);
    }, []);

    useEffect(() => {
        void loadStatus();
    }, [loadStatus]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const connected = params.get('tiktok') === 'connected';
        const error = params.get('tiktok_error');
        if (!connected && !error) return;
        if (connected) toast.success('TikTok connected');
        else toast.error(CALLBACK_ERRORS[error || ''] || CALLBACK_ERRORS.failed, { duration: 8000 });
        params.delete('tiktok');
        params.delete('tiktok_error');
        const query = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }, []);

    const handleConnect = async () => {
        setConnecting(true);
        try {
            const res = await api.post<{ authUrl: string }>('/api/social/tiktok/connect');
            if (!res.ok || !res.data?.authUrl) {
                toast.error(res.error || 'Could not start the TikTok connection');
                setConnecting(false);
                return;
            }
            // Leaves the page; the button stays busy until the browser navigates.
            window.location.href = res.data.authUrl;
        } catch {
            toast.error('Could not start the TikTok connection');
            setConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        if (!confirm('Disconnect your TikTok from BibleFuel? Auto-publish to TikTok stops until you connect again.')) return;
        setDisconnecting(true);
        try {
            const res = await api.post<{ removedAtZernio?: boolean }>('/api/social/tiktok/disconnect');
            if (res.ok) {
                toast.success('TikTok disconnected');
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
            <Card title="TikTok" className="border-white/10">
                <div className="flex items-center gap-2 text-sm text-content-secondary py-4">
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading…
                </div>
            </Card>
        );
    }

    const connected = Boolean(status?.connected);
    const fromServer = status?.source === 'server';

    return (
        <Card title="TikTok" className="border-white/10">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 flex-shrink-0 self-start sm:self-center">
                    <Music2 size={24} className="text-content-secondary" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-white">TikTok, through Zernio</h4>
                        {connected ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-white/10 text-bf-success text-[11px] font-medium">
                                <CheckCircle2 size={11} aria-hidden="true" /> Connected
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-white/10 text-content-secondary text-[11px] font-medium">
                                Not connected
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-content-secondary mt-1">
                        {describe(status)}
                    </p>
                </div>
                <div className="flex flex-shrink-0">
                    {connected && !fromServer ? (
                        <Button variant="secondary" className="text-xs h-9 px-3" onClick={handleDisconnect} isLoading={disconnecting}>
                            Disconnect
                        </Button>
                    ) : !connected && status?.canConnect ? (
                        <Button className="text-xs h-9 px-4" onClick={handleConnect} isLoading={connecting}>
                            <ExternalLink size={14} className="mr-1.5" aria-hidden="true" />
                            Connect TikTok
                        </Button>
                    ) : null}
                </div>
            </div>
        </Card>
    );
}

function describe(status: TikTokStatus | null): string {
    if (!status) return 'TikTok status could not be loaded. Refresh the page to try again.';
    if (status.source === 'server') {
        return 'Auto-publish posts your videos to TikTok through the Zernio account set in the server settings.';
    }
    if (status.connected) {
        const who = status.username ? `@${status.username}` : 'your TikTok';
        const when = status.connectedAt ? ` Connected ${new Date(status.connectedAt).toLocaleDateString()}.` : '';
        return `Auto-publish posts your videos to ${who}.${when}`;
    }
    if (!status.serverConfigured) {
        return 'TikTok posting is not set up on this server yet. Until it is, you can post to TikTok through a Make or Zapier webhook below.';
    }
    if (status.canConnect) {
        return 'Sign in with TikTok once, and auto-publish posts each finished video to your account. Videos go out on your TikTok, not anyone else’s.';
    }
    return 'Connecting TikTok here is open to admins for now. You can post to TikTok through a Make or Zapier webhook below.';
}
