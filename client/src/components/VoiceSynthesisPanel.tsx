import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic2, Play, Pause, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { Textarea } from './ui/Textarea';
import { api, GENERATE_TIMEOUT_MS } from '../lib/api';
import { toOutputUrl } from '../lib/storage';
import { useVoiceSynthesisDefaults } from '../lib/voiceSynthesisDefaults';
import toast from 'react-hot-toast';

type ProviderInfo = { available: boolean; reachable?: boolean; priority: number };
type ProvidersResponse = { ok: boolean; providers: Record<string, ProviderInfo>; probed?: boolean };

type Profile = {
    category: string;
    label: string;
    description: string;
    providerPreference: string[];
    recommendedTypographyPreset: string;
};

type ProfilesResponse = { ok: boolean; profiles: Profile[] };

type SynthesisResult = {
    ok: boolean;
    file?: string;
    provider?: string;
    voice?: string;
    category?: string;
    profileLabel?: string;
    recommendedTypographyPreset?: string;
    alignment?: { characters: string[] };
    alignmentSource?: string;
    error?: string;
};

const SAMPLE_TEXT = 'The Lord is my shepherd; I shall not want.';

export function VoiceSynthesisPanel() {
    const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);

    const [defaults, updateDefaults] = useVoiceSynthesisDefaults();
    const { enabled, category, providerOverride, cinematicMode } = defaults;
    const setCategory = (next: string) => updateDefaults({ category: next });
    const setProviderOverride = (next: string) => updateDefaults({ providerOverride: next });
    const setCinematicMode = (updater: (prev: boolean) => boolean) =>
        updateDefaults({ cinematicMode: updater(cinematicMode) });
    const setEnabled = (next: boolean) => updateDefaults({ enabled: next });
    const [sampleText, setSampleText] = useState(SAMPLE_TEXT);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<SynthesisResult | null>(null);
    const [playing, setPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [providersRes, profilesRes] = await Promise.all([
                api.get<ProvidersResponse>('/api/tts/providers?probe=1'),
                api.get<ProfilesResponse>('/api/tts/profiles'),
            ]);
            if (cancelled) return;
            if (providersRes.ok && providersRes.data) setProviders(providersRes.data.providers || {});
            if (profilesRes.ok && profilesRes.data) setProfiles(profilesRes.data.profiles || []);
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const activeProfile = useMemo(
        () => profiles.find((p) => p.category === category) || profiles[0],
        [profiles, category],
    );

    const providerOptions = useMemo(() => {
        const ids = Object.keys(providers);
        return ['', ...ids];
    }, [providers]);

    const audioSrc = useMemo(
        () => toOutputUrl(result?.file, api.mediaBaseUrl),
        [result],
    );

    const handleGenerate = async () => {
        if (sampleText.trim().length < 3) {
            toast.error('Sample text too short');
            return;
        }
        setBusy(true);
        setResult(null);
        try {
            const res = await api.post<SynthesisResult>('/api/tts/synthesize-category', {
                text: sampleText.trim(),
                category,
                withTimestamps: true,
                preferredProvider: providerOverride || undefined,
                overrides: {
                    forcedAlignmentFallback: cinematicMode,
                },
            }, undefined, { timeout: GENERATE_TIMEOUT_MS });
            if (res.ok && res.data?.ok) {
                setResult(res.data);
                toast.success(`Generated via ${res.data.provider}`);
            } else {
                toast.error(res.data?.error || res.error || 'Synthesis failed');
            }
        } finally {
            setBusy(false);
        }
    };

    const togglePlay = () => {
        const a = audioRef.current;
        if (!a) return;
        if (playing) {
            a.pause();
            setPlaying(false);
        } else {
            a.play().catch((e) => toast.error(String(e?.message || e)));
        }
    };

    if (loading) {
        return (
            <Card title="Voice Synthesis">
                <div className="flex items-center gap-2 text-help">
                    <Loader2 size={16} className="animate-spin" /> Loading voice engine...
                </div>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            <Card title="Providers">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {Object.entries(providers).map(([id, info]) => (
                        <div
                            key={id}
                            className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5"
                        >
                            <div className="flex items-center gap-2">
                                <Mic2 size={16} className="text-gray-400" />
                                <div>
                                    <div className="text-sm font-medium text-gray-200 capitalize">{id}</div>
                                    <div className="text-meta">Priority {info.priority}</div>
                                </div>
                            </div>
                            {(() => {
                                // Three distinct states for self-hosted bridges:
                                //   configured + reachable  → "Ready"   (green)
                                //   configured + unreachable → "Offline" (warning)
                                //   not configured           → "Missing" (warning)
                                if (!info.available) {
                                    return (
                                        <Badge variant="warning">
                                            <span className="flex items-center gap-1"><AlertTriangle size={11} /> Missing</span>
                                        </Badge>
                                    );
                                }
                                if (info.reachable === false) {
                                    return (
                                        <Badge variant="warning">
                                            <span className="flex items-center gap-1"><AlertTriangle size={11} /> Offline</span>
                                        </Badge>
                                    );
                                }
                                return (
                                    <Badge variant="success">
                                        <span className="flex items-center gap-1"><CheckCircle2 size={11} /> Ready</span>
                                    </Badge>
                                );
                            })()}
                        </div>
                    ))}
                </div>
                <p className="text-help mt-3">
                    ElevenLabs needs <code className="bg-black/30 px-1.5 py-0.5 rounded">ELEVENLABS_API_KEY</code>.
                    Edge-TTS is on by default. Chatterbox needs <code className="bg-black/30 px-1.5 py-0.5 rounded">CHATTERBOX_URL</code>.
                </p>
            </Card>

            <Card title="Narration Categories">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {profiles.map((p) => (
                        <button
                            type="button"
                            key={p.category}
                            onClick={() => setCategory(p.category)}
                            className={`text-left p-3 rounded-xl border transition-colors ${
                                category === p.category
                                    ? 'bg-white/10 border-white/30'
                                    : 'bg-white/5 border-white/5 hover:border-white/15'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <div className="text-sm font-semibold text-gray-100 capitalize">{p.category}</div>
                                <Badge variant="default">{p.label}</Badge>
                            </div>
                            <div className="text-help mb-2">{p.description}</div>
                            <div className="text-meta">
                                Preset: <span className="text-gray-300">{p.recommendedTypographyPreset}</span>
                            </div>
                        </button>
                    ))}
                </div>
            </Card>

            <Card title="Generate Sample">
                <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="text-caption mb-1 block">Category</label>
                            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                                {profiles.map((p) => (
                                    <option key={p.category} value={p.category}>
                                        {p.label} ({p.category})
                                    </option>
                                ))}
                            </Select>
                        </div>
                        <div>
                            <label className="text-caption mb-1 block">Provider override</label>
                            <Select
                                value={providerOverride}
                                onChange={(e) => setProviderOverride(e.target.value)}
                            >
                                {providerOptions.map((id) => (
                                    <option key={id || 'auto'} value={id}>
                                        {id ? id : 'Auto (use profile preference)'}
                                    </option>
                                ))}
                            </Select>
                        </div>
                        <div>
                            <label className="text-caption mb-1 block">Cinematic mode</label>
                            <button
                                type="button"
                                onClick={() => setCinematicMode((v) => !v)}
                                className={`w-full h-9 rounded-lg text-xs font-medium transition-colors border ${
                                    cinematicMode
                                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
                                        : 'bg-white/5 border-white/10 text-gray-400'
                                }`}
                            >
                                {cinematicMode ? 'ON — force word timings' : 'OFF — provider-native only'}
                            </button>
                        </div>
                    </div>

                    <Textarea
                        rows={3}
                        value={sampleText}
                        onChange={(e) => setSampleText(e.target.value)}
                        placeholder="Sample text to synthesize"
                    />

                    <div className="flex flex-wrap gap-2 items-center">
                        <Button onClick={handleGenerate} disabled={busy} className="h-9">
                            {busy ? (
                                <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Synthesizing...</span>
                            ) : (
                                'Generate sample'
                            )}
                        </Button>
                        {activeProfile && (
                            <span className="text-meta">
                                Profile preference: {activeProfile.providerPreference.join(' → ')}
                            </span>
                        )}
                    </div>

                    <div
                        className={`mt-2 rounded-xl border p-3 flex flex-wrap items-center gap-3 transition-colors ${
                            enabled
                                ? 'bg-emerald-500/10 border-emerald-500/30'
                                : 'bg-white/5 border-white/10'
                        }`}
                    >
                        <button
                            type="button"
                            onClick={() => setEnabled(!enabled)}
                            className={`h-8 px-3 rounded-lg text-xs font-medium border transition-colors ${
                                enabled
                                    ? 'bg-emerald-500 text-black border-emerald-500'
                                    : 'bg-white/5 text-gray-300 border-white/10 hover:border-white/20'
                            }`}
                        >
                            {enabled ? 'Enabled across the app' : 'Apply across the app'}
                        </button>
                        <div className="text-help leading-snug">
                            When enabled, Voice &amp; Audio and Auto-Publish use{' '}
                            <span className="text-gray-200 font-medium">{activeProfile?.label || category}</span>
                            {providerOverride ? ` via ${providerOverride}` : ' via the profile preference'}
                            {cinematicMode ? ' with forced word timings' : ''}.
                        </div>
                    </div>

                    {result?.ok && result.file && (
                        <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
                            <div className="flex items-center gap-3">
                                <Button onClick={togglePlay} className="h-9 w-9 p-0 flex items-center justify-center">
                                    {playing ? <Pause size={14} /> : <Play size={14} />}
                                </Button>
                                <div className="text-xs text-gray-300">
                                    <div className="font-medium">
                                        {result.profileLabel} <span className="text-meta">via {result.provider}</span>
                                    </div>
                                    <div className="text-meta">
                                        Typography preset: <span className="text-gray-300">{result.recommendedTypographyPreset}</span>
                                        {result.alignment && (
                                            <>
                                                {' · '}
                                                Alignment: {result.alignment.characters.length} chars
                                                {result.alignmentSource ? ` (${result.alignmentSource})` : ''}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <audio
                                ref={audioRef}
                                src={audioSrc}
                                controls
                                preload="auto"
                                className="w-full"
                                onPlay={() => setPlaying(true)}
                                onPause={() => setPlaying(false)}
                                onEnded={() => setPlaying(false)}
                                onError={() => toast.error('Audio failed to load — check console for the requested URL')}
                            />
                            <div className="text-meta truncate">
                                <a href={audioSrc} target="_blank" rel="noreferrer" className="hover:text-gray-300 underline">
                                    {audioSrc}
                                </a>
                            </div>
                        </div>
                    )}
                </div>
            </Card>
        </div>
    );
}
