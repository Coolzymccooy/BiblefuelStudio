import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Key, Link2, RefreshCw } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { useConfig } from '../lib/config';

export function SettingsPage() {
    const { config } = useConfig();
    const { features } = config;
    const [activeSection, setActiveSection] = useState<'api' | 'social' | 'app'>('api');
    const [bufferToken, setBufferToken] = useState('');
    const [bufferProfiles, setBufferProfiles] = useState<{ id: string; service: string; formatted_service: string }[]>([]);
    const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
    const [webhooks, setWebhooks] = useState<{ id?: string; name: string; url: string; enabled: boolean }[]>([]);
    const [selectedWebhookId, setSelectedWebhookId] = useState('');
    const [directConfig, setDirectConfig] = useState({
        youtubeClientId: '',
        youtubeClientSecret: '',
        youtubeRefreshToken: '',
        instagramAccessToken: '',
        instagramUserId: '',
        tiktokAccessToken: '',
        tiktokOpenId: '',
    });
    const [isLoadingSocial, setIsLoadingSocial] = useState(false);

    const apiItems = useMemo(() => ([
        { name: 'OPENAI_API_KEY', label: 'OpenAI API Key', desc: 'Required for Scripts', enabled: features.scripts },
        { name: 'GEMINI_API_KEY', label: 'Gemini API Key', desc: 'Alternative for Scripts', enabled: features.scripts },
        { name: 'ELEVENLABS_API_KEY', label: 'ElevenLabs API Key', desc: 'Required for TTS Voice', enabled: features.tts },
        { name: 'PEXELS_API_KEY', label: 'Pexels API Key', desc: 'Required for Background Videos', enabled: features.pexels },
        { name: 'PIXABAY_API_KEY', label: 'Pixabay API Key', desc: 'Required for Animated Backgrounds', enabled: features.pixabay },
        { name: 'FFMPEG_PATH', label: 'FFmpeg', desc: 'Required for Render + Audio Processing', enabled: features.render },
    ]), [features]);

    const loadSocialConfig = async () => {
        setIsLoadingSocial(true);
        try {
            const res = await api.get('/api/social/config');
            if (res.ok && res.data) {
                setSelectedProfiles(res.data.buffer?.profileIds || []);
                const hooks = (res.data.webhooks || []).map((w: any) => ({ ...w }));
                setWebhooks(hooks);
                const firstEnabled = hooks.find((w: any) => w.enabled);
                setSelectedWebhookId(firstEnabled?.id || hooks[0]?.id || '');
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
        } finally {
            setIsLoadingSocial(false);
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
        if (res.ok) toast.success('Social config saved');
        else toast.error(res.error || 'Failed to save social config');
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
        if (!selectedWebhookId) {
            toast.error('Select a webhook first');
            return;
        }
        const res = await api.post('/api/social/post', {
            destination: 'webhook',
            webhookId: selectedWebhookId,
            caption: 'Test post from Biblefuel Studio',
            videoUrl: 'https://example.com/test-video.mp4',
            meta: { event: 'test.webhook', source: 'settings' },
        });
        if (res.ok) toast.success('Test webhook sent');
        else toast.error(res.error || 'Failed to send test webhook');
    };

    return (
        <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
            <div>
                <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 mb-2">Settings</h2>
                <p className="text-gray-400">Manage keys, social automation, and app info.</p>
            </div>

            <div className="flex flex-wrap gap-2">
                <Button variant={activeSection === 'api' ? 'primary' : 'secondary'} className="text-xs h-8" onClick={() => setActiveSection('api')}>
                    API Keys
                </Button>
                <Button variant={activeSection === 'social' ? 'primary' : 'secondary'} className="text-xs h-8" onClick={() => setActiveSection('social')}>
                    Social Automation
                </Button>
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
                                            <p className="text-[10px] text-gray-500">{key.desc}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <code className="hidden sm:block text-[10px] text-gray-600 bg-black/20 px-2 py-1 rounded">{key.name}</code>
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

            {activeSection === 'social' && (
                <Card title="Social Automation">
                    <div className="space-y-4">
                        <div className="text-xs text-gray-500">
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
                                <Select value={selectedWebhookId} onChange={(e) => setSelectedWebhookId(e.target.value)}>
                                    <option value="">Select webhook to test...</option>
                                    {webhooks.map((w, idx) => (
                                        <option key={w.id || idx} value={w.id || ''} disabled={!w.id}>
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
                    </div>
                </Card>
            )}

            {activeSection === 'app' && (
                <Card title="Application Info">
                    <div className="space-y-4">
                        <div className="flex justify-between py-2 border-b border-white/5">
                            <span className="text-gray-400">Version</span>
                            <span className="font-mono text-sm">v3.0.0 (React Refactor)</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-white/5">
                            <span className="text-gray-400">Environment</span>
                            <Badge variant="success">{config.env}</Badge>
                        </div>
                        <div className="flex justify-between py-2 border-b border-white/5">
                            <span className="text-gray-400">Backend Status</span>
                            <Badge variant="success">Connected</Badge>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}
