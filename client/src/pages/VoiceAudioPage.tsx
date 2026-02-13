
import { useEffect, useRef, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Textarea } from '../components/ui/Textarea';
import { Select } from '../components/ui/Select';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { loadJson, pushUnique, saveJson, STORAGE_KEYS, toOutputUrl } from '../lib/storage';
import { useConfig } from '../lib/config';
import {
    Play,
    Mic,
    Upload,
    Clipboard,
    Wand2,
    ChevronDown,
    ChevronUp,
    Plus,
    Trash2,
    RefreshCw,
    Music,
} from 'lucide-react';

interface AudioItem {
    id: string;
    path: string;
    kind: 'tts' | 'processed' | 'upload' | 'record';
    label?: string;
    createdAt: string;
}

interface Script {
    title: string;
    hook: string;
    verse: string;
    reference: string;
    reflection: string;
    cta: string;
}

interface VoicePreset {
    id: string;
    label: string;
    voiceId: string;
    stability: number;
    similarity: number;
    tags?: string[];
}

interface ElevenVoice {
    voice_id: string;
    name: string;
    labels?: Record<string, string>;
}

export function VoiceAudioPage() {
    const { config } = useConfig();
    const ttsEnabled = config.features.tts;
    const [ttsText, setTtsText] = useState('');
    const [audioPath, setAudioPath] = useState('');
    const [preset, setPreset] = useState('clean_voice');
    const [audioHistory, setAudioHistory] = useState<AudioItem[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [showGuide, setShowGuide] = useState(true);
    const [showAllRecent, setShowAllRecent] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [voiceId, setVoiceId] = useState('');
    const [stability, setStability] = useState(0.5);
    const [similarity, setSimilarity] = useState(0.75);
    const [voicePresets, setVoicePresets] = useState<VoicePreset[]>([]);
    const [presetLabel, setPresetLabel] = useState('');
    const [presetVoiceId, setPresetVoiceId] = useState('');
    const [presetStability, setPresetStability] = useState(0.5);
    const [presetSimilarity, setPresetSimilarity] = useState(0.75);
    const [quickIds, setQuickIds] = useState('');
    const [voices, setVoices] = useState<ElevenVoice[]>([]);
    const [isLoadingVoices, setIsLoadingVoices] = useState(false);
    const [activeTab, setActiveTab] = useState<'all' | 'voice' | 'record' | 'treatment' | 'soundtrack'>('all');
    const [musicItems, setMusicItems] = useState<any[]>([]);
    const [isLoadingMusic, setIsLoadingMusic] = useState(false);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        const cachedText = loadJson<string>(STORAGE_KEYS.ttsText, '');
        if (cachedText) setTtsText(cachedText);

        const savedText = localStorage.getItem('bf_tts_text');
        if (savedText) {
            setTtsText(savedText);
            localStorage.removeItem('bf_tts_text');
            toast.success('Script loaded from automation!');
        }

        const cachedPath = loadJson<string>(STORAGE_KEYS.audioPath, '');
        if (cachedPath) setAudioPath(cachedPath);

        const cachedHistory = loadJson<AudioItem[]>(STORAGE_KEYS.audioHistory, []);
        if (cachedHistory.length) {
            setAudioHistory(cachedHistory.map((item) => ({
                ...item,
                createdAt: item.createdAt || new Date().toISOString(),
            })));
        }

        const cachedVoiceId = loadJson<string>(STORAGE_KEYS.ttsVoiceId, '');
        if (cachedVoiceId) setVoiceId(cachedVoiceId);
        const cachedStability = loadJson<number>(STORAGE_KEYS.ttsStability, 0.5);
        setStability(cachedStability);
        const cachedSimilarity = loadJson<number>(STORAGE_KEYS.ttsSimilarity, 0.75);
        setSimilarity(cachedSimilarity);

        const cachedPresets = loadJson<VoicePreset[]>(STORAGE_KEYS.ttsVoicePresets, []);
        if (cachedPresets.length) {
            setVoicePresets(cachedPresets);
        } else {
            const defaults: VoicePreset[] = [
                { id: 'narrator', label: 'Narrator', voiceId: '', stability: 0.6, similarity: 0.75, tags: ['pack'] },
                { id: 'sermon', label: 'Sermon', voiceId: '', stability: 0.55, similarity: 0.8, tags: ['pack'] },
                { id: 'youth', label: 'Youth', voiceId: '', stability: 0.35, similarity: 0.65, tags: ['pack'] },
            ];
            setVoicePresets(defaults);
            saveJson(STORAGE_KEYS.ttsVoicePresets, defaults);
        }
    }, []);
    useEffect(() => {
        saveJson(STORAGE_KEYS.ttsText, ttsText);
    }, [ttsText]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.audioPath, audioPath);
    }, [audioPath]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.ttsVoiceId, voiceId);
    }, [voiceId]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.ttsStability, stability);
    }, [stability]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.ttsSimilarity, similarity);
    }, [similarity]);

    useEffect(() => {
        if (voicePresets.length) {
            saveJson(STORAGE_KEYS.ttsVoicePresets, voicePresets);
        }
    }, [voicePresets]);

    const addToHistory = (path: string, kind: AudioItem['kind'], label?: string) => {
        const item: AudioItem = {
            id: path,
            path,
            kind,
            label,
            createdAt: new Date().toISOString(),
        };
        const next = pushUnique(STORAGE_KEYS.audioHistory, item, (i) => i.id, 30);
        setAudioHistory(next);
    };

    const handleTTS = async () => {
        if (!ttsText.trim()) {
            toast.error('Enter some text first');
            return;
        }

        setIsProcessing(true);
        try {
            const response = await api.post('/api/tts/elevenlabs', {
                text: ttsText,
                voiceId: voiceId || undefined,
                voiceSettings: {
                    stability,
                    similarity_boost: similarity,
                },
            });

            if (response.ok && response.data?.file) {
                setAudioPath(response.data.file);
                addToHistory(response.data.file, 'tts', 'ElevenLabs');
                toast.success('MP3 generated!');
            } else {
                toast.error(response.error || 'TTS generation failed');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleProcessAudio = async () => {
        if (!audioPath.trim()) {
            toast.error('Audio Path is empty');
            return;
        }

        setIsProcessing(true);
        try {
            const response = await api.post('/api/audio/process', {
                inputPath: audioPath,
                preset,
                denoise: { strength: denoise },
                gate: { thresholdDb: gate },
                eq: { highpassHz: highpass, lowpassHz: lowpass },
                compressor: {
                    ratio: compRatio,
                    thresholdDb: compThreshold,
                    attackMs: 12,
                    releaseMs: 150,
                },
                normalize: { targetLUFS: lufs },
                silenceRemove: { enabled: removeSilence },
                deesser: { amount: deesserAmount },
                limiter: { ceilingDb: limiterCeiling },
                presence: { freqHz: presenceFreq, gainDb: presenceGain, widthQ: presenceQ },
            });

            if (response.ok && response.data?.file) {
                setAudioPath(response.data.file);
                addToHistory(response.data.file, 'processed', 'Processed');
                toast.success('Audio processed!');
            } else {
                toast.error(response.error || 'Processing failed');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsProcessing(false);
        }
    };

    const uploadDataUrl = async (dataUrl: string, filename: string, kind: AudioItem['kind']) => {
        setIsUploading(true);
        try {
            const response = await api.post('/api/media/upload-audio', { dataUrl, filename });
            if (response.ok && response.data?.file) {
                setAudioPath(response.data.file);
                addToHistory(response.data.file, kind, filename);
                toast.success('Audio uploaded!');
            } else {
                toast.error(response.error || 'Upload failed');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsUploading(false);
        }
    };

    const handleUploadFile = async (file: File) => {
        const reader = new FileReader();
        reader.onload = async () => {
            const dataUrl = String(reader.result || '');
            if (!dataUrl.startsWith('data:audio/')) {
                toast.error('Please select an audio file');
                return;
            }
            await uploadDataUrl(dataUrl, file.name || 'upload.webm', 'upload');
        };
        reader.readAsDataURL(file);
    };

    const startVisualizer = (stream: MediaStream) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        audioCtxRef.current = audioCtx;
        analyserRef.current = analyser;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const draw = () => {
            rafRef.current = requestAnimationFrame(draw);
            analyser.getByteTimeDomainData(dataArray);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#38bdf8';
            ctx.beginPath();
            const sliceWidth = canvas.width / bufferLength;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = (v * canvas.height) / 2;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
                x += sliceWidth;
            }
            ctx.lineTo(canvas.width, canvas.height / 2);
            ctx.stroke();
        };
        draw();
    };

    const stopVisualizer = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        analyserRef.current = null;
        if (audioCtxRef.current) {
            audioCtxRef.current.close();
            audioCtxRef.current = null;
        }
    };

    const pickMimeType = () => {
        const preferred = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/ogg',
        ];
        for (const type of preferred) {
            if (MediaRecorder.isTypeSupported(type)) return type;
        }
        return '';
    };

    const blobToDataUrl = async (blob: Blob) => {
        if (!blob || blob.size === 0) throw new Error('Empty audio blob');
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
            reader.onerror = () => reject(new Error('Failed to read audio blob'));
            reader.onload = () => resolve(String(reader.result || ''));
            reader.readAsDataURL(blob);
        });
        if (dataUrl && dataUrl.startsWith('data:')) return dataUrl;

        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        const mime = blob.type || 'audio/webm';
        return `data:${mime};base64,${base64}`;
    };

    const handleStartRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            const mimeType = pickMimeType();
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            chunksRef.current = [];
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };
            recorder.onstop = async () => {
                const actualMime = recorder.mimeType || mimeType || 'audio/webm';
                if (chunksRef.current.length === 0) {
                    toast.error('No audio captured');
                    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
                    mediaStreamRef.current = null;
                    return;
                }
                const blob = new Blob(chunksRef.current, { type: actualMime });
                try {
                    const dataUrl = await blobToDataUrl(blob);
                    await uploadDataUrl(dataUrl, 'recording.webm', 'record');
                } catch (err) {
                    toast.error('Invalid dataUrl');
                } finally {
                    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
                    mediaStreamRef.current = null;
                }
            };
            mediaRecorderRef.current = recorder;
            recorder.start(1000);
            startVisualizer(stream);
            setIsRecording(true);
            toast.success('Recording started');
        } catch (error) {
            toast.error('Microphone access denied');
        }
    };

    const handleStopRecording = () => {
        if (!mediaRecorderRef.current) return;
        if (mediaRecorderRef.current.state === 'recording') {
            try {
                mediaRecorderRef.current.requestData();
            } catch { }
            mediaRecorderRef.current.stop();
        }
        stopVisualizer();
        setIsRecording(false);
    };

    const handleUseLatestScript = () => {
        const scripts = loadJson<Script[]>(STORAGE_KEYS.scripts, []);
        const latest = scripts[0];
        if (!latest) {
            toast.error('No scripts found. Generate scripts first.');
            return;
        }
        const fullText = `${latest.hook}\n\n${latest.verse} (${latest.reference})\n\n${latest.reflection}\n\n${latest.cta}`;
        setTtsText(fullText);
        toast.success('Latest script loaded');
    };

    const handleInsertTemplate = () => {
        const template = `Hook line here...\n\nVerse (Reference)\n\nShort reflection/prayer...\n\nCTA (e.g. Save this + follow for more)`;
        setTtsText(template);
    };
    const applyPreset = (presetItem: VoicePreset) => {
        setVoiceId(presetItem.voiceId || '');
        setStability(presetItem.stability);
        setSimilarity(presetItem.similarity);
        toast.success(`Applied preset: ${presetItem.label}`);
    };

    const addPreset = () => {
        const label = presetLabel.trim();
        if (!label) {
            toast.error('Preset label is required');
            return;
        }
        const newPreset: VoicePreset = {
            id: `vp_${Date.now()}`,
            label,
            voiceId: presetVoiceId.trim(),
            stability: presetStability,
            similarity: presetSimilarity,
        };
        const next = [newPreset, ...voicePresets];
        setVoicePresets(next);
        setPresetLabel('');
        setPresetVoiceId('');
        setPresetStability(0.5);
        setPresetSimilarity(0.75);
        toast.success('Preset saved');
    };

    const removePreset = (id: string) => {
        setVoicePresets(voicePresets.filter((p) => p.id !== id));
    };

    const addQuickIds = () => {
        const lines = quickIds
            .split(/\r?\n|,/)
            .map((l) => l.trim())
            .filter(Boolean);
        if (lines.length === 0) return;
        const next = [...voicePresets];
        lines.forEach((line, idx) => {
            const parts = line.includes('|') ? line.split('|') : line.split(':');
            const label = parts.length > 1 ? parts[0].trim() : `Voice ${idx + 1}`;
            const id = parts.length > 1 ? parts[1].trim() : line;
            if (!id) return;
            next.unshift({
                id: `vp_${Date.now()}_${idx}`,
                label,
                voiceId: id,
                stability,
                similarity,
            });
        });
        setVoicePresets(next);
        setQuickIds('');
        toast.success('Voice IDs added');
    };

    const loadVoices = async () => {
        setIsLoadingVoices(true);
        try {
            const res = await api.get('/api/tts/voices');
            if (res.ok && res.data?.voices) {
                setVoices(res.data.voices);
                toast.success('Voices loaded');
            } else {
                toast.error(res.error || 'Failed to load voices');
            }
        } finally {
            setIsLoadingVoices(false);
        }
    };

    const loadMusicLibrary = async () => {
        setIsLoadingMusic(true);
        try {
            const res = await api.get('/api/media/audio-list');
            if (res.ok && res.data?.items) {
                setMusicItems(res.data.items);
                toast.success('Music library loaded');
            } else {
                toast.error(res.error || 'Failed to load music library');
            }
        } finally {
            setIsLoadingMusic(false);
        }
    };

    const useAsSoundtrack = (path: string) => {
        if (!path) return;
        saveJson(STORAGE_KEYS.renderMusicPath, path);
        toast.success('Soundtrack set for Render');
    };

    const currentAudioUrl = toOutputUrl(audioPath, api.baseUrl);

    // Advanced controls
    const [denoise, setDenoise] = useState(0.45);
    const [gate, setGate] = useState(-38);
    const [highpass, setHighpass] = useState(80);
    const [lowpass, setLowpass] = useState(12000);
    const [compRatio, setCompRatio] = useState(3);
    const [compThreshold, setCompThreshold] = useState(-18);
    const [lufs, setLufs] = useState(-16);
    const [removeSilence, setRemoveSilence] = useState(true);
    const [deesserAmount, setDeesserAmount] = useState(0.55);
    const [limiterCeiling, setLimiterCeiling] = useState(-1);
    const [presenceGain, setPresenceGain] = useState(0);
    const [presenceFreq, setPresenceFreq] = useState(4000);
    const [presenceQ, setPresenceQ] = useState(1.0);

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Voice & Audio</h2>

            <div className="space-y-6">
                <div className="flex flex-wrap gap-2">
                    {[
                        { id: 'all', label: 'All' },
                        { id: 'voice', label: 'Voice' },
                        { id: 'record', label: 'Record/Upload' },
                        { id: 'treatment', label: 'Audio Treatment' },
                        { id: 'soundtrack', label: 'Soundtrack' },
                    ].map((tab) => (
                        <Button
                            key={tab.id}
                            variant={activeTab === tab.id ? 'primary' : 'secondary'}
                            className="text-xs h-8"
                            onClick={() => setActiveTab(tab.id as any)}
                        >
                            {tab.label}
                        </Button>
                    ))}
                </div>
                {(activeTab === 'all' || activeTab === 'voice') && (
                <Card title="1. TTS (ElevenLabs)">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Text for voice
                            </label>
                            <Textarea
                                value={ttsText}
                                onChange={(e) => setTtsText(e.target.value)}
                                placeholder="Paste hook + verse + reflection"
                                className="min-h-[180px]"
                            />
                            <div className="mt-2 flex flex-wrap gap-2">
                                <Button onClick={handleUseLatestScript} variant="secondary" className="text-xs h-8">
                                    <Wand2 size={14} className="mr-2" />
                                    Use Latest Script
                                </Button>
                                <Button onClick={handleInsertTemplate} variant="secondary" className="text-xs h-8">
                                    <Clipboard size={14} className="mr-2" />
                                    Insert Template
                                </Button>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                                You can paste any text here: hook, verse, short reflection/prayer, and CTA. Keep it under about 6 short lines for best captions.
                            </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                    Voice ID (optional)
                                </label>
                                <Input
                                    value={voiceId}
                                    onChange={(e) => setVoiceId(e.target.value)}
                                    placeholder="Leave empty to use default voice"
                                />
                                <p className="text-[10px] text-gray-500 mt-1">
                                    Paste a voice ID or load your voices below.
                                </p>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                    Stability ({stability})
                                </label>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={stability}
                                    onChange={(e) => setStability(Number(e.target.value))}
                                    className="w-full accent-primary-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                    Similarity Boost ({similarity})
                                </label>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={similarity}
                                    onChange={(e) => setSimilarity(Number(e.target.value))}
                                    className="w-full accent-primary-500"
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                        <Button variant="secondary" className="text-xs h-8" onClick={loadVoices} isLoading={isLoadingVoices} disabled={!ttsEnabled}>
                            <RefreshCw size={14} className="mr-2" />
                            Load Voices
                        </Button>
                            {voices.length > 0 && (
                                <Select
                                    value={voiceId}
                                    onChange={(e) => setVoiceId(e.target.value)}
                                >
                                    <option value="">Select a voice...</option>
                                    {voices.map((v) => (
                                        <option key={v.voice_id} value={v.voice_id}>
                                            {v.name}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </div>
                        <Button onClick={handleTTS} isLoading={isProcessing} disabled={!ttsEnabled}>
                            Generate MP3 (ElevenLabs)
                        </Button>
                        {!ttsEnabled && (
                            <p className="text-xs text-yellow-600">
                                TTS disabled. Set `ELEVENLABS_API_KEY` in `server/.env`.
                            </p>
                        )}
                    </div>
                </Card>
                )}

                {(activeTab === 'all' || activeTab === 'voice') && (
                <Card title="Voice Presets">
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <Input
                                value={presetLabel}
                                onChange={(e) => setPresetLabel(e.target.value)}
                                placeholder="Preset label (e.g. Narrator)"
                            />
                            <Input
                                value={presetVoiceId}
                                onChange={(e) => setPresetVoiceId(e.target.value)}
                                placeholder="Voice ID (optional)"
                            />
                            <Input
                                type="number"
                                value={presetStability}
                                onChange={(e) => setPresetStability(Number(e.target.value))}
                                step={0.05}
                                min={0}
                                max={1}
                                placeholder="Stability"
                            />
                            <Input
                                type="number"
                                value={presetSimilarity}
                                onChange={(e) => setPresetSimilarity(Number(e.target.value))}
                                step={0.05}
                                min={0}
                                max={1}
                                placeholder="Similarity"
                            />
                        </div>
                        <Button onClick={addPreset} className="text-xs h-8">
                            <Plus size={14} className="mr-2" />
                            Save Preset
                        </Button>

                        <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                            <p className="text-xs text-gray-500">
                                Quick add multiple IDs: one per line. Format: <code>Label|voiceId</code> or just <code>voiceId</code>.
                            </p>
                            <Textarea
                                value={quickIds}
                                onChange={(e) => setQuickIds(e.target.value)}
                                placeholder="Narrator|xxxxxxxx\nSermon|yyyyyyyy\nzzzzzzzz"
                            />
                            <Button variant="secondary" className="text-xs h-8" onClick={addQuickIds}>
                                Add IDs
                            </Button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {voicePresets.map((p) => (
                                <div key={p.id} className="border border-gray-200 rounded-lg p-3 flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-semibold text-gray-800">{p.label}</div>
                                        <div className="text-[10px] text-gray-500">Voice ID: {p.voiceId || 'not set'}</div>
                                        <div className="text-[10px] text-gray-500">Stability {p.stability} • Similarity {p.similarity}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button variant="secondary" className="text-xs h-8" onClick={() => applyPreset(p)}>
                                            Use
                                        </Button>
                                        <Button variant="secondary" className="text-xs h-8" onClick={() => removePreset(p.id)}>
                                            <Trash2 size={14} />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </Card>
                )}
                {(activeTab === 'all' || activeTab === 'record') && (
                <Card title="2. Record / Upload">
                    <div className="space-y-4">
                        <p className="text-sm text-gray-600">
                            Record directly in the browser or upload an audio file. The result is saved to outputs and becomes selectable across Render and Timeline.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {!isRecording ? (
                                <Button onClick={handleStartRecording} className="text-xs h-9">
                                    <Mic size={14} className="mr-2" />
                                    Start Recording
                                </Button>
                            ) : (
                                <Button onClick={handleStopRecording} variant="danger" className="text-xs h-9">
                                    Stop Recording
                                </Button>
                            )}
                            <label className="text-xs h-9 px-4 rounded-lg font-medium transition-all duration-200 bg-gray-200 text-gray-800 hover:bg-gray-300 flex items-center gap-2 cursor-pointer">
                                <Upload size={14} />
                                Upload Audio
                                <input
                                    type="file"
                                    accept="audio/*,.mp3,.wav,.webm,.m4a,.aac,.ogg,.flac"
                                    className="hidden"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleUploadFile(file);
                                    }}
                                    disabled={isUploading}
                                />
                            </label>
                        </div>
                        <div className="mt-4">
                            <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Live Input</p>
                            <canvas ref={canvasRef} width={520} height={80} className="w-full rounded-lg border border-white/10 bg-black/30" />
                        </div>
                    </div>
                </Card>
                )}

                {(activeTab === 'all' || activeTab === 'treatment') && (
                <Card title="3. Audio Treatment">
                    <p className="text-sm text-gray-600 mb-4">
                        Choose a preset, then tweak controls. Click <strong>Process Audio</strong> to generate a
                        cleaned MP3 and auto-fill Audio Path.
                    </p>

                    <div className="mb-4">
                        <button
                            onClick={() => setShowGuide((v) => !v)}
                            className="flex items-center gap-2 text-xs text-primary-600"
                        >
                            {showGuide ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            Audio Treatment Guide
                        </button>
                        {showGuide && (
                            <div className="mt-3 text-xs text-gray-600 space-y-2">
                                <p><strong>Preset:</strong> quick starting point. Use Clean Voice for most narration.</p>
                                <p><strong>Denoise:</strong> reduces background noise. 0.2 to 0.6 is typical.</p>
                                <p><strong>Gate (dB):</strong> mutes low-level noise between phrases. More negative = gentler.</p>
                                <p><strong>Highpass:</strong> removes rumble (60 to 120Hz for voice).</p>
                                <p><strong>Lowpass:</strong> removes hiss (10 to 14kHz for voice).</p>
                                <p><strong>Comp Ratio/Threshold:</strong> smooths peaks. Higher ratio = tighter dynamics.</p>
                                <p><strong>LUFS:</strong> loudness target. -16 is good for social; -14 is punchier.</p>
                                <p><strong>Remove Silence:</strong> trims dead air for tighter pacing.</p>
                                <p><strong>De-esser:</strong> reduces harsh s sounds (0.3 to 0.7 typical).</p>
                                <p><strong>Limiter:</strong> catches peaks to avoid clipping (ceiling around -1dB).</p>
                                <p><strong>Presence Boost:</strong> adds clarity around 3 to 5kHz if voice sounds dull.</p>
                                <p className="text-[10px] text-gray-500">
                                    Pro effects we can add next: multiband EQ, expander, saturation, room removal, and breath control.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Preset</label>
                            <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
                                <option value="clean_voice">Clean voice (recommended)</option>
                                <option value="podcast">Podcast (louder)</option>
                                <option value="warm">Warm (softer)</option>
                                <option value="raw">Raw (no processing)</option>
                            </Select>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                    Denoise (0-1)
                                </label>
                                <Input
                                    type="number"
                                    value={denoise}
                                    onChange={(e) => setDenoise(Number(e.target.value))}
                                    step={0.05}
                                    min={0}
                                    max={1}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                    Gate (dB)
                                </label>
                                <Input
                                    type="number"
                                    value={gate}
                                    onChange={(e) => setGate(Number(e.target.value))}
                                    step={1}
                                    min={-70}
                                    max={-10}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                    Highpass (Hz)
                                </label>
                                <Input
                                    type="number"
                                    value={highpass}
                                    onChange={(e) => setHighpass(Number(e.target.value))}
                                    step={10}
                                    min={0}
                                    max={300}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                    Lowpass (Hz)
                                </label>
                                <Input
                                    type="number"
                                    value={lowpass}
                                    onChange={(e) => setLowpass(Number(e.target.value))}
                                    step={500}
                                    min={2000}
                                    max={20000}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                    Comp Ratio
                                </label>
                                <Input
                                    type="number"
                                    value={compRatio}
                                    onChange={(e) => setCompRatio(Number(e.target.value))}
                                    step={0.2}
                                    min={1}
                                    max={10}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                    Comp Threshold (dB)
                                </label>
                                <Input
                                    type="number"
                                    value={compThreshold}
                                    onChange={(e) => setCompThreshold(Number(e.target.value))}
                                    step={1}
                                    min={-40}
                                    max={-5}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                    LUFS Target
                                </label>
                                <Input
                                    type="number"
                                    value={lufs}
                                    onChange={(e) => setLufs(Number(e.target.value))}
                                    step={1}
                                    min={-23}
                                    max={-10}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                    Remove Silence
                                </label>
                                <Select
                                    value={removeSilence ? 'true' : 'false'}
                                    onChange={(e) => setRemoveSilence(e.target.value === 'true')}
                                >
                                    <option value="true">Yes</option>
                                    <option value="false">No</option>
                                </Select>
                            </div>
                        </div>

                        <div className="pt-2">
                            <button
                                onClick={() => setShowAdvanced((v) => !v)}
                                className="text-xs text-primary-600 flex items-center gap-2"
                            >
                                {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                Advanced Effects
                            </button>
                            {showAdvanced && (
                                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">
                                            De-esser (0-1)
                                        </label>
                                        <Input
                                            type="number"
                                            value={deesserAmount}
                                            onChange={(e) => setDeesserAmount(Number(e.target.value))}
                                            step={0.05}
                                            min={0}
                                            max={1}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">
                                            Limiter Ceiling (dB)
                                        </label>
                                        <Input
                                            type="number"
                                            value={limiterCeiling}
                                            onChange={(e) => setLimiterCeiling(Number(e.target.value))}
                                            step={0.5}
                                            min={-6}
                                            max={0}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">
                                            Presence Boost (dB)
                                        </label>
                                        <Input
                                            type="number"
                                            value={presenceGain}
                                            onChange={(e) => setPresenceGain(Number(e.target.value))}
                                            step={0.5}
                                            min={0}
                                            max={6}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">
                                            Presence Freq (Hz)
                                        </label>
                                        <Input
                                            type="number"
                                            value={presenceFreq}
                                            onChange={(e) => setPresenceFreq(Number(e.target.value))}
                                            step={100}
                                            min={2000}
                                            max={8000}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">
                                            Presence Q
                                        </label>
                                        <Input
                                            type="number"
                                            value={presenceQ}
                                            onChange={(e) => setPresenceQ(Number(e.target.value))}
                                            step={0.1}
                                            min={0.5}
                                            max={3}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <Button onClick={handleProcessAudio} isLoading={isProcessing}>
                            Process Audio
                        </Button>
                    </div>
                </Card>
                )}

                {(activeTab === 'all' || activeTab === 'treatment') && (
                <Card title="Current Audio">
                    <Input
                        value={audioPath}
                        onChange={(e) => setAudioPath(e.target.value)}
                        placeholder="e.g. server/outputs/audio.mp3"
                    />
                    <p className="text-sm text-gray-500 mt-2">
                        This path will be used in the Render and Timeline pages.
                    </p>
                    {currentAudioUrl && (
                        <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                            <audio controls src={currentAudioUrl} className="w-full" />
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    navigator.clipboard.writeText(audioPath);
                                    toast.success('Audio path copied');
                                }}
                                className="text-xs h-9"
                            >
                                <Clipboard size={14} className="mr-2" />
                                Copy
                            </Button>
                        </div>
                    )}
                </Card>
                )}

                {(activeTab === 'all' || activeTab === 'treatment') && (
                <Card title="Recent Audio (Saved)">
                    {audioHistory.length === 0 ? (
                        <p className="text-sm text-gray-500">No processed or uploaded audio yet.</p>
                    ) : (
                        <div className="space-y-3">
                            {(showAllRecent ? audioHistory : audioHistory.slice(0, 6)).map((item) => (
                                <div
                                    key={item.id}
                                    className="flex flex-col md:flex-row md:items-center gap-3 bg-gray-50 rounded-lg p-3"
                                >
                                    <div className="flex-1">
                                        <p className="text-xs text-gray-600 uppercase tracking-wider">
                                            {item.kind}
                                        </p>
                                        <p className="text-sm font-mono text-gray-800 break-all">{item.path}</p>
                                        <p className="text-[10px] text-gray-500 mt-1">
                                            {new Date(item.createdAt).toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="secondary"
                                            className="text-xs h-8"
                                            onClick={() => setAudioPath(item.path)}
                                        >
                                            <Play size={14} className="mr-2" />
                                            Use
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            className="text-xs h-8"
                                            onClick={() => {
                                                navigator.clipboard.writeText(item.path);
                                                toast.success('Copied');
                                            }}
                                        >
                                            <Clipboard size={14} className="mr-2" />
                                            Copy
                                        </Button>
                                    </div>
                                    <audio controls src={toOutputUrl(item.path, api.baseUrl)} className="w-full md:w-64" />
                                </div>
                            ))}
                            {audioHistory.length > 6 && (
                                <Button
                                    variant="secondary"
                                    className="text-xs h-8"
                                    onClick={() => setShowAllRecent((v) => !v)}
                                >
                                    {showAllRecent ? 'Collapse list' : `Show all (${audioHistory.length})`}
                                </Button>
                            )}
                        </div>
                    )}
                </Card>
                )}

                {(activeTab === 'all' || activeTab === 'soundtrack') && (
                <Card title="Soundtrack Library">
                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                variant="secondary"
                                className="text-xs h-8"
                                onClick={loadMusicLibrary}
                                isLoading={isLoadingMusic}
                            >
                                <Music size={14} className="mr-2" />
                                Load Music Library
                            </Button>
                            <span className="text-[10px] text-gray-500">
                                Use any audio file from outputs as a soundtrack for Render.
                            </span>
                        </div>

                        {musicItems.length > 0 ? (
                            <div className="space-y-3">
                                {musicItems.slice(0, 20).map((item: any) => (
                                    <div key={item.path || item.name} className="flex flex-col md:flex-row md:items-center gap-3 bg-gray-50 rounded-lg p-3">
                                        <div className="flex-1">
                                            <p className="text-xs text-gray-600 uppercase tracking-wider">{item.name || 'Audio'}</p>
                                            <p className="text-xs font-mono text-gray-800 break-all">{item.path}</p>
                                            {item.mtime && (
                                                <p className="text-[10px] text-gray-500 mt-1">{new Date(item.mtime).toLocaleString()}</p>
                                            )}
                                        </div>
                                        <audio controls src={toOutputUrl(item.path, api.baseUrl)} className="w-full md:w-64" />
                                        <Button
                                            variant="secondary"
                                            className="text-xs h-8"
                                            onClick={() => useAsSoundtrack(item.path)}
                                        >
                                            Use in Render
                                        </Button>
                                    </div>
                                ))}
                                {musicItems.length > 20 && (
                                    <p className="text-[10px] text-gray-500">Showing latest 20 items.</p>
                                )}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500">No audio files found. Upload or process audio first.</p>
                        )}
                    </div>
                </Card>
                )}
            </div>
        </div>
    );
}
