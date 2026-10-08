import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import toast from 'react-hot-toast';
import { Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { api } from '../lib/api';

export type LogoPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
export type LogoSize = 'small' | 'medium' | 'large';

export interface Branding {
    enabled: boolean;
    position: LogoPosition;
    size: LogoSize;
    opacity: number;
    hasLogo: boolean;
    logoDataUrl: string | null;
}

const POSITIONS: Array<[LogoPosition, string]> = [
    ['top-right', 'Top right'],
    ['top-left', 'Top left'],
    ['bottom-right', 'Bottom right'],
    ['bottom-left', 'Bottom left'],
];
const SIZES: Array<[LogoSize, string]> = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];

// Same proportions the renderer uses for a landscape frame (server/src/lib/branding.js).
const SIZE_PCT: Record<LogoSize, number> = { small: 6, medium: 8, large: 10.4 };

/** Where the preview places the logo: the renderer's corner margins, as percentages. */
export function previewLogoStyle(b: Pick<Branding, 'position' | 'size' | 'opacity'>) {
    const [v, h] = b.position.split('-');
    return {
        width: `${SIZE_PCT[b.size]}%`,
        opacity: b.opacity,
        [v]: '4.5%',
        [h]: '3.5%',
    } as const;
}

/**
 * The account's video logo. Once uploaded and on, every video the studio
 * renders for this account carries it in the chosen corner.
 */
export function BrandingCard() {
    const [branding, setBranding] = useState<Branding | null>(null);
    const [busy, setBusy] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        void (async () => {
            const res = await api.get<{ branding: Branding }>('/api/branding');
            if (res.ok && res.data?.branding) setBranding(res.data.branding);
            else toast.error(res.error || 'Could not load branding');
        })();
    }, []);

    const save = async (patch: Partial<Branding>) => {
        if (!branding) return;
        const previous = branding;
        setBranding({ ...branding, ...patch });
        const res = await api.put<{ branding: Branding }>('/api/branding', patch);
        if (res.ok && res.data?.branding) setBranding(res.data.branding);
        else {
            setBranding(previous);
            toast.error(res.error || 'Could not save branding');
        }
    };

    const upload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setBusy(true);
        try {
            const res = await api.uploadRaw<{ branding: Branding }>('/api/branding/logo', file);
            if (res.ok && res.data?.branding) {
                setBranding(res.data.branding);
                toast.success('Logo saved. New videos will carry it.');
            } else {
                toast.error(res.error || 'Could not upload the logo');
            }
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        setBusy(true);
        try {
            const res = await api.delete<{ branding: Branding }>('/api/branding/logo');
            if (res.ok && res.data?.branding) setBranding(res.data.branding);
            else toast.error(res.error || 'Could not remove the logo');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card title="Video logo" icon={ImageIcon} tooltip="Your logo is drawn in a corner of every video you render: source, timeline, story, ambient and series videos.">
            {!branding ? (
                <div className="flex items-center gap-2 text-sm text-content-secondary"><Loader2 size={14} className="animate-spin" /> Loading…</div>
            ) : (
                <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div
                        data-testid="logo-preview"
                        className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-slate-500 via-slate-700 to-slate-900"
                    >
                        {branding.hasLogo && branding.logoDataUrl ? (
                            branding.enabled && (
                                <img src={branding.logoDataUrl} alt="Your logo" className="absolute h-auto" style={previewLogoStyle(branding)} />
                            )
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-xs text-white/60">No logo yet</div>
                        )}
                    </div>

                    <div className="space-y-4">
                        <p className="text-sm text-content-secondary">
                            Upload a PNG with a transparent background. It is added to new videos only; videos you have already made are not changed.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={upload} data-testid="logo-file" />
                            <Button variant="secondary" className="h-9 text-xs" disabled={busy} onClick={() => fileInput.current?.click()}>
                                {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Upload size={14} className="mr-1.5" />}
                                {branding.hasLogo ? 'Replace logo' : 'Upload logo'}
                            </Button>
                            {branding.hasLogo && (
                                <Button variant="secondary" className="h-9 text-xs hover:text-rose-300" disabled={busy} onClick={remove}>
                                    <Trash2 size={14} className="mr-1.5" /> Remove
                                </Button>
                            )}
                        </div>

                        <label className="flex items-center gap-2 text-sm text-gray-100">
                            <input
                                type="checkbox"
                                checked={branding.enabled}
                                disabled={!branding.hasLogo}
                                onChange={(e) => void save({ enabled: e.target.checked })}
                            />
                            Add my logo to every video
                        </label>

                        <div className="grid grid-cols-2 gap-3">
                            <label className="text-caption space-y-1">
                                <span>Corner</span>
                                <Select value={branding.position} onChange={(e) => void save({ position: e.target.value as LogoPosition })}>
                                    {POSITIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                                </Select>
                            </label>
                            <label className="text-caption space-y-1">
                                <span>Size</span>
                                <Select value={branding.size} onChange={(e) => void save({ size: e.target.value as LogoSize })}>
                                    {SIZES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                                </Select>
                            </label>
                        </div>

                        <label className="text-caption block space-y-1">
                            <span>Opacity {Math.round(branding.opacity * 100)}%</span>
                            <input
                                type="range" min={20} max={100} step={5} className="w-full"
                                value={Math.round(branding.opacity * 100)}
                                onChange={(e) => setBranding({ ...branding, opacity: Number(e.target.value) / 100 })}
                                onPointerUp={(e) => void save({ opacity: Number((e.target as HTMLInputElement).value) / 100 })}
                                onKeyUp={(e) => void save({ opacity: Number((e.target as HTMLInputElement).value) / 100 })}
                            />
                        </label>
                    </div>
                </div>
            )}
        </Card>
    );
}
