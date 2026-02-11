import { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { Mic, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { loadJson, saveJson, STORAGE_KEYS } from '../lib/storage';
import { useConfig } from '../lib/config';

interface Script {
    title: string;
    hook: string;
    verse: string;
    reference: string;
    reflection: string;
    cta: string;
    hashtags: string[];
}

export function ScriptsPage() {
    const navigate = useNavigate();
    const { config } = useConfig();
    const scriptsEnabled = config.features.scripts;
    const [count, setCount] = useState(10);
    const [ctaStyle, setCtaStyle] = useState('save');
    const [lengthSeconds, setLengthSeconds] = useState(20);
    const [scripts, setScripts] = useState<Script[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);

    useEffect(() => {
        const cached = loadJson<Script[]>(STORAGE_KEYS.scripts, []);
        if (cached.length) {
            setScripts(cached);
        }
    }, []);

    const handleGenerate = async () => {
        setIsGenerating(true);
        try {
            const response = await api.post('/api/scripts/generate', {
                count,
                ctaStyle,
                lengthSeconds,
            });

            if (response.ok && response.data?.scripts) {
                setScripts(response.data.scripts);
                saveJson(STORAGE_KEYS.scripts, response.data.scripts);
                toast.success(`Generated ${response.data.scripts.length} scripts!`);
            } else {
                toast.error(response.error || 'Failed to generate scripts');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleAddToQueue = async (script: Script) => {
        try {
            const response = await api.post('/api/queue/add', {
                title: script.title || 'Biblefuel Post',
                hook: script.hook || '',
                verse: script.verse || '',
                reference: script.reference || '',
                reflection: script.reflection || '',
                cta: script.cta || '',
                hashtags: script.hashtags || [],
            });

            if (response.ok) {
                toast.success('Added to queue!');
            } else {
                toast.error(response.error || 'Failed to add to queue');
            }
        } catch (error) {
            toast.error('An error occurred');
        }
    };

    const handleSendToVoice = (script: Script) => {
        const fullText = `${script.hook}\n\n${script.verse} (${script.reference})\n\n${script.reflection}\n\n${script.cta}`;
        localStorage.setItem('bf_tts_text', fullText);
        toast.success('Script sent to Voice page!');
        navigate('/voice-audio');
    };

    const handleClear = () => {
        setScripts([]);
        saveJson(STORAGE_KEYS.scripts, []);
    };

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Generate Scripts</h2>

            <Card title="Configuration">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Count
                        </label>
                        <Input
                            type="number"
                            value={count}
                            onChange={(e) => setCount(Number(e.target.value))}
                            min={1}
                            max={100}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            CTA Style
                        </label>
                        <Select value={ctaStyle} onChange={(e) => setCtaStyle(e.target.value)}>
                            <option value="save">save</option>
                            <option value="follow">follow</option>
                            <option value="share">share</option>
                            <option value="comment">comment</option>
                        </Select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Length (seconds)
                        </label>
                        <Input
                            type="number"
                            value={lengthSeconds}
                            onChange={(e) => setLengthSeconds(Number(e.target.value))}
                            min={8}
                            max={90}
                        />
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    <Button onClick={handleGenerate} isLoading={isGenerating} disabled={!scriptsEnabled} className="w-full sm:w-auto">
                        Generate
                    </Button>
                    <Button onClick={handleClear} variant="secondary" disabled={scripts.length === 0} className="w-full sm:w-auto">
                        Clear
                    </Button>
                </div>

                <p className="text-sm text-gray-500 mt-4">
                    {scriptsEnabled
                        ? "If you didn't set keys, fallback scripts will be used."
                        : "Scripts are disabled until OPENAI_API_KEY or GEMINI_API_KEY is configured."}
                </p>
            </Card>

            {scripts.length > 0 && (
                <div className="mt-6 space-y-4">
                    <h3 className="text-lg font-semibold">Generated Scripts ({scripts.length})</h3>
                    {scripts.map((script, idx) => (
                        <Card key={idx}>
                            <div className="space-y-3">
                                <div>
                                    <h4 className="font-bold text-lg">{idx + 1}. {script.title}</h4>
                                </div>

                                <div>
                                    <p className="text-sm text-gray-600 font-medium">Hook:</p>
                                    <p className="text-gray-800">{script.hook}</p>
                                </div>

                                <div>
                                    <p className="text-sm text-gray-600 font-medium">Verse:</p>
                                    <p className="text-gray-800">
                                        {script.verse}{' '}
                                        <span className="text-gray-500 text-sm italic">{script.reference}</span>
                                    </p>
                                </div>

                                <div>
                                    <p className="text-sm text-gray-600 font-medium">Reflection:</p>
                                    <p className="text-gray-800">{script.reflection}</p>
                                </div>

                                <div>
                                    <p className="text-sm text-gray-600 font-medium">CTA:</p>
                                    <p className="text-gray-800">{script.cta}</p>
                                </div>

                                {script.hashtags && script.hashtags.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {script.hashtags.slice(0, 10).map((tag, i) => (
                                            <span
                                                key={i}
                                                className="inline-block px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className="pt-2 flex gap-2">
                                    <Button onClick={() => handleAddToQueue(script)}>
                                        <Plus size={16} className="mr-2" />
                                        Add to Queue
                                    </Button>
                                    <Button onClick={() => handleSendToVoice(script)} variant="secondary">
                                        <Mic size={16} className="mr-2" />
                                        Send to Voice
                                    </Button>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
