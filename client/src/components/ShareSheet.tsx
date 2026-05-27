import { useEffect, useMemo, useState } from 'react';
import {
    Download, Share2, Copy, Check, Music2, Youtube, Instagram, Twitter, Facebook, Linkedin, MessageCircle, Mail, Link2, Loader2,
} from 'lucide-react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

/**
 * Universal share/download/play card.
 *
 * Spec: docs/superpowers/specs/2026-05-26-auto-share-options-research.md
 *
 * Layered share strategy:
 *   Tier 1 — Always: Download + Copy link
 *   Tier 2 — Mobile only: native Web Share API (whole OS share sheet)
 *   Tier 3 — Per-platform: Postiz auto-publish (TikTok, YouTube, IG, X, FB, LinkedIn)
 *            Falls back to intent URLs for text-only platforms (Twitter, FB, WA, Reddit)
 *   Tier 4 — Auto-publish on render: handled in Settings, not here
 */

interface PostizIntegration {
    id: string;
    platform?: string;
    identifier?: string;
    name?: string;
    displayName?: string;
}

interface ShareSheetProps {
    /** Absolute or root-relative URL of the rendered MP4 */
    videoUrl: string;
    /** Caption/text that should travel with the share. Used by Web Share API + Postiz. */
    caption?: string;
    /** Optional title for YouTube etc. */
    title?: string;
    /** Suggested filename for download (without .mp4) */
    filename?: string;
    /** Optional: hide the inline video player (e.g. when caller renders its own player). */
    hidePlayer?: boolean;
}

type PostizPlatform = 'tiktok' | 'youtube' | 'instagram' | 'x' | 'facebook' | 'linkedin';

const POSTIZ_PLATFORMS: Array<{ id: PostizPlatform; label: string; icon: typeof Music2 }> = [
    { id: 'tiktok',    label: 'TikTok',    icon: Music2 },
    { id: 'youtube',   label: 'YouTube',   icon: Youtube },
    { id: 'instagram', label: 'Instagram', icon: Instagram },
    { id: 'x',         label: 'X',         icon: Twitter },
    { id: 'facebook',  label: 'Facebook',  icon: Facebook },
    { id: 'linkedin',  label: 'LinkedIn',  icon: Linkedin },
];

function absoluteUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    if (typeof window === 'undefined') return url;
    return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

function intentUrl(target: 'twitter' | 'facebook' | 'whatsapp' | 'reddit' | 'telegram' | 'email', text: string, url: string): string {
    const e = encodeURIComponent;
    switch (target) {
        case 'twitter':  return `https://twitter.com/intent/tweet?text=${e(text)}&url=${e(url)}`;
        case 'facebook': return `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`;
        case 'whatsapp': return `https://wa.me/?text=${e(`${text}\n${url}`)}`;
        case 'reddit':   return `https://www.reddit.com/submit?url=${e(url)}&title=${e(text)}`;
        case 'telegram': return `https://t.me/share/url?url=${e(url)}&text=${e(text)}`;
        case 'email':    return `mailto:?subject=${e(text)}&body=${e(`${text}\n${url}`)}`;
    }
}

