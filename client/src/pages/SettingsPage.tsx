import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Key, Link2, RefreshCw, User as UserIcon, LogOut, BadgeCheck, Mail } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { useConfig } from '../lib/config';
import { describeCron } from '../lib/cronDescribe';
import { ThemeToggle } from '../components/ThemeToggle';
import { useAuth } from '../hooks/useAuth';
import { VoiceSynthesisPanel } from '../components/VoiceSynthesisPanel';
import { PlanAndUsageCard } from '../components/PlanAndUsageCard';
import { PostizConnectCard } from '../components/PostizConnectCard';
import { AutoPublishCard } from '../components/AutoPublishCard';
import { YouTubeConnectCard } from '../components/YouTubeConnectCard';
import { WebhookConnectCard } from '../components/WebhookConnectCard';

type SocialSchedule = {
    id: string;
    name: string;
    enabled: boolean;
    type: 'replay' | 'auto_generate';
    cron: string;
    timezone: string;
    destination: 'webhook' | 'buffer' | 'youtube';
    caption: string;
    videoUrl: string;
    webhookId?: string;
    profileId?: string;
    privacyStatus?: 'private' | 'unlisted' | 'public';
    // auto_generate knobs
    niche?: string;
    tone?: string;
    ctaStyle?: string;
    aspect?: string;
    durationSec?: number;
    voiceId?: string;
    backgroundQuery?: string;
};

// Posting cadence presets. Cron is `m h dom mon dow`; the timezone below is
// what makes 06:00 mean 06:00 locally all year (UTC drifts an hour under BST).
const SCHEDULE_TIMEZONE = 'Europe/London';

const SCHEDULE_PRESETS: Array<{ key: string; label: string; hint: string; cron: string }> = [
    { key: 'morning', label: 'Morning', hint: '6:00am daily', cron: '0 6 * * *' },
    { key: 'night', label: 'Night', hint: '10:00pm daily', cron: '0 22 * * *' },
    { key: 'sunday', label: 'Sunday', hint: '9:00am Sundays', cron: '0 9 * * 0' },
];

