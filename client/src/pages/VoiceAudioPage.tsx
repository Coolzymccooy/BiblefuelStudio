import { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Textarea } from '../components/ui/Textarea';
import { Select } from '../components/ui/Select';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

export function VoiceAudioPage() {
    const [ttsText, setTtsText] = useState('');
    const [audioPath, setAudioPath] = useState('');
    const [preset, setPreset] = useState('clean_voice');

    useEffect(() => {
        const savedText = localStorage.getItem('bf_tts_text');
        if (savedText) {
            setTtsText(savedText);
            localStorage.removeItem('bf_tts_text');
            toast.success('Script loaded from automation!');
        }
    }, []);

    // Advanced controls
    const [denoise, setDenoise] = useState(0.45);
    const [gate, setGate] = useState(-38);
    const [highpass, setHighpass] = useState(80);
    const [lowpass, setLowpass] = useState(12000);
    const [compRatio, setCompRatio] = useState(3);
    const [compThreshold, setCompThreshold] = useState(-18);
    const [lufs, setLufs] = useState(-16);
    const [removeSilence, setRemoveSilence] = useState(true);

    const [isProcessing, setIsProcessing] = useState(false);

    const handleTTS = async () => {
        if (!ttsText.trim()) {
            toast.error('Enter some text first');
            return;
        }

        setIsProcessing(true);
        try {
            const response = await api.post('/api/tts/elevenlabs', { text: ttsText });

            if (response.ok && response.data?.file) {
                setAudioPath(response.data.file);
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
            });

            if (response.ok && response.data?.file) {
                setAudioPath(response.data.file);
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

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Voice & Audio</h2>

            <div className="space-y-6">
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
                            />
                        </div>
                        <Button onClick={handleTTS} isLoading={isProcessing}>
                            Generate MP3 (ElevenLabs)
                        </Button>
                    </div>
                </Card>

                <Card title="2. Record / Upload (Coming Soon)">
                    <p className="text-sm text-gray-600">
                        Browser recording and file upload features will be added in a future update.
                        For now, use TTS or manually place files in the outputs folder.
                    </p>
                </Card>

                <Card title="3. Audio Treatment (Mini-Audacity)">
                    <p className="text-sm text-gray-600 mb-4">
                        Choose a preset, then tweak controls. Click <strong>Process Audio</strong> to generate a
                        cleaned MP3 and auto-fill Audio Path.
                    </p>

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

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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

                        <Button onClick={handleProcessAudio} isLoading={isProcessing}>
                            Process Audio
                        </Button>
                    </div>
                </Card>

                <Card title="Current Audio Path">
                    <Input
                        value={audioPath}
                        onChange={(e) => setAudioPath(e.target.value)}
                        placeholder="e.g. server/outputs/audio.mp3"
                    />
                    <p className="text-sm text-gray-500 mt-2">
                        This path will be used in the Render and Timeline pages
                    </p>
                </Card>
            </div>
        </div>
    );
}
