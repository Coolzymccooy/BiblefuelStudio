import { useEffect, useState } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { Link2, Loader2, Music2, Youtube, Instagram, Twitter, Facebook, Linkedin } from 'lucide-react';

interface Integration {
    id: string;
    platform?: string;
    identifier?: string;
    name?: string;
    displayName?: string;
    profileUrl?: string;
}

interface PostizStatus {
    configured: boolean;
    postizUserId?: string;
    integrations: Integration[];
}

const PLATFORMS: Array<{ id: string; label: string; icon: typeof Music2 }> = [
    { id: 'tiktok',    label: 'TikTok',    icon: Music2 },
    { id: 'youtube',   label: 'YouTube',   icon: Youtube },
    { id: 'instagram', label: 'Instagram', icon: Instagram },
    { id: 'x',         label: 'X',         icon: Twitter },
    { id: 'facebook',  label: 'Facebook',  icon: Facebook },
    { id: 'linkedin',  label: 'LinkedIn',  icon: Linkedin },
];

export function PostizConnectCard() {
    const [status, setStatus] = useState<PostizStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);

    const load = async () => {
        const res = await api.get('/api/postiz/status');
        if (res.ok) setStatus(res.data as PostizStatus);
        else if (res.status !== 503) toast.error(res.error || 'Could not load integrations');
        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    const connect = async (platform: string) => {
        setBusy(platform);
        const res = await api.post(`/api/postiz/connect/${platform}`, {
            returnUrl: `${window.location.origin}/settings?connected=${platform}`,
        });
        setBusy(null);
        if (res.ok && res.data?.url) {
            window.location.href = res.data.url as string;
            return;
        }
        toast.error(res.error || `Could not start ${platform} connect`);
    };

    const disconnect = async (id: string) => {
        setBusy(id);
        const res = await api.delete(`/api/postiz/disconnect/${id}`);
        setBusy(null);
        if (res.ok) {
            toast.success('Disconnected');
            load();
        } else {
            toast.error(res.error || 'Could not disconnect');
        }
    };

    if (loading) {
        return (
            <Card>
                <div className="flex items-center gap-2 text-sm text-content-secondary">
                    <Loader2 size={16} className="animate-spin" /> Loading social connections...
                </div>
            </Card>
        );
    }

    if (!status || !status.configured) {
        // Server hasn't been configured with POSTIZ_URL yet — silently hide.
        // The Settings page already shows other social config; no need to
        // confuse normies with an inert section.
        return null;
    }

    const connectedByPlatform = new Map<string, Integration>();
    for (const it of status.integrations || []) {
        const key = String(it.platform || it.identifier || '').toLowerCase();
        if (key) connectedByPlatform.set(key, it);
    }

    return (
        <Card>
            <div className="flex items-center gap-2 mb-1">
                <Link2 size={18} className="text-primary-300" />
                <h3 className="text-lg font-semibold text-gray-100">Connect social accounts</h3>
            </div>
            <p className="text-xs text-content-tertiary mb-4">
                One click to authorise each platform. Your videos can then auto-post when a render finishes.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PLATFORMS.map(({ id, label, icon: Icon }) => {
                    const connected = connectedByPlatform.get(id);
                    return (
                        <div key={id} className="border border-white/10 rounded-lg p-3 bg-dark-900/40">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <Icon size={18} className="text-gray-300" />
                                    <span className="text-sm font-medium text-gray-200">{label}</span>
                                </div>
                                {connected && (
                                    <span className="text-[10px] uppercase tracking-wide text-[#7fb5aa] font-semibold">
                                        Connected
                                    </span>
                                )}
                            </div>
                            {connected ? (
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] text-content-tertiary truncate">
                                        {connected.displayName || connected.name || ''}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        className="text-[11px] h-7 px-2"
                                        onClick={() => disconnect(connected.id)}
                                        disabled={busy === connected.id}
                                    >
                                        Disconnect
                                    </Button>
                                </div>
                            ) : (
                                <Button
                                    className="w-full text-xs h-8"
                                    onClick={() => connect(id)}
                                    disabled={busy === id}
                                >
                                    {busy === id ? <Loader2 size={12} className="mr-1 animate-spin" /> : null}
                                    Connect
                                </Button>
                            )}
                        </div>
                    );
                })}
            </div>
        </Card>
    );
}