export function SettingsPage() {
    const { config } = useConfig();
    const { features } = config;
    const { email: authEmail, emailVerified, isSuperAdmin, logout } = useAuth();
    const [activeSection, setActiveSection] = useState<'api' | 'voice' | 'social' | 'app'>('api');

    // Defensive: if a non-admin somehow lands on the social section (e.g.
    // returning from a stale URL after losing admin), bounce them back to
    // a safe tab they're allowed to see.
    useEffect(() => {
        if (!isSuperAdmin && activeSection === 'social') {
            setActiveSection('api');
        }
    }, [isSuperAdmin, activeSection]);
    const [bufferToken, setBufferToken] = useState('');
    const [bufferProfiles, setBufferProfiles] = useState<{ id: string; service: string; formatted_service: string }[]>([]);
    const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
    const [webhooks, setWebhooks] = useState<{ id?: string; name: string; url: string; enabled: boolean }[]>([]);
    const [selectedWebhookKey, setSelectedWebhookKey] = useState('');
    const [schedules, setSchedules] = useState<SocialSchedule[]>([]);
    const [directConfig, setDirectConfig] = useState({
        youtubeClientId: '',
        youtubeClientSecret: '',
        youtubeRefreshToken: '',
        instagramAccessToken: '',
        instagramUserId: '',
        tiktokAccessToken: '',
        tiktokOpenId: '',
    });

    const apiItems = useMemo(() => ([
        { name: 'OPENAI_API_KEY', label: 'OpenAI API Key', desc: 'Required for Scripts', enabled: features.scripts },
        { name: 'GEMINI_API_KEY', label: 'Gemini API Key', desc: 'Alternative for Scripts', enabled: features.scripts },
        { name: 'ELEVENLABS_API_KEY', label: 'ElevenLabs API Key', desc: 'Required for TTS Voice', enabled: features.tts },
        { name: 'PEXELS_API_KEY', label: 'Pexels API Key', desc: 'Required for Background Videos', enabled: features.pexels },
        { name: 'PIXABAY_API_KEY', label: 'Pixabay API Key', desc: 'Required for Animated Backgrounds', enabled: features.pixabay },
        { name: 'FFMPEG_PATH', label: 'FFmpeg', desc: 'Required for Render + Audio Processing', enabled: features.render },
    ]), [features]);

    const loadSocialConfig = async () => {
        const res = await api.get('/api/social/config');
        if (res.ok && res.data) {
            setSelectedProfiles(res.data.buffer?.profileIds || []);
            const hooks = (res.data.webhooks || []).map((w: any) => ({ ...w }));
            setWebhooks(hooks);
            setSchedules((res.data.schedules || []).map((s: any) => ({
                id: String(s.id || `sch_${Date.now()}`),
                name: String(s.name || 'Scheduled Post'),
                enabled: Boolean(s.enabled ?? true),
                type: (s.type === 'auto_generate' ? 'auto_generate' : 'replay') as SocialSchedule['type'],
                cron: String(s.cron || ''),
                timezone: String(s.timezone || 'UTC'),
                destination: (['webhook', 'buffer', 'youtube'].includes(String(s.destination))
                    ? String(s.destination)
                    : 'webhook') as SocialSchedule['destination'],
                caption: String(s.caption || ''),
                videoUrl: String(s.videoUrl || ''),
                webhookId: String(s.webhookId || ''),
                profileId: String(s.profileId || ''),
                privacyStatus: (['private', 'unlisted', 'public'].includes(String(s.privacyStatus))
                    ? String(s.privacyStatus)
                    : 'private') as SocialSchedule['privacyStatus'],
                niche: s.niche ? String(s.niche) : undefined,
                tone: s.tone ? String(s.tone) : undefined,
                ctaStyle: s.ctaStyle ? String(s.ctaStyle) : undefined,
                aspect: s.aspect ? String(s.aspect) : undefined,
                durationSec: Number.isFinite(Number(s.durationSec)) ? Number(s.durationSec) : undefined,
                voiceId: s.voiceId ? String(s.voiceId) : undefined,
                backgroundQuery: s.backgroundQuery ? String(s.backgroundQuery) : undefined,
            })));
            const firstEnabled = hooks.find((w: any) => w.enabled);
            const firstKey = firstEnabled?.id || firstEnabled?.url || (hooks[0]?.id || hooks[0]?.url || '');
            setSelectedWebhookKey(firstKey);
            if (res.data.direct) {
                setDirectConfig({
                    youtubeClientId: res.data.direct.youtube?.clientId || '',
                    youtubeClientSecret: res.data.direct.youtube?.clientSecret || '',
                    youtubeRefreshToken: res.data.direct.youtube?.refreshToken || '',
                    instagramAccessToken: res.data.direct.instagram?.accessToken || '',
                    instagramUserId: res.data.direct.instagram?.userId || '',
                    tiktokAccessToken: res.data.direct.tiktok?.accessToken || '',
                    tiktokOpenId: res.data.direct.tiktok?.openId || '',
                });
            }
        }
    };

    useEffect(() => {
        loadSocialConfig();
    }, []);

    const saveSocialConfig = async () => {
        const res = await api.post('/api/social/config', {
            buffer: {
                accessToken: bufferToken || undefined,
                profileIds: selectedProfiles,
            },
            webhooks,
            schedules,
            direct: {
                youtube: {
                    clientId: directConfig.youtubeClientId,
                    clientSecret: directConfig.youtubeClientSecret,
                    refreshToken: directConfig.youtubeRefreshToken,
                },
                instagram: {
                    accessToken: directConfig.instagramAccessToken,
                    userId: directConfig.instagramUserId,
                },
                tiktok: {
                    accessToken: directConfig.tiktokAccessToken,
                    openId: directConfig.tiktokOpenId,
                },
            },
        });
        if (res.ok) {
            toast.success('Social config saved');
            await loadSocialConfig();
        }
        else toast.error(res.error || 'Failed to save social config');
    };

    const addSchedule = () => {
        const next: SocialSchedule = {
            id: `sch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: 'Auto Post',
            enabled: true,
            // Auto-Generate is the default: it creates a fresh video each run and
            // needs no caption/videoUrl. Defaulting to 'replay' made every new
            // schedule fail validation on save (caption + videoUrl required).
            type: 'auto_generate',
            cron: '0 6 * * *',
            timezone: SCHEDULE_TIMEZONE,
            destination: 'webhook',
            caption: '',
            videoUrl: '',
            webhookId: webhooks[0]?.id || '',
            profileId: selectedProfiles[0] || '',
            privacyStatus: 'private',
        };
        setSchedules((prev) => [next, ...prev]);
    };

    const updateSchedule = (id: string, patch: Partial<SocialSchedule>) => {
        setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    };

    const removeSchedule = (id: string) => {
        setSchedules((prev) => prev.filter((s) => s.id !== id));
    };

    const loadBufferProfiles = async () => {
        if (!bufferToken) {
            toast.error('Add Buffer access token first');
            return;
        }
        const res = await api.post('/api/social/buffer/profiles', { accessToken: bufferToken });
        if (res.ok && res.data?.profiles) {
            setBufferProfiles(res.data.profiles);
            toast.success('Buffer profiles loaded');
        } else {
            toast.error(res.error || 'Failed to load profiles');
        }
    };

    const sendTestWebhook = async () => {
        const selected = webhooks.find((w, idx) => (w.id || w.url || String(idx)) === selectedWebhookKey);
        if (!selected?.url) {
            toast.error('Select a webhook first');
            return;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const res = await api.post('/api/social/post', {
            destination: 'webhook',
            webhookId: selected.id,
            webhookUrl: selected.url,
            caption: `Webhook smoke test - ${stamp}. Psalm 23:1`,
            videoUrl: 'https://download.samplelib.com/mp4/sample-5s.mp4',
            meta: { event: 'test.webhook', source: 'settings' },
        });
        if (res.ok) toast.success('Test webhook sent');
        else toast.error(res.error || 'Failed to send test webhook');
    };

    return (
        <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
            <ScreenHeader eyebrow="Settings" title={<>Tune the <em>studio</em>.</>} subtitle="Plan, integrations, and app info." />


            {/* Signed-in account — shows the email of the active session so
                operators using multiple test accounts can immediately see
                which one they're acting against. */}
            <Card>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-1">
                    <div className="rounded-2xl border border-primary-500/30 bg-primary-500/10 p-3 flex-shrink-0">
                        <UserIcon size={20} className="text-primary-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-caption mb-1">Signed in as</div>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-mono text-gray-100 break-all">
                                {authEmail || <span className="italic text-content-secondary">not signed in</span>}
                            </span>
                            {authEmail && (
                                emailVerified ? (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#7fb5aa]/15 border border-[#7fb5aa]/30 text-[#a5cec6] text-[10px]">
                                        <BadgeCheck size={10} /> Verified
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[10px]">
                                        <Mail size={10} /> Unverified
                                    </span>
                                )
                            )}
                        </div>
                    </div>
                    {authEmail && (
                        <Button
                            variant="secondary"
                            className="h-9 text-xs border-white/10 hover:border-rose-500/40 hover:text-rose-300"
                            onClick={() => {
                                logout();
                                toast.success('Signed out');
                            }}
                        >
                            <LogOut size={14} className="mr-1.5" />
                            Sign out
                        </Button>
                    )}
                </div>
            </Card>

            <Card>

                <ThemeToggle />

            </Card>

            <PlanAndUsageCard />
            <YouTubeConnectCard />
            <WebhookConnectCard />
            <PostizConnectCard />
            <AutoPublishCard />

            <div className="flex flex-wrap gap-2">
                <Button variant={activeSection === 'api' ? 'primary' : 'secondary'} className="text-xs h-8" onClick={() => setActiveSection('api')}>
                    API Keys
                </Button>
                <Button variant={activeSection === 'voice' ? 'primary' : 'secondary'} className="text-xs h-8" onClick={() => setActiveSection('voice')}>
                    Voice Synthesis
                </Button>
                {/* Social Automation hides per-user OAuth keys (Buffer, Zapier,
                    YouTube, TikTok…) that only the operator should manage
                    centrally for now. Regular users still get the auto-publish
                    scheduling UI above; what's hidden here is the credential
                    wiring. Re-enable once we ship a normie-friendly auto-share
                    onboarding flow. */}
                {isSuperAdmin && (
                    <Button variant={activeSection === 'social' ? 'primary' : 'secondary'} className="text-xs h-8" onClick={() => setActiveSection('social')}>
                        Social Automation
                    </Button>
                )}
                <Button variant={activeSection === 'app' ? 'primary' : 'secondary'} className="text-xs h-8" onClick={() => setActiveSection('app')}>
                    App Info
                </Button>
            </div>

            {activeSection === 'api' && (
                <Card title="API Configuration">
                    <div className="space-y-4">
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex items-start gap-3">
                            <AlertTriangle className="text-blue-400 shrink-0 mt-1" size={18} />
                            <div className="text-xs text-blue-200">
                                <p className="font-semibold mb-1">Environment Variables</p>
                                <p>Set keys in <code className="bg-black/30 px-1.5 py-0.5 rounded text-blue-300">server/.env</code> and restart.</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {apiItems.map((key) => (
                                <div key={key.name} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-dark-900 rounded-lg text-gray-400">
                                            <Key size={16} />
                                        </div>
                                        <div>
                                            <h4 className="font-medium text-gray-200 text-sm">{key.label}</h4>
                                            <p className="text-help">{key.desc}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <code className="hidden sm:block text-[10px] text-content-tertiary bg-black/20 px-2 py-1 rounded">{key.name}</code>
                                        <Badge variant={key.enabled ? 'success' : 'warning'}>
                                            {key.enabled ? 'Ready' : 'Missing'}
                                        </Badge>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </Card>
            )}

            {activeSection === 'voice' && (
                <VoiceSynthesisPanel />
            )}

            {activeSection === 'social' && isSuperAdmin && (
                <Card title="Social Automation">
                    <div className="space-y-4">
                        <div className="text-help">
                            Use Buffer or webhooks for the fastest setup. Direct APIs require OAuth apps and approvals.
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-xs font-semibold text-gray-300">
                                    <Link2 size={14} /> Buffer (Legacy API)
                                </div>
                                <Input
                                    value={bufferToken}
                                    onChange={(e) => setBufferToken(e.target.value)}
                                    placeholder="Buffer access token"
                                />
                                <div className="flex gap-2 flex-wrap">
                                    <Button variant="secondary" className="text-xs h-8" onClick={loadBufferProfiles}>
                                        <RefreshCw size={14} className="mr-2" />
                                        Load Profiles
                                    </Button>
                                    <Button variant="secondary" className="text-xs h-8" onClick={saveSocialConfig}>
                                        Save Config
                                    </Button>
                                </div>
                                {bufferProfiles.length > 0 && (
                                    <Select
                                        value={selectedProfiles[0] || ''}
                                        onChange={(e) => setSelectedProfiles([e.target.value])}
                                    >
                                        <option value="">Select profile...</option>
                                        {bufferProfiles.map((p) => (
                                            <option key={p.id} value={p.id}>
                                                {p.formatted_service} ({p.id})
                                            </option>
                                        ))}
                                    </Select>
                                )}
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-xs font-semibold text-gray-300">
                                    <Link2 size={14} /> Webhooks (Zapier/Make)
                                </div>
                                <Select value={selectedWebhookKey} onChange={(e) => setSelectedWebhookKey(e.target.value)}>
                                    <option value="">Select webhook to test...</option>
                                    {webhooks.map((w, idx) => (
                                        <option key={w.id || w.url || idx} value={w.id || w.url || String(idx)}>
                                            {w.name || `Webhook ${idx + 1}`}{w.enabled ? '' : ' (disabled)'}
                                        </option>
                                    ))}
                                </Select>
                                {webhooks.map((w, idx) => (
                                    <div key={w.id || idx} className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                        <Input
                                            value={w.name}
                                            onChange={(e) => {
                                                const next = [...webhooks];
                                                next[idx] = { ...next[idx], name: e.target.value };
                                                setWebhooks(next);
                                            }}
                                            placeholder="Webhook name"
                                        />
                                        <Input
                                            value={w.url}
                                            onChange={(e) => {
                                                const next = [...webhooks];
                                                next[idx] = { ...next[idx], url: e.target.value };
                                                setWebhooks(next);
                                            }}
                                            placeholder="https://hooks.zapier.com/..."
                                        />
                                        <Select
                                            value={w.enabled ? 'true' : 'false'}
                                            onChange={(e) => {
                                                const next = [...webhooks];
                                                next[idx] = { ...next[idx], enabled: e.target.value === 'true' };
                                                setWebhooks(next);
                                            }}
                                        >
                                            <option value="true">Enabled</option>
                                            <option value="false">Disabled</option>
                                        </Select>
                                    </div>
                                ))}
                                <div className="flex gap-2 flex-wrap">
                                    <Button
                                        variant="secondary"
                                        className="text-xs h-8"
                                        onClick={() => setWebhooks([...webhooks, { name: 'Zapier', url: '', enabled: true }])}
                                    >
                                        Add Webhook
                                    </Button>
                                    <Button variant="secondary" className="text-xs h-8" onClick={sendTestWebhook}>
                                        Send Test Webhook
                                    </Button>
                                    <Button variant="secondary" className="text-xs h-8" onClick={saveSocialConfig}>
                                        Save Config
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="pt-2 border-t border-white/10">
                            <div className="flex items-center gap-2 text-xs font-semibold text-gray-300 mb-2">
                                <Link2 size={14} /> Direct APIs (Beta)
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                <Input
                                    value={directConfig.youtubeClientId}
                                    onChange={(e) => setDirectConfig({ ...directConfig, youtubeClientId: e.target.value })}
                                    placeholder="YouTube Client ID"
                                />
                                <Input
                                    value={directConfig.youtubeClientSecret}
                                    onChange={(e) => setDirectConfig({ ...directConfig, youtubeClientSecret: e.target.value })}
                                    placeholder="YouTube Client Secret"
                                />
                                <Input
                                    value={directConfig.youtubeRefreshToken}
                                    onChange={(e) => setDirectConfig({ ...directConfig, youtubeRefreshToken: e.target.value })}
                                    placeholder="YouTube Refresh Token"
                                />
                                <Input
                                    value={directConfig.instagramAccessToken}
                                    onChange={(e) => setDirectConfig({ ...directConfig, instagramAccessToken: e.target.value })}
                                    placeholder="Instagram Access Token"
                                />
                                <Input
                                    value={directConfig.instagramUserId}
                                    onChange={(e) => setDirectConfig({ ...directConfig, instagramUserId: e.target.value })}
                                    placeholder="Instagram User ID"
                                />
                                <Input
                                    value={directConfig.tiktokAccessToken}
                                    onChange={(e) => setDirectConfig({ ...directConfig, tiktokAccessToken: e.target.value })}
                                    placeholder="TikTok Access Token"
                                />
                                <Input
                                    value={directConfig.tiktokOpenId}
                                    onChange={(e) => setDirectConfig({ ...directConfig, tiktokOpenId: e.target.value })}
                                    placeholder="TikTok Open ID"
                                />
                            </div>
                            <div className="flex gap-2 mt-2">
                                <Button variant="secondary" className="text-xs h-8" onClick={saveSocialConfig}>
                                    Save Direct Config
                                </Button>
                            </div>
                        </div>

                        <div className="pt-2 border-t border-white/10 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs font-semibold text-gray-300">
                                    <Link2 size={14} /> Auto Post Schedules (Cron)
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="secondary" className="text-xs h-8" onClick={addSchedule}>
                                        Add Schedule
                                    </Button>
                                    <Button variant="secondary" className="text-xs h-8" onClick={saveSocialConfig}>
                                        Save Schedules
                                    </Button>
                                </div>
                            </div>
                            <p className="text-help">
                                Pick a preset per schedule, or type a cron expression (<code>m h dom mon dow</code>) for a custom time.
                                Times run in {SCHEDULE_TIMEZONE}. For twice-daily posting add two schedules: Morning and Night.
                            </p>
                            {schedules.length === 0 && (
                                <div className="text-help">No schedules yet.</div>
                            )}
                            {schedules.map((s) => (
                                <div key={s.id} className={`rounded-xl border p-3 space-y-2 ${s.type === 'auto_generate' ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-white/10 bg-white/[0.03]'}`}>
                                    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                                        <Input
                                            value={s.name}
                                            onChange={(e) => updateSchedule(s.id, { name: e.target.value })}
                                            placeholder="Schedule name"
                                        />
                                        <Select
                                            value={s.type}
                                            onChange={(e) => updateSchedule(s.id, { type: e.target.value as SocialSchedule['type'] })}
                                            title="Replay reposts a fixed URL. Auto-Generate creates a brand new video every tick."
                                        >
                                            <option value="replay">Replay URL</option>
                                            <option value="auto_generate">Auto-Generate</option>
                                        </Select>
                                        <Input
                                            value={s.cron}
                                            onChange={(e) => updateSchedule(s.id, { cron: e.target.value })}
                                            placeholder="0 6 * * *"
                                            title="Cron expression. Use the preset buttons below for common times."
                                        />
                                        <Input
                                            value={s.timezone}
                                            onChange={(e) => updateSchedule(s.id, { timezone: e.target.value })}
                                            placeholder="UTC"
                                        />
                                        <Select
                                            value={s.enabled ? 'true' : 'false'}
                                            onChange={(e) => updateSchedule(s.id, { enabled: e.target.value === 'true' })}
                                        >
                                            <option value="true">Enabled</option>
                                            <option value="false">Disabled</option>
                                        </Select>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-help">Presets:</span>
                                        {SCHEDULE_PRESETS.map((p) => (
                                            <Button
                                                key={p.key}
                                                variant={s.cron === p.cron ? 'primary' : 'secondary'}
                                                className="text-xs h-7 px-2"
                                                title={p.hint}
                                                onClick={() => updateSchedule(s.id, { cron: p.cron, timezone: SCHEDULE_TIMEZONE })}
                                            >
                                                {p.label}
                                            </Button>
                                        ))}
                                        <span className="text-help ml-auto">{describeCron(s.cron, s.timezone)}</span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                        <Select
                                            value={s.destination}
                                            onChange={(e) => updateSchedule(s.id, { destination: e.target.value as SocialSchedule['destination'] })}
                                        >
                                            <option value="webhook">Webhook</option>
                                            <option value="buffer">Buffer</option>
                                            <option value="youtube">YouTube</option>
                                        </Select>
                                        {s.destination === 'webhook' && (
                                            <Select
                                                value={s.webhookId || ''}
                                                onChange={(e) => updateSchedule(s.id, { webhookId: e.target.value })}
                                            >
                                                <option value="">Select webhook...</option>
                                                {webhooks.map((w, idx) => (
                                                    <option key={w.id || idx} value={w.id || ''}>{w.name || `Webhook ${idx + 1}`}</option>
                                                ))}
                                            </Select>
                                        )}
                                        {s.destination === 'buffer' && (
                                            <Select
                                                value={s.profileId || ''}
                                                onChange={(e) => updateSchedule(s.id, { profileId: e.target.value })}
                                            >
                                                <option value="">Select profile...</option>
                                                {selectedProfiles.map((pid) => (
                                                    <option key={pid} value={pid}>{pid}</option>
                                                ))}
                                            </Select>
                                        )}
                                        {s.destination === 'youtube' && (
                                            <Select
                                                value={s.privacyStatus || 'private'}
                                                onChange={(e) => updateSchedule(s.id, { privacyStatus: e.target.value as SocialSchedule['privacyStatus'] })}
                                            >
                                                <option value="private">YouTube Private</option>
                                                <option value="unlisted">YouTube Unlisted</option>
                                                <option value="public">YouTube Public</option>
                                            </Select>
                                        )}
                                        <Button variant="secondary" className="text-xs h-10" onClick={() => removeSchedule(s.id)}>
                                            Remove
                                        </Button>
                                    </div>
                                    {s.type === 'replay' ? (
                                        <>
                                            <Input
                                                value={s.videoUrl}
                                                onChange={(e) => updateSchedule(s.id, { videoUrl: e.target.value })}
                                                placeholder="Video URL or /outputs/video-xxx.mp4"
                                            />
                                            <Input
                                                value={s.caption}
                                                onChange={(e) => updateSchedule(s.id, { caption: e.target.value })}
                                                placeholder="Caption for scheduled post"
                                            />
                                        </>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                            <Input
                                                value={s.backgroundQuery || ''}
                                                onChange={(e) => updateSchedule(s.id, { backgroundQuery: e.target.value })}
                                                placeholder="Background filter (optional, e.g. 'sunset')"
                                            />
                                            <Select
                                                value={s.aspect || 'portrait'}
                                                onChange={(e) => updateSchedule(s.id, { aspect: e.target.value })}
                                            >
                                                <option value="portrait">Portrait (9:16)</option>
                                                <option value="landscape">Landscape (16:9)</option>
                                                <option value="square">Square (1:1)</option>
                                            </Select>
                                            <Input
                                                type="number"
                                                value={s.durationSec ?? 20}
                                                onChange={(e) => updateSchedule(s.id, { durationSec: Number(e.target.value) || 20 })}
                                                placeholder="Duration (s)"
                                            />
                                            <Select
                                                value={s.ctaStyle || 'save'}
                                                onChange={(e) => updateSchedule(s.id, { ctaStyle: e.target.value })}
                                            >
                                                <option value="save">CTA: save</option>
                                                <option value="follow">CTA: follow</option>
                                                <option value="share">CTA: share</option>
                                                <option value="comment">CTA: comment</option>
                                            </Select>
                                        </div>
                                    )}
                                    {s.type === 'auto_generate' && (
                                        <p className="text-[10px] text-amber-200/80">
                                            On each cron tick this generates a NEW script + voice + video and posts via the destination above. Requires at least one background in your Library.
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </Card>
            )}

            {activeSection === 'app' && (
                <Card title="Application Info">
                    <div className="space-y-4">
                        <div className="flex justify-between py-2 border-b border-white/5">
                            <span className="text-meta">Version</span>
                            <span className="font-mono text-sm">v3.0.0 (React Refactor)</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-white/5">
                            <span className="text-meta">Environment</span>
                            <Badge variant="success">{config.env}</Badge>
                        </div>
                        <div className="flex justify-between py-2 border-b border-white/5">
                            <span className="text-meta">Backend Status</span>
                            <Badge variant="success">Connected</Badge>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}
