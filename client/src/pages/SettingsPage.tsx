import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { AlertTriangle, Key } from 'lucide-react';
import { useConfig } from '../lib/config';

export function SettingsPage() {
    const { config } = useConfig();
    const { features } = config;
    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
            <div>
                <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 mb-2">Settings</h2>
                <p className="text-gray-400">Manage your API keys and application configuration.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card title="API Configuration" className="md:col-span-2">
                    <div className="space-y-6">
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex items-start gap-3">
                            <AlertTriangle className="text-blue-400 shrink-0 mt-1" size={20} />
                            <div className="text-sm text-blue-200">
                                <p className="font-semibold mb-1">Environment Variables</p>
                                <p>For security, API keys should be set in your <code className="bg-black/30 px-1.5 py-0.5 rounded text-blue-300">server/.env</code> file. The application requires a restart to pick up changes.</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="grid gap-4">
                                {[
                                    { name: 'OPENAI_API_KEY', label: 'OpenAI API Key', desc: 'Required for Scripts', enabled: features.scripts },
                                    { name: 'GEMINI_API_KEY', label: 'Gemini API Key', desc: 'Alternative for Scripts', enabled: features.scripts },
                                    { name: 'ELEVENLABS_API_KEY', label: 'ElevenLabs API Key', desc: 'Required for TTS Voice', enabled: features.tts },
                                    { name: 'PEXELS_API_KEY', label: 'Pexels API Key', desc: 'Required for Background Videos', enabled: features.pexels },
                                    { name: 'PIXABAY_API_KEY', label: 'Pixabay API Key', desc: 'Required for Animated Backgrounds', enabled: features.pixabay },
                                    { name: 'FFMPEG_PATH', label: 'FFmpeg', desc: 'Required for Render + Audio Processing', enabled: features.render },
                                ].map((key) => (
                                    <div key={key.name} className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 bg-dark-900 rounded-lg text-gray-400">
                                                <Key size={18} />
                                            </div>
                                            <div>
                                                <h4 className="font-medium text-gray-200">{key.label}</h4>
                                                <p className="text-xs text-gray-500">{key.desc}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <code className="hidden sm:block text-xs text-gray-600 bg-black/20 px-2 py-1 rounded">{key.name}</code>
                                            <Badge variant={key.enabled ? 'success' : 'warning'}>
                                                {key.enabled ? 'Ready' : 'Missing'}
                                            </Badge>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </Card>

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
            </div>
        </div>
    );
}
