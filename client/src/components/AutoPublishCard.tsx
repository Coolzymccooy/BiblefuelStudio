import { useEffect, useMemo, useState } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { Zap, Loader2, Music2, Youtube, Instagram, Twitter, Facebook, Linkedin } from 'lucide-react';

interface Integration {
    id: string;
    platform?: string;
    identifier?: string;
    name?: string;
    displayName?: string;
}

interface PostizStatus {
    configured: boolean;
    postizUserId?: string;
    integrations: Integration[];
}

interface AutoPublishConfig {
    enabled: boolean;
    platforms: string[];
}

const PLATFORM_META: Record<string, { label: string; icon: typeof Music2 }> = {
    tiktok:    { label: 'TikTok',    icon: Music2 },
    youtube:   { label: 'YouTube',   icon: Youtube },
    instagram: { label: 'Instagram', icon: Instagram },
    x:         { label: 'X',         icon: Twitter },
    facebook:  { label: 'Facebook',  icon: Facebook },
    linkedin:  { label: 'LinkedIn',  icon: Linkedin },
};

/**
 * Auto-publish on render — Tier 4 of the share strategy.
 *
 * Spec: docs/superpowers/specs/2026-05-26-auto-share-options-research.md (§Tier 4)
 *
 * When ON, every render_video / render_waveform job that finishes fires a
 * Postiz post to the user's selected connected platforms. Server-side wiring
 * lives in server/src/routes/jobs.js (workerTick → maybeAutoPublish).
 */
export function AutoPublishCard() {
    const [status, setStatus] = useState<PostizStatus | null>(null);
    const [config, setConfig] = useState<AutoPublishConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            api.get('/api/postiz/status'),
            api.get('/api/postiz/auto-publish'),
        ]).then(([statusRes, autoRes]) => {
            if (cancelled) return;
            if (statusRes.ok) setStatus(statusRes.data as PostizStatus);
            if (autoRes.ok) {
                setConfig({
                    enabled: Boolean(autoRes.data?.enabled),
                    platforms: Array.isArray(autoRes.data?.platforms) ? autoRes.data.platforms : [],
                });
            } else if (autoRes.status === 503 || statusRes.status === 503) {
                setStatus({ configured: false, integrations: [] });
                setConfig({ enabled: false, platforms: [] });
            }
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, []);

    const connectedPlatforms = useMemo(() => {
        const s = new Set<string>();
        for (const it of status?.integrations || []) {
            const key = String(it.platform || it.identifier || '').toLowerCase();
            if (key) s.add(key);
        }
        return s;
    }, [status]);

    const togglePlatform = (platform: string) => {
        if (!config) return;
        const set = new Set(config.platforms);
        if (set.has(platform)) set.delete(platform);
        else set.add(platform);
        setConfig({ ...config, platforms: Array.from(set) });
    };

    const setEnabled = (enabled: boolean) => {
        if (!config) return;
        setConfig({ ...config, enabled });
    };

    const save = async () => {
        if (!config) return;
        setSaving(true);
        const res = await api.put('/api/postiz/auto-publish', {
            enabled: config.enabled,
            platforms: config.platforms,
        });
        setSaving(false);
        if (res.ok) toast.success('Auto-publish settings saved');
        else toast.error(res.error || 'Could not save settings');
    };

    if (loading) {
        return (
            <Card>
                <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Loader2 size={16} className="animate-spin" /> Loading auto-publish...
                </div>
            </Card>
        );
    }

    if (!status?.configured) return null;

    const hasConnections = connectedPlatforms.size > 0;

    return (
        <Card>
            <div className="flex items-center gap-2 mb-1">
                <Zap size={18} className="text-amber-400" />
                <h3 className="text-lg font-semibold text-gray-100">Auto-publish on render</h3>
            </div>
            <p className="text-xs text-gray-500 mb-4">
                When a video finishes rendering, automatically post it to your selected platforms. Connect accounts above first.
            </p>

            {!hasConnections && (
                <p className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mb-3">
                    Connect at least one platform above before turning on auto-publish.
                </p>
            )}

            <label className="flex items-center gap-2 cursor-pointer mb-4">
                <input
                    type="checkbox"
                    checked={Boolean(config?.enabled)}
                    onChange={(e) => setEnabled(e.target.checked)}
                    disabled={!hasConnections}
                    className="rounded border-white/10 bg-black/50 checked:bg-amber-500"
                />
                <span className="text-sm text-gray-200">Auto-publish renders to selected platforms</span>
            </label>

            {config?.enabled && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                    {Array.from(connectedPlatforms).map((platform) => {
                        const meta = PLATFORM_META[platform] || { label: platform, icon: Music2 };
                        const Icon = meta.icon;
                        const selected = config.platforms.includes(platform);
                        return (
                            <button
                                key={platform}
                                onClick={() => togglePlatform(platform)}
                                className={`flex items-center gap-2 p-2 rounded-lg border text-xs transition-colors ${
                                    selected
                                        ? 'border-amber-500/40 bg-amber-500/10 text-gray-100'
                                        : 'border-white/10 bg-dark-900/40 hover:bg-white/5 text-gray-300'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => { /* handled by button */ }}
                                    className="rounded border-white/10 bg-black/50 checked:bg-amber-500 pointer-events-none"
                                    tabIndex={-1}
                                />
                                <Icon size={14} />
                                <span>{meta.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}

            <div className="flex items-center gap-2">
                <Button onClick={save} disabled={saving} className="text-xs h-8">
                    {saving ? <Loader2 size={12} className="mr-1 animate-spin" /> : null}
                    Save settings
                </Button>
                {config?.enabled && config.platforms.length === 0 && (
                    <span className="text-[11px] text-yellow-300">Pick at least one platform to auto-post to.</span>
                )}
            </div>
        </Card>
    );
}