export function ShareSheet({ videoUrl, caption = '', title, filename = 'biblefuel-video', hidePlayer = false }: ShareSheetProps) {
    const absVideoUrl = useMemo(() => absoluteUrl(videoUrl), [videoUrl]);

    const [copied, setCopied] = useState(false);
    const [postizState, setPostizState] = useState<{ configured: boolean; integrations: PostizIntegration[] } | null>(null);
    const [busyPlatform, setBusyPlatform] = useState<string | null>(null);
    const [canNativeShare, setCanNativeShare] = useState(false);

    // Feature-detect Web Share API + file support
    useEffect(() => {
        if (typeof navigator === 'undefined') return;
        // Can't reliably canShare a File until we fetch the blob — detect navigator.share itself.
        // We'll do an inner canShare check at click time once we have the file.
        setCanNativeShare(typeof navigator.share === 'function');
    }, []);

    // Load Postiz integrations (silently fail if not configured)
    useEffect(() => {
        let cancelled = false;
        api.get('/api/postiz/status').then((res) => {
            if (cancelled) return;
            if (res.ok && res.data) {
                setPostizState({
                    configured: Boolean(res.data.configured),
                    integrations: Array.isArray(res.data.integrations) ? res.data.integrations : [],
                });
            } else if (res.status === 503) {
                setPostizState({ configured: false, integrations: [] });
            }
        });
        return () => { cancelled = true; };
    }, []);

    const connectedSet = useMemo(() => {
        const s = new Set<string>();
        for (const it of postizState?.integrations || []) {
            const key = String(it.platform || it.identifier || '').toLowerCase();
            if (key) s.add(key);
        }
        return s;
    }, [postizState]);

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(absVideoUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('Could not copy link');
        }
    };

    const handleNativeShare = async () => {
        try {
            const resp = await fetch(absVideoUrl);
            if (!resp.ok) throw new Error(`Could not fetch video: ${resp.status}`);
            const blob = await resp.blob();
            const file = new File([blob], `${filename}.mp4`, { type: blob.type || 'video/mp4' });

            // Some browsers (Firefox Android) implement navigator.share but not files
            if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
                // Fall back to URL share
                await navigator.share({ title: title || 'Biblefuel video', text: caption, url: absVideoUrl });
                return;
            }
            await navigator.share({ files: [file], title: title || 'Biblefuel video', text: caption });
        } catch (err: unknown) {
            // AbortError = user cancelled, not an error worth toasting
            const name = (err && typeof err === 'object' && 'name' in err) ? String((err as { name?: string }).name) : '';
            if (name !== 'AbortError') {
                toast.error('Native share failed — try Download instead');
            }
        }
    };

    const handlePostizShare = async (platform: PostizPlatform) => {
        setBusyPlatform(platform);
        try {
            // If not connected yet, send user to Postiz Connect first
            if (!connectedSet.has(platform)) {
                const connect = await api.post(`/api/postiz/connect/${platform}`, {
                    returnUrl: `${window.location.origin}${window.location.pathname}?connected=${platform}`,
                });
                if (connect.ok && connect.data?.url) {
                    window.location.href = connect.data.url as string;
                    return;
                }
                if (connect.status === 503) {
                    toast.error('Auto-publish is not configured yet on this server. Try Download or the OS share button.');
                    return;
                }
                toast.error(connect.error || `Could not start ${platform} connect`);
                return;
            }

            // Connected — push to Postiz
            const res = await api.post('/api/postiz/post', {
                videoUrl: absVideoUrl,
                caption,
                title,
                platforms: [platform],
            });
            if (res.ok) {
                toast.success(`Posting to ${platform}…`);
            } else if (res.status === 403 && res.error === 'FEATURE_LOCKED') {
                toast.error('Premium plan needed for auto-publish.');
            } else {
                toast.error(res.error || `Failed to post to ${platform}`);
            }
        } finally {
            setBusyPlatform(null);
        }
    };

    return (
        <Card className="space-y-4">
            {!hidePlayer && (
                <video
                    src={absVideoUrl}
                    controls
                    playsInline
                    className="w-full max-h-[60vh] rounded-lg bg-black"
                />
            )}

            {/* Tier 1 — always available */}
            <div className="flex flex-wrap gap-2">
                <a href={absVideoUrl} download={`${filename}.mp4`}>
                    <Button>
                        <Download size={14} className="mr-2" />
                        Download MP4
                    </Button>
                </a>
                <Button variant="secondary" onClick={copyLink}>
                    {copied ? <Check size={14} className="mr-2" /> : <Copy size={14} className="mr-2" />}
                    {copied ? 'Copied' : 'Copy link'}
                </Button>

                {/* Tier 2 — mobile native share */}
                {canNativeShare && (
                    <Button variant="secondary" onClick={handleNativeShare}>
                        <Share2 size={14} className="mr-2" />
                        Share…
                    </Button>
                )}
            </div>

            {/* Tier 3 — per-platform auto-publish (Postiz) */}
            {postizState?.configured && (
                <div>
                    <div className="text-xs uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1">
                        <Link2 size={12} /> Auto-publish to your accounts
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {POSTIZ_PLATFORMS.map(({ id, label, icon: Icon }) => {
                            const connected = connectedSet.has(id);
                            return (
                                <button
                                    key={id}
                                    onClick={() => handlePostizShare(id)}
                                    disabled={busyPlatform === id}
                                    className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-colors disabled:opacity-50 ${connected
                                        ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 text-gray-100'
                                        : 'border-white/10 bg-dark-900/40 hover:bg-white/5 text-gray-300'
                                        }`}
                                    title={connected ? `Post to ${label}` : `Connect ${label} & post`}
                                >
                                    {busyPlatform === id ? (
                                        <Loader2 size={16} className="animate-spin" />
                                    ) : (
                                        <Icon size={16} />
                                    )}
                                    <span>{label}</span>
                                    {!connected && <span className="text-[9px] text-gray-500">Connect</span>}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Universal fallback — intent URL share to platforms that accept text+link */}
            <div>
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1">
                    <Share2 size={12} /> Share link
                </div>
                <div className="flex flex-wrap gap-2">
                    <a href={intentUrl('twitter', caption || 'Made with Biblefuel', absVideoUrl)} target="_blank" rel="noreferrer">
                        <Button variant="ghost" className="text-xs h-8">
                            <Twitter size={12} className="mr-1" /> Post on X
                        </Button>
                    </a>
                    <a href={intentUrl('whatsapp', caption || 'Check this out', absVideoUrl)} target="_blank" rel="noreferrer">
                        <Button variant="ghost" className="text-xs h-8">
                            <MessageCircle size={12} className="mr-1" /> WhatsApp
                        </Button>
                    </a>
                    <a href={intentUrl('facebook', '', absVideoUrl)} target="_blank" rel="noreferrer">
                        <Button variant="ghost" className="text-xs h-8">
                            <Facebook size={12} className="mr-1" /> Facebook
                        </Button>
                    </a>
                    <a href={intentUrl('reddit', caption || 'Made with Biblefuel', absVideoUrl)} target="_blank" rel="noreferrer">
                        <Button variant="ghost" className="text-xs h-8">
                            Reddit
                        </Button>
                    </a>
                    <a href={intentUrl('email', caption || 'Made with Biblefuel', absVideoUrl)}>
                        <Button variant="ghost" className="text-xs h-8">
                            <Mail size={12} className="mr-1" /> Email
                        </Button>
                    </a>
                </div>
            </div>

            {/* When Postiz isn't configured */}
            {postizState && !postizState.configured && (
                <p className="text-[11px] text-gray-500">
                    Tip: Download the MP4 and upload to TikTok / Instagram / YouTube directly. One-click auto-publish to those platforms is coming soon.
                </p>
            )}
        </Card>
    );
}
