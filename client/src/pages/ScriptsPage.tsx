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
import { cleanCaptionLine, cleanSpeakableText } from '../lib/speakableScript';

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
    // Default to 1 so a single ignorant click can't burn the daily script
    // quota all at once. Users on premium can still raise this before
    // hitting Generate. Daily ceiling stays at 10.
    const [count, setCount] = useState(1);
    const [ctaStyle, setCtaStyle] = useState('save');
    const [lengthSeconds, setLengthSeconds] = useState(20);
    const [scriptType, setScriptType] = useState('peace');
    const [customPrompt, setCustomPrompt] = useState('');
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
                scriptType,
                customPrompt,
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
                hook: cleanCaptionLine(script.hook || ''),
                verse: cleanCaptionLine(script.verse || ''),
                reference: cleanCaptionLine(script.reference || ''),
                reflection: cleanCaptionLine(script.reflection || ''),
                cta: cleanCaptionLine(script.cta || ''),
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
        const verseLine = script.reference ? `${script.verse} (${script.reference})` : script.verse;
        const fullText = cleanSpeakableText(`${script.hook}\n\n${verseLine}\n\n${script.reflection}\n\n${script.cta}`);
        localStorage.setItem('bf_tts_text', fullText);
        toast.success('Script sent to Voice page!');
        navigate('/app/voice-audio');
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
                        <label className="block text-sm font-medium text-gray-200 mb-1">
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
                        <label className="block text-sm font-medium text-gray-200 mb-1">
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
                        <label className="block text-sm font-medium text-gray-200 mb-1">
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

                    <div>
                        <label className="block text-sm font-medium text-gray-200 mb-1">
                            Script type
                        </label>
                        <Select value={scriptType} onChange={(e) => setScriptType(e.target.value)}>
                            <option value="peace">Peace / storm</option>
                            <option value="strength">Strength / battles</option>
                            <option value="anxiety">Anxiety / fear</option>
                            <option value="identity">Identity in Christ</option>
                            <option value="prayer">Prayer / waiting</option>
                            <option value="gratitude">Gratitude / mercy</option>
                            <option value="forgiveness">Forgiveness / grace</option>
                            <option value="purpose">Purpose / calling</option>
                            <option value="healing">Healing / grief</option>
                            <option value="custom">Custom prompt</option>
                        </Select>
                    </div>
                </div>

                {scriptType === 'custom' && (
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-200 mb-1">Custom script idea</label>
                        <Input
                            value={customPrompt}
                            onChange={(e) => setCustomPrompt(e.target.value)}
                            placeholder="e.g. trusting God after disappointment"
                        />
                    </div>
                )}

                <div className="flex flex-wrap gap-2">
                    <Button onClick={handleGenerate} isLoading={isGenerating} disabled={!scriptsEnabled} className="w-full sm:w-auto">
                        Generate
                    </Button>
                    <Button onClick={handleClear} variant="secondary" disabled={scripts.length === 0} className="w-full sm:w-auto">
                        Clear
                    </Button>
                </div>

                <p className="text-sm text-content-secondary mt-4">
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
                                    <p className="text-[0.75rem] font-medium text-primary-300">Hook</p>
                                    <p className="text-gray-100">{script.hook}</p>
                                </div>

                                <div>
                                    <p className="text-[0.75rem] font-medium text-primary-300">Verse</p>
                                    <p className="text-gray-100">
                                        {script.verse}{' '}
                                        <span className="text-gray-300 text-sm italic">{script.reference}</span>
                                    </p>
                                </div>

                                <div>
                                    <p className="text-[0.75rem] font-medium text-primary-300">Reflection</p>
                                    <p className="text-gray-100">{script.reflection}</p>
                                </div>

                                <div>
                                    <p className="text-[0.75rem] font-medium text-primary-300">CTA</p>
                                    <p className="text-gray-100">{script.cta}</p>
                                </div>

                                {script.hashtags && script.hashtags.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {script.hashtags.slice(0, 10).map((tag, i) => (
                                            <span
                                                key={i}
                                                className="inline-block px-2 py-0.5 bg-white/[0.06] text-gray-300 text-[0.75rem] rounded-full"
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
