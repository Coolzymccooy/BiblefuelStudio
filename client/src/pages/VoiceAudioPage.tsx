
import { useEffect, useRef, useState } from 'react';
import { EditorShell } from '../components/editor/EditorShell';
import { PanelSection } from '../components/editor/PanelSection';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Textarea } from '../components/ui/Textarea';
import { Select } from '../components/ui/Select';
import { Field } from '../components/ui/Field';
import { InfoTooltip } from '../components/ui/InfoTooltip';
import { DropZone } from '../components/ui/DropZone';
import { GuideSteps } from '../components/ui/GuideSteps';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { AnimationPicker } from '../components/voicelab/AnimationPicker';
import { CompareVoices } from '../components/voicelab/CompareVoices';
import { VoicePlayer } from '../components/voicelab/VoicePlayer';
import { RevealSection } from '../components/voice-audio/RevealSection';
import { CreateVoiceHero } from '../components/voice-audio/CreateVoiceHero';
import { api, GENERATE_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from '../lib/api';
import toast from 'react-hot-toast';
import { loadJson, pushUnique, saveJson, STORAGE_KEYS, toOutputUrl } from '../lib/storage';
import { useConfig } from '../lib/config';
import { useVoiceSynthesisDefaults } from '../lib/voiceSynthesisDefaults';
import { ApiError } from '../lib/apiError';
import { toastError } from '../lib/errors';
import { cleanSpeakableText } from '../lib/speakableScript';
import { Link } from 'react-router-dom';
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
    CheckCircle2,
    ArrowRight,
  SlidersHorizontal,
  Users,
  History as HistoryIcon,
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

type AudioPresetValues = {
    denoise: number;
    gate: number;
    highpass: number;
    lowpass: number;
    compRatio: number;
    compThreshold: number;
    lufs: number;
    removeSilence: boolean;
};

const AUDIO_PRESET_DEFAULTS: Record<string, AudioPresetValues> = {
    clean_voice: {
        denoise: 0.45,
        gate: -38,
        highpass: 80,
        lowpass: 12000,
        compRatio: 3,
        compThreshold: -18,
        lufs: -16,
        removeSilence: false,
    },
    podcast: {
        denoise: 0.35,
        gate: -40,
        highpass: 70,
        lowpass: 14000,
        compRatio: 4,
        compThreshold: -20,
        lufs: -14,
        removeSilence: false,
    },
    warm: {
        denoise: 0.30,
        gate: -42,
        highpass: 70,
        lowpass: 10000,
        compRatio: 2.6,
        compThreshold: -19,
        lufs: -16,
        removeSilence: false,
    },
    raw: {
        denoise: 0,
        gate: -70,
        highpass: 0,
        lowpass: 20000,
        compRatio: 1,
        compThreshold: -40,
        lufs: -16,
        removeSilence: false,
    },
};

type TTSProvider = 'elevenlabs' | 'azure' | 'fish' | 'edge' | 'chatterbox';

type LabTabId = 'generate' | 'record' | 'treat' | 'music' | 'clone' | 'compare' | 'animation' | 'takes';

/** A take the Timeline can land on its voice-over lane. */
export interface VoiceTake {
    path: string;
    label: string;
    durationSec?: number;
}

/**
 * Embedded mode: the whole lab docked inside another editor (the Timeline
 * Voice tool). Every control block is the SAME one classic renders, so the
 * two surfaces cannot drift and the parity gate covers both.
 */
export interface VoiceLabEmbed {
    /** Script handed over from the Script tool ("Voice this"). */
    seedText?: string;
    /** Landing needs a documentary timeline to have a lane to land on. */
    hasProject: boolean;
    onLandVoiceover: (take: VoiceTake) => void;
    /** Next step after a take has landed: the Output tool. */
    onNext: () => void;
}

export function VoiceAudioPage() {
    return <VoiceLab />;
}

export function VoiceLab({ embedded }: { embedded?: VoiceLabEmbed } = {}) {
    const { config } = useConfig();
    const ttsEnabled = config.features.tts;
    const elevenlabsAvailable = config.features.elevenlabs !== false;
    const edgeAvailable = config.features.edgeTts !== false;
    const [chatterboxAvailable, setChatterboxAvailable] = useState(false);
    const [azureAvailable, setAzureAvailable] = useState(false);
    const [fishAvailable, setFishAvailable] = useState(false);
    // Server-provided diagnostic for greyed-out providers ("AZURE_SPEECH_KEY
    // env var not set", "FISH_API_KEY still placeholder", …). Drives the
    // tooltip on disabled buttons so users see EXACTLY what's missing
    // instead of just an opaque disabled state.
    const [azureReason, setAzureReason] = useState<string>('');
    const [fishReason, setFishReason] = useState<string>('');
    const [voiceDefaults] = useVoiceSynthesisDefaults();
    const [ttsText, setTtsText] = useState('');
    const [audioPath, setAudioPath] = useState('');
    // Embedded: which lab tab is open, and whether a take has landed (gates Next).
    const [labTab, setLabTab] = useState<LabTabId>('generate');
    const [landed, setLanded] = useState(false);
    useEffect(() => {
        if (embedded?.seedText) setTtsText(embedded.seedText);
    }, [embedded?.seedText]);
    // Editor layout, mirroring Timeline and Render. Classic stays the fallback.
    const [editorLayout, setEditorLayout] = useState<boolean>(
        () => loadJson<boolean>('bf.voice.editorLayout', false),
    );
    useEffect(() => { saveJson('bf.voice.editorLayout', editorLayout); }, [editorLayout]);
    const [preset, setPreset] = useState('clean_voice');
    const [audioHistory, setAudioHistory] = useState<AudioItem[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    // Tracks when the current TTS call started so the chatterbox progress
    // indicator can show elapsed/projected time. null when no call is in
    // flight.
    const [ttsStartedAt, setTtsStartedAt] = useState<number | null>(null);
    const [elapsedTick, setElapsedTick] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [showGuide, setShowGuide] = useState(true);
    const [showAllRecent, setShowAllRecent] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [recordingDebug, setRecordingDebug] = useState('');
    // Provider — ElevenLabs (premium, paid, voice cloning) or Edge-TTS (free
    // Microsoft neural voices, no key required). Per-provider voiceId so
    // switching providers doesn't clobber the other one's choice.
    const [provider, setProvider] = useState<TTSProvider>('elevenlabs');
    const [voiceId, setVoiceId] = useState('');
    const [edgeVoiceId, setEdgeVoiceId] = useState('');
    const [stability, setStability] = useState(0.5);
    const [similarity, setSimilarity] = useState(0.75);
    // Chatterbox controls. audio_prompt_path is sent through the generic
    // voiceId field; exaggeration/cfg_weight are forwarded as voiceSettings.
    const [chatterboxAudioPrompt, setChatterboxAudioPrompt] = useState('');
    const [chatterboxStyle, setChatterboxStyle] = useState(0.5);
    const [chatterboxCfg, setChatterboxCfg] = useState(0.5);
    const [voicePresets, setVoicePresets] = useState<VoicePreset[]>([]);
    const [presetLabel, setPresetLabel] = useState('');
    const [presetVoiceId, setPresetVoiceId] = useState('');
    const [presetStability, setPresetStability] = useState(0.5);
    const [presetSimilarity, setPresetSimilarity] = useState(0.75);
    const [quickIds, setQuickIds] = useState('');
    const [voices, setVoices] = useState<ElevenVoice[]>([]);
    const [isLoadingVoices, setIsLoadingVoices] = useState(false);
    const [isCloningVoice, setIsCloningVoice] = useState(false);
    const [cloneProvider, setCloneProvider] = useState<'elevenlabs' | 'chatterbox'>('elevenlabs');
    type ChatterboxVoice = { id: string; name: string; description?: string; refPath: string; refFilename?: string; createdAt: string };
    const [chatterboxVoices, setChatterboxVoices] = useState<ChatterboxVoice[]>([]);
    const [cloneVoiceName, setCloneVoiceName] = useState('');
    const [cloneVoiceDescription, setCloneVoiceDescription] = useState('');
    const [cloneSamplePath, setCloneSamplePath] = useState('');
    const [cloneHasRights, setCloneHasRights] = useState(false);
    const [cloneNoImpersonation, setCloneNoImpersonation] = useState(false);
    const [cloneTermsAccepted, setCloneTermsAccepted] = useState(false);
    const [musicItems, setMusicItems] = useState<any[]>([]);
    const [isLoadingMusic, setIsLoadingMusic] = useState(false);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
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
        const cachedEdgeVoiceId = loadJson<string>(STORAGE_KEYS.ttsEdgeVoiceId, '');
        if (cachedEdgeVoiceId) setEdgeVoiceId(cachedEdgeVoiceId);
        const cachedProvider = loadJson<TTSProvider>(STORAGE_KEYS.ttsProvider, 'elevenlabs');
        if (['edge', 'elevenlabs', 'chatterbox', 'azure', 'fish'].includes(cachedProvider)) {
            setProvider(cachedProvider);
        }
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
        saveJson(STORAGE_KEYS.ttsEdgeVoiceId, edgeVoiceId);
    }, [edgeVoiceId]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.ttsProvider, provider);
    }, [provider]);

    // Probe the voice engine once for Chatterbox availability — gates the
    // third provider button. With ?probe=1 the server actually pings the
    // bridge's /health endpoint (TTL-cached), so a self-hosted Chatterbox
    // that's down right now shows as unreachable instead of just
    // "configured". Chatterbox is on iff configured AND reachable.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const res = await api.get<{ ok: boolean; providers: Record<string, { available: boolean; reachable?: boolean; reason?: string }> }>(
                '/api/tts/providers?probe=1',
            );
            if (cancelled) return;
            const providers = res.data?.providers || {};
            const chatterbox = providers.chatterbox;
            const isUp = Boolean(
                res.ok && chatterbox?.available && (chatterbox?.reachable !== false),
            );
            setChatterboxAvailable(isUp);
            // Azure / Fish are cloud key-based — "available" (env configured) is
            // enough; no reachability probe needed.
            setAzureAvailable(Boolean(res.ok && providers.azure?.available));
            setFishAvailable(Boolean(res.ok && providers.fish?.available));
            // Capture the reason for unavailability so disabled buttons can
            // tell the user what's missing on hover. Cleared when available.
            setAzureReason(providers.azure?.available ? '' : (providers.azure?.reason || ''));
            setFishReason(providers.fish?.available ? '' : (providers.fish?.reason || ''));
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // Reset the loaded voices list whenever provider changes so the picker
    // doesn't show stale entries from the other provider.
    useEffect(() => {
        setVoices([]);
    }, [provider]);

    // Load per-user Chatterbox clones once on mount. Chatterbox "voices" are
    // reference-WAV aliases stored server-side; the user sees them as a saved
    // list under Voice Clone and can click "Use" to drop the alias into the
    // TTS Voice ID field.
    const loadChatterboxVoices = async () => {
        const res = await api.get<{ ok: boolean; voices: ChatterboxVoice[] }>('/api/tts/chatterbox-voices');
        if (res.ok && Array.isArray(res.data?.voices)) {
            setChatterboxVoices(res.data.voices);
        }
    };
    useEffect(() => {
        void loadChatterboxVoices();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const deleteChatterboxVoice = async (id: string) => {
        const res = await api.delete(`/api/tts/chatterbox-voices/${encodeURIComponent(id)}`);
        if (res.ok) {
            setChatterboxVoices((curr) => curr.filter((v) => v.id !== id));
            toast.success('Cloned voice removed');
        } else {
            toast.error(res.error || 'Failed to delete cloned voice');
        }
    };

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

    useEffect(() => {
        if (!cloneSamplePath && audioPath) {
            setCloneSamplePath(audioPath);
        }
    }, [audioPath, cloneSamplePath]);

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

    // Tick the elapsed counter once a second while a TTS call is in flight.
    // Used by the chatterbox ETA indicator — chatterbox inference is slow
    // (10-90s typical) and a static spinner with no time feedback feels
    // broken. Edge-TTS / ElevenLabs finish in 1-3s so the indicator never
    // gets a chance to render for them.
    useEffect(() => {
        if (!ttsStartedAt) return;
        const id = setInterval(() => setElapsedTick((t) => t + 1), 1000);
        return () => clearInterval(id);
    }, [ttsStartedAt]);

    const handleTTS = async () => {
        const formattedTtsText = cleanSpeakableText(ttsText);
        if (!formattedTtsText.trim()) {
            toast.error('Enter some text first');
            return;
        }
        if (formattedTtsText !== ttsText) setTtsText(formattedTtsText);

        setIsProcessing(true);
        setTtsStartedAt(Date.now());
        setElapsedTick(0);
        try {
            let url: string;
            let payload: Record<string, unknown>;
            let providerLabel: string;

            if (voiceDefaults.enabled) {
                // Voice Synthesis defaults are enabled → route through the
                // category orchestrator so the profile picks the voice,
                // settings, and forced-alignment fallback automatically.
                url = '/api/tts/synthesize-category';
                payload = {
                    text: formattedTtsText,
                    category: voiceDefaults.category,
                    preferredProvider: voiceDefaults.providerOverride || undefined,
                    withTimestamps: true,
                    overrides: {
                        forcedAlignmentFallback: voiceDefaults.cinematicMode,
                    },
                };
                providerLabel = `Voice Synthesis · ${voiceDefaults.category}`;
            } else if (provider === 'edge') {
                url = '/api/tts/edge';
                payload = { text: formattedTtsText, voiceId: edgeVoiceId || undefined };
                providerLabel = 'Edge-TTS';
            } else if (provider === 'chatterbox') {
                url = '/api/tts/chatterbox';
                payload = {
                    text: formattedTtsText,
                    voiceId: chatterboxAudioPrompt.trim() || undefined,
                    exaggeration: typeof chatterboxStyle === 'number' ? chatterboxStyle : undefined,
                    cfgWeight: typeof chatterboxCfg === 'number' ? chatterboxCfg : undefined,
                };
                providerLabel = 'Chatterbox';
            } else if (provider === 'azure') {
                // Azure voice id is an Azure voice name (e.g. en-US-GuyNeural);
                // blank → server default (AZURE_SPEECH_VOICE). withTimestamps gives
                // the word-alignment contract back for kinetic captions.
                url = '/api/tts/azure';
                payload = { text: formattedTtsText, voiceId: voiceId || undefined, withTimestamps: true };
                providerLabel = 'Azure Speech';
            } else if (provider === 'fish') {
                // Fish voice id is a reference_id; blank → FISH_DEFAULT_REFERENCE_ID.
                url = '/api/tts/fish';
                payload = { text: formattedTtsText, voiceId: voiceId || undefined };
                providerLabel = 'Fish Audio';
            } else {
                url = '/api/tts/elevenlabs';
                payload = {
                    text: formattedTtsText,
                    voiceId: voiceId || undefined,
                    voiceSettings: { stability, similarity_boost: similarity },
                };
                providerLabel = 'ElevenLabs';
            }

            const response = await api.post(url, payload, undefined, { timeout: GENERATE_TIMEOUT_MS });

            if (response.ok && response.data?.file) {
                setAudioPath(response.data.file);
                // When the server falls back (e.g. Chatterbox 500 → Edge-TTS),
                // it returns `fallbackProvider` so we can show what actually
                // produced the audio instead of misleading the user.
                const actualProvider = response.data.fallbackProvider as string | undefined;
                const actualLabel = actualProvider === 'edge'
                    ? 'Edge-TTS'
                    : actualProvider === 'elevenlabs'
                        ? 'ElevenLabs'
                        : actualProvider === 'chatterbox'
                            ? 'Chatterbox'
                            : actualProvider === 'azure'
                                ? 'Azure Speech'
                                : actualProvider === 'fish'
                                    ? 'Fish Audio'
                                    : providerLabel;
                addToHistory(response.data.file, 'tts', actualLabel);
                if (actualProvider && actualProvider !== provider) {
                    toast.success(`${providerLabel} was unavailable — delivered via ${actualLabel}`);
                } else {
                    toast.success(`Generated via ${providerLabel}`);
                }
            } else {
                toast.error(response.error || 'TTS generation failed');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsProcessing(false);
            setTtsStartedAt(null);
        }
    };

    const handleProcessAudio = async () => {
        if (!audioPath.trim()) {
            toast.error('Audio Path is empty');
            return;
        }

        setIsProcessing(true);
        try {
            const payload: Record<string, any> = {
                inputPath: audioPath,
                preset,
            };

            if (preset !== 'raw') {
                payload.denoise = { strength: denoise };
                payload.gate = { thresholdDb: gate };
                payload.eq = { highpassHz: highpass, lowpassHz: lowpass };
                payload.compressor = {
                    ratio: compRatio,
                    thresholdDb: compThreshold,
                    attackMs: 12,
                    releaseMs: 150,
                };
                payload.normalize = { targetLUFS: lufs };
                payload.silenceRemove = { enabled: removeSilence };
            }

            if (showAdvanced && deesserAmount > 0) {
                payload.deesser = { amount: deesserAmount };
            }
            if (showAdvanced && limiterCeiling < 0) {
                payload.limiter = { ceilingDb: limiterCeiling };
            }
            if (showAdvanced && presenceGain !== 0) {
                payload.presence = { freqHz: presenceFreq, gainDb: presenceGain, widthQ: presenceQ };
            }

            const response = await api.post('/api/audio/process', payload, undefined, { timeout: GENERATE_TIMEOUT_MS });

            if (response.ok && response.data?.file) {
                setAudioPath(response.data.file);
                addToHistory(response.data.file, 'processed', 'Processed');
                toast.success('Audio processed!');
            } else {
                // Surface ffmpeg + audio pipeline failures through the friendly
                // translator so users don't see raw exit codes like
                // "ffmpeg failed: 4294967262".
                const payload = (response.data as Record<string, unknown>) || {};
                const code = String(payload.error || response.error || 'FFMPEG_FAILED');
                toastError(new ApiError(code, code, payload));
            }
        } catch (error) {
            toastError(error);
        } finally {
            setIsProcessing(false);
        }
    };

    const uploadBlob = async (blob: Blob, filename: string, kind: AudioItem['kind']) => {
        setIsUploading(true);
        try {
            // Raw binary streaming — no base64 inflation, constant server memory.
            const response = await api.uploadRaw('/api/media/upload-audio', blob, {
                filename,
                timeout: UPLOAD_TIMEOUT_MS,
            });
            if (response.ok && response.data?.file) {
                setAudioPath(response.data.file);
                addToHistory(response.data.file, kind, filename);
                toast.success('Audio uploaded!');
                return { ok: true as const, file: response.data.file as string };
            } else {
                const error = response.error || 'Upload failed';
                toast.error(error);
                return { ok: false as const, error };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'An error occurred';
            toast.error(message);
            return { ok: false as const, error: message };
        } finally {
            setIsUploading(false);
        }
    };

    const handleUploadFile = async (file: File) => {
        const looksAudio = (file.type || '').startsWith('audio/')
            || /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(file.name || '');
        if (!looksAudio) {
            toast.error('Please select an audio file');
            return;
        }
        await uploadBlob(file, file.name || 'upload.webm', 'upload');
    };

    const startVisualizer = async (stream: MediaStream) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const targetWidth = Math.max(520, Math.floor((rect.width || 520) * dpr));
        const targetHeight = Math.max(80, Math.floor(96 * dpr));
        if (canvas.width !== targetWidth) canvas.width = targetWidth;
        if (canvas.height !== targetHeight) canvas.height = targetHeight;

        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.85;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        audioCtxRef.current = audioCtx;
        analyserRef.current = analyser;
        sourceNodeRef.current = source;

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

            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                const v = (dataArray[i] - 128) / 128;
                sum += v * v;
            }
            const rms = Math.sqrt(sum / bufferLength);
            const boost = Math.min(4, Math.max(1, 1.5 + rms * 8));

            ctx.lineWidth = 2.2;
            ctx.strokeStyle = rms > 0.02 ? '#38bdf8' : '#0ea5e9';
            ctx.beginPath();
            const sliceWidth = canvas.width / bufferLength;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const centered = ((dataArray[i] - 128) / 128) * boost;
                const y = (canvas.height / 2) + centered * (canvas.height * 0.32);
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
        if (sourceNodeRef.current) {
            sourceNodeRef.current.disconnect();
            sourceNodeRef.current = null;
        }
        if (audioCtxRef.current) {
            audioCtxRef.current.close();
            audioCtxRef.current = null;
        }
    };

    const cleanupRecordingResources = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            try { mediaRecorderRef.current.stop(); } catch (_err) { /* no-op */ }
        }
        mediaRecorderRef.current = null;
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        chunksRef.current = [];
        stopVisualizer();
        setIsRecording(false);
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

    const handleStartRecording = async () => {
        if (isRecording || (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording')) {
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            const mimeType = pickMimeType();
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            setRecordingDebug('');
            chunksRef.current = [];
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };
            recorder.onstop = async () => {
                setIsRecording(false);
                const actualMime = recorder.mimeType || mimeType || 'audio/webm';
                if (chunksRef.current.length === 0) {
                    toast.error('No audio captured');
                    setRecordingDebug('No chunks captured from MediaRecorder.');
                    cleanupRecordingResources();
                    return;
                }
                const blob = new Blob(chunksRef.current, { type: actualMime });
                setRecordingDebug(`Captured ${chunksRef.current.length} chunk(s), ${blob.size} bytes, mime=${actualMime}`);
                try {
                    if (!blob || blob.size === 0) throw new Error('Empty audio blob');
                    const ext =
                        actualMime.includes('ogg') ? 'ogg' :
                            actualMime.includes('wav') ? 'wav' :
                                actualMime.includes('mp4') ? 'm4a' : 'webm';
                    const upload = await uploadBlob(blob, `recording-${Date.now()}.${ext}`, 'record');
                    if (!upload.ok) {
                        return;
                    }
                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Recording upload failed';
                    toast.error(message);
                } finally {
                    cleanupRecordingResources();
                }
            };
            mediaRecorderRef.current = recorder;
            recorder.start(250);
            await startVisualizer(stream);
            setIsRecording(true);
            toast.success('Recording started');
        } catch (error) {
            cleanupRecordingResources();
            const message = error instanceof Error ? error.message : 'Microphone access denied';
            toast.error(message);
        }
    };

    const handleStopRecording = () => {
        const recorder = mediaRecorderRef.current;
        if (!recorder) return;
        if (recorder.state === 'recording') {
            recorder.stop();
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

    const handleFormatForVoice = () => {
        const next = cleanSpeakableText(ttsText);
        setTtsText(next);
        toast.success('Formatted for voice');
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
            const res = await api.get(`/api/tts/voices?provider=${provider}`);
            if (res.ok && res.data?.voices) {
                setVoices(res.data.voices);
                toast.success(`Loaded ${res.data.voices.length} ${provider === 'edge' ? 'Edge' : 'ElevenLabs'} voices`);
            } else {
                toast.error(res.error || 'Failed to load voices');
            }
        } finally {
            setIsLoadingVoices(false);
        }
    };

    const handleCloneVoice = async () => {
        // Per-provider availability gating. ElevenLabs needs an API key (ttsEnabled
        // reflects that); Chatterbox needs CHATTERBOX_URL set + the bridge reachable.
        if (cloneProvider === 'elevenlabs' && !ttsEnabled) {
            toast.error('ElevenLabs is disabled. Add ELEVENLABS_API_KEY first.');
            return;
        }
        if (cloneProvider === 'chatterbox' && !chatterboxAvailable) {
            toast.error('Chatterbox bridge is unreachable. Check CHATTERBOX_URL and that the bridge is running.');
            return;
        }
        if (!cloneVoiceName.trim()) {
            toast.error('Enter a clone voice name');
            return;
        }
        const sample = (cloneSamplePath || audioPath || '').trim();
        if (!sample) {
            toast.error('Provide a sample audio path for cloning');
            return;
        }
        if (!cloneHasRights || !cloneNoImpersonation || !cloneTermsAccepted) {
            toast.error('All consent checkboxes are required');
            return;
        }

        setIsCloningVoice(true);
        try {
            const res = await api.post<{
                ok: boolean;
                provider?: string;
                voiceId?: string;
                voice?: any;
                notes?: string;
            }>('/api/tts/clone-voice', {
                provider: cloneProvider,
                name: cloneVoiceName.trim(),
                description: cloneVoiceDescription.trim() || undefined,
                samplePaths: [sample],
                removeBackgroundNoise: true,
                consent: {
                    hasRights: cloneHasRights,
                    noImpersonation: cloneNoImpersonation,
                    termsAccepted: cloneTermsAccepted,
                },
            });

            if (res.ok && (res.data?.voiceId || res.data?.voice?.voice_id)) {
                const newVoiceId = String(res.data.voiceId || res.data.voice?.voice_id || '').trim();
                if (newVoiceId) {
                    setVoiceId(newVoiceId);
                }
                if (res.data?.notes) toast(res.data.notes, { icon: 'ℹ️', duration: 6000 });
                toast.success(
                    cloneProvider === 'chatterbox'
                        ? 'Chatterbox voice saved — pick it from the list below or paste the ID into Voice ID above.'
                        : 'Voice cloned successfully',
                );
                if (cloneProvider === 'chatterbox') {
                    await loadChatterboxVoices();
                } else {
                    await loadVoices();
                }
            } else {
                const err = res.error || 'Voice clone failed';
                if (err.includes('create_instant_voice_clone')) {
                    toast.error('API key missing Instant Voice Clone permission. Update key scope in ElevenLabs Developers > API Keys.');
                } else {
                    toast.error(err);
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Voice clone failed';
            toast.error(message);
        } finally {
            setIsCloningVoice(false);
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

    const currentAudioUrl = toOutputUrl(audioPath, api.mediaBaseUrl);
    const currentTrack = audioHistory.find((a) => a.path === audioPath);
    const currentTrackLabel = currentTrack?.label || 'Current audio track';
    const currentTrackKind = currentTrack
        ? ({ tts: 'Generated speech', processed: 'Treated audio', upload: 'Uploaded file', record: 'Recording' } as const)[currentTrack.kind]
        : undefined;

    // Audio treatment controls
    const [denoise, setDenoise] = useState(AUDIO_PRESET_DEFAULTS.clean_voice.denoise);
    const [gate, setGate] = useState(AUDIO_PRESET_DEFAULTS.clean_voice.gate);
    const [highpass, setHighpass] = useState(AUDIO_PRESET_DEFAULTS.clean_voice.highpass);
    const [lowpass, setLowpass] = useState(AUDIO_PRESET_DEFAULTS.clean_voice.lowpass);
    const [compRatio, setCompRatio] = useState(AUDIO_PRESET_DEFAULTS.clean_voice.compRatio);
    const [compThreshold, setCompThreshold] = useState(AUDIO_PRESET_DEFAULTS.clean_voice.compThreshold);
    const [lufs, setLufs] = useState(AUDIO_PRESET_DEFAULTS.clean_voice.lufs);
    const [removeSilence, setRemoveSilence] = useState(AUDIO_PRESET_DEFAULTS.clean_voice.removeSilence);
    const [deesserAmount, setDeesserAmount] = useState(0);
    const [limiterCeiling, setLimiterCeiling] = useState(-1);
    const [presenceGain, setPresenceGain] = useState(0);
    const [presenceFreq, setPresenceFreq] = useState(4000);
    const [presenceQ, setPresenceQ] = useState(1.0);

    useEffect(() => {
        const defaults = AUDIO_PRESET_DEFAULTS[preset] || AUDIO_PRESET_DEFAULTS.clean_voice;
        setDenoise(defaults.denoise);
        setGate(defaults.gate);
        setHighpass(defaults.highpass);
        setLowpass(defaults.lowpass);
        setCompRatio(defaults.compRatio);
        setCompThreshold(defaults.compThreshold);
        setLufs(defaults.lufs);
        setRemoveSilence(defaults.removeSilence);
    }, [preset]);

    useEffect(() => {
        return () => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                try { mediaRecorderRef.current.stop(); } catch (_err) { /* no-op */ }
            }
            mediaRecorderRef.current = null;
            mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
            mediaStreamRef.current = null;
            chunksRef.current = [];
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            analyserRef.current = null;
            if (sourceNodeRef.current) {
                sourceNodeRef.current.disconnect();
                sourceNodeRef.current = null;
            }
            if (audioCtxRef.current) {
                audioCtxRef.current.close();
                audioCtxRef.current = null;
            }
        };
    }, []);

    // Provider buttons with muscle: bold name + one-line note; disabled ones
    // say "not configured" and carry the real reason in their tooltip.
    const providerBtnClass = (id: TTSProvider) => `provider-btn min-w-0 rounded-lg border px-2.5 py-2 text-left transition ${
        provider === id
            ? 'border-editor-accent/70 bg-editor-accent/15 shadow-[inset_0_0_0_1px_rgba(230,201,138,.35)]'
            : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
    } disabled:cursor-not-allowed disabled:opacity-40`;
    const providerNameClass = (id: TTSProvider) => `block truncate text-[12.5px] font-bold ${provider === id ? 'text-editor-accent' : 'text-content-primary'}`;
    const PROVIDER_NOTE_CLASS = 'block truncate text-[10px] text-content-tertiary';

    const providerControls = (
        <>
            {voiceDefaults.enabled && (
                <div className="rounded-xl border border-[#7fb5aa]/30 bg-[#7fb5aa]/10 p-3 flex flex-wrap items-center gap-3 text-xs">
                    <Wand2 size={14} className="text-content-secondary shrink-0" />
                    <span className="text-content-secondary">
                        Voice Synthesis defaults active —{' '}
                        <span className="font-semibold">{voiceDefaults.category}</span>
                        {voiceDefaults.providerOverride ? ` · ${voiceDefaults.providerOverride}` : ' · auto-provider'}
                        {voiceDefaults.cinematicMode ? ' · cinematic timings' : ''}.
                    </span>
                    <Link to="/app/settings" className="ml-auto text-[0.75rem] text-content-secondary hover:text-content-secondary underline">
                        Edit in Settings
                    </Link>
                </div>
            )}
            <div>
                <label className="field-label inline-flex items-center gap-1.5">
                    <span>Provider</span>
                    <InfoTooltip
                        width="lg"
                        content={
                            provider === 'edge'
                                ? 'Free Microsoft neural voices via the Edge "Read Aloud" service. ~400 voices, no key required.'
                                : provider === 'chatterbox'
                                    ? 'Self-hosted open-source TTS (Resemble AI). Calls a Chatterbox HTTP bridge — free, supports voice cloning via a reference WAV. Slower than ElevenLabs but expressive.'
                                    : provider === 'azure'
                                        ? 'Microsoft Azure Speech — commercial-safe, returns reliable word-level timestamps (primary kinetic-caption engine). Voice id is an Azure voice name (e.g. en-US-GuyNeural).'
                                        : provider === 'fish'
                                            ? 'Fish Audio — premium multilingual cloud voices with cloning. Voice id is a Fish reference_id. Counts against your Fish credits.'
                                            : 'Premium voices + cloning. Requires ELEVENLABS_API_KEY and counts against your monthly character quota.'
                        }
                    />
                </label>
                <div className="provider-grid grid grid-cols-2 gap-1.5 sm:grid-cols-3" role="group" aria-label="Voice provider">
                    {/* Five explicit buttons (not a map): the parity scanner counts
                        each provider as its own control, as the baseline did. */}
                    <button
                        type="button"
                        onClick={() => setProvider('elevenlabs')}
                        disabled={!elevenlabsAvailable}
                        aria-pressed={provider === 'elevenlabs'}
                        title={elevenlabsAvailable ? 'ElevenLabs · premium · cloning' : 'ELEVENLABS_API_KEY not set'}
                        className={providerBtnClass('elevenlabs')}
                    >
                        <span className={providerNameClass('elevenlabs')}>ElevenLabs</span>
                        <span className={PROVIDER_NOTE_CLASS}>{elevenlabsAvailable ? 'premium · cloning' : 'not configured'}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setProvider('azure')}
                        disabled={!azureAvailable}
                        aria-pressed={provider === 'azure'}
                        title={azureAvailable ? 'Azure · word-sync captions' : (azureReason || 'AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not set — see docs/AZURE_SPEECH_SETUP.md')}
                        className={providerBtnClass('azure')}
                    >
                        <span className={providerNameClass('azure')}>Azure</span>
                        <span className={PROVIDER_NOTE_CLASS}>{azureAvailable ? 'word-sync captions' : 'not configured'}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setProvider('fish')}
                        disabled={!fishAvailable}
                        aria-pressed={provider === 'fish'}
                        title={fishAvailable ? 'Fish · premium · multilingual' : (fishReason || 'FISH_API_KEY not set — see docs/FISH_AUDIO_SETUP.md')}
                        className={providerBtnClass('fish')}
                    >
                        <span className={providerNameClass('fish')}>Fish</span>
                        <span className={PROVIDER_NOTE_CLASS}>{fishAvailable ? 'premium · multilingual' : 'not configured'}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setProvider('chatterbox')}
                        disabled={!chatterboxAvailable}
                        aria-pressed={provider === 'chatterbox'}
                        title={chatterboxAvailable ? 'Chatterbox · self-hosted · free' : 'CHATTERBOX_URL not set — point it at a Chatterbox HTTP server (self-hosted bridge, e.g. https://chatterbox.tiwaton.co.uk).'}
                        className={providerBtnClass('chatterbox')}
                    >
                        <span className={providerNameClass('chatterbox')}>Chatterbox</span>
                        <span className={PROVIDER_NOTE_CLASS}>{chatterboxAvailable ? 'self-hosted · free' : 'not configured'}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setProvider('edge')}
                        disabled={!edgeAvailable}
                        aria-pressed={provider === 'edge'}
                        title={edgeAvailable ? 'Edge-TTS · free · stock voices' : 'EDGE_TTS_ENABLED is off'}
                        className={providerBtnClass('edge')}
                    >
                        <span className={providerNameClass('edge')}>Edge-TTS</span>
                        <span className={PROVIDER_NOTE_CLASS}>{edgeAvailable ? 'free · stock voices' : 'not configured'}</span>
                    </button>
                </div>
                {(!azureAvailable && azureReason) || (!fishAvailable && fishReason) ? (
                    <ul className="mt-2 space-y-1 text-[0.6875rem] text-content-secondary">
                        {!azureAvailable && azureReason && (
                            <li><span className="font-semibold">Azure disabled:</span> {azureReason}</li>
                        )}
                        {!fishAvailable && fishReason && (
                            <li><span className="font-semibold">Fish disabled:</span> {fishReason}</li>
                        )}
                    </ul>
                ) : null}
            </div>
            {provider === 'chatterbox' ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Field
                        label="Reference voice"
                        badge="Optional"
                        tooltip="Absolute path to a WAV file on the Chatterbox host. Leave empty to use the model's default voice. The path is resolved by the Chatterbox server, not Biblefuel."
                    >
                        <Input
                            value={chatterboxAudioPrompt}
                            onChange={(e) => setChatterboxAudioPrompt(e.target.value)}
                            placeholder="/path/to/reference.wav"
                        />
                    </Field>
                    <Field
                        label={`Exaggeration (${chatterboxStyle})`}
                        tooltip="Controls expressive intensity. Higher values yield more dramatic delivery; lower values stay closer to neutral."
                    >
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={chatterboxStyle}
                            onChange={(e) => setChatterboxStyle(Number(e.target.value))}
                            className="w-full accent-primary-500"
                        />
                    </Field>
                    <Field
                        label={`CFG weight (${chatterboxCfg})`}
                        tooltip="Classifier-free guidance weight. Lower stays more faithful to the reference voice; higher gives the model more creative freedom."
                    >
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={chatterboxCfg}
                            onChange={(e) => setChatterboxCfg(Number(e.target.value))}
                            className="w-full accent-primary-500"
                        />
                    </Field>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Field
                        label="Voice ID"
                        badge="Optional"
                        tooltip="Paste a voice ID or use Load Voices below to browse. Leave empty for the server default voice."
                    >
                        <Input
                            value={provider === 'edge' ? edgeVoiceId : voiceId}
                            onChange={(e) =>
                                provider === 'edge'
                                    ? setEdgeVoiceId(e.target.value)
                                    : setVoiceId(e.target.value)
                            }
                            placeholder={
                                provider === 'edge'
                                    ? 'e.g. en-US-AriaNeural'
                                    : 'Leave empty to use default voice'
                            }
                        />
                    </Field>
                    <Field
                        label={`Stability (${stability})`}
                        tooltip={provider === 'edge'
                            ? 'ElevenLabs-only — not used by Edge TTS.'
                            : 'How consistent the voice is between generations. Higher = more uniform; lower = more variation between takes.'}
                    >
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={stability}
                            onChange={(e) => setStability(Number(e.target.value))}
                            disabled={provider === 'edge'}
                            className="w-full accent-primary-500 disabled:opacity-40"
                        />
                    </Field>
                    <Field
                        label={`Similarity Boost (${similarity})`}
                        tooltip={provider === 'edge'
                            ? 'ElevenLabs-only — not used by Edge TTS.'
                            : 'How closely the output matches the cloned voice. Higher = more faithful; may amplify recording artifacts.'}
                    >
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={similarity}
                            onChange={(e) => setSimilarity(Number(e.target.value))}
                            disabled={provider === 'edge'}
                            className="w-full accent-primary-500 disabled:opacity-40"
                        />
                    </Field>
                </div>
            )}
            <div className="flex items-center gap-2">
            <Button variant="secondary" className="text-xs h-8" onClick={loadVoices} isLoading={isLoadingVoices} disabled={!ttsEnabled}>
                <RefreshCw size={14} className="mr-2" />
                Load Voices
            </Button>
                {voices.length > 0 && (
                    <Select
                        value={provider === 'edge' ? edgeVoiceId : voiceId}
                        onChange={(e) =>
                            provider === 'edge'
                                ? setEdgeVoiceId(e.target.value)
                                : setVoiceId(e.target.value)
                        }
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
                Generate ({
                    provider === 'edge' ? 'Edge-TTS'
                        : provider === 'chatterbox' ? 'Chatterbox'
                            : provider === 'azure' ? 'Azure'
                                : provider === 'fish' ? 'Fish'
                                    : 'ElevenLabs'
                })
            </Button>
            {isProcessing && provider === 'chatterbox' && ttsStartedAt && (() => {
                const elapsedSec = Math.max(0, Math.floor((Date.now() - ttsStartedAt) / 1000));
                const charsPerSec = 8;
                const estimatedSec = Math.max(5, Math.ceil(ttsText.length / charsPerSec));
                const progress = Math.min(100, Math.round((elapsedSec / estimatedSec) * 100));
                const overrun = elapsedSec > estimatedSec;
                void elapsedTick;
                return (
                    <div className="mt-2 text-help">
                        <div className="flex items-center justify-between mb-1">
                            <span>
                                {overrun
                                    ? `Still working — ${elapsedSec}s elapsed (estimate was ~${estimatedSec}s)`
                                    : `Generating — ~${Math.max(0, estimatedSec - elapsedSec)}s left (${elapsedSec}/${estimatedSec}s)`}
                            </span>
                        </div>
                        <div className="w-full h-1 bg-white/10 rounded overflow-hidden">
                            <div
                                className={`h-full transition-all duration-1000 ${overrun ? 'bg-editor-accent/60' : 'bg-primary-500/70'}`}
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>
                );
            })()}
            {!ttsEnabled && (
                <p className="text-xs text-content-secondary">
                    TTS disabled. Set `ELEVENLABS_API_KEY` or `EDGE_TTS_ENABLED=true` in `server/.env`.
                </p>
            )}
        </>
    );

    const recordUploadPanel = (
        <DropZone
            className="space-y-4"
            onFiles={(files) => { if (files[0]) void handleUploadFile(files[0]); }}
            accept={['audio/*', '.mp3', '.wav', '.webm', '.m4a', '.aac', '.ogg', '.flac']}
            multiple={false}
            disabled={isUploading}
            overlayLabel="Drop an audio file to upload"
        >
            <p className="text-sm text-gray-200">
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
                <label className="text-xs h-9 px-4 rounded-lg font-medium transition-all duration-200 bg-dark-900/70 text-gray-200 border border-white/10 hover:bg-dark-900/90 hover:border-white/20 flex items-center gap-2 cursor-pointer">
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
                <p className="field-label">Live input</p>
                <canvas ref={canvasRef} width={520} height={80} className="w-full rounded-lg border border-white/10 bg-black/30" />
            </div>
            {currentAudioUrl && (
                <div className="mt-3 space-y-2">
                    <p className="field-label">Latest recording / upload</p>
                    <audio controls src={currentAudioUrl} className="w-full" />
                    <p className="text-meta break-all font-mono">{audioPath}</p>
                </div>
            )}
            {recordingDebug && (
                <p className="text-meta break-all font-mono">{recordingDebug}</p>
            )}
        </DropZone>
    );

    // ---- Hoisted control blocks --------------------------------------------
    // The treatment rack, soundtrack library, voice clone and preset blocks,
    // hoisted the same way as providerControls/recordUploadPanel so the editor
    // panels and the classic RevealSections render the SAME nodes. One
    // definition per control; the two layouts cannot drift.
    const treatmentControls = (
        <>
                    <p className="text-sm text-gray-200 mb-4">
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
                            <div className="text-help space-y-2">
                                <p><strong className="text-primary-300">Preset:</strong> quick starting point. Use Clean Voice for most narration.</p>
                                <p><strong className="text-primary-300">Denoise:</strong> reduces background noise. 0.2 to 0.6 is typical.</p>
                                <p><strong className="text-primary-300">Gate (dB):</strong> mutes low-level noise between phrases. More negative = gentler.</p>
                                <p><strong className="text-primary-300">Highpass:</strong> removes rumble (60 to 120Hz for voice).</p>
                                <p><strong className="text-primary-300">Lowpass:</strong> removes hiss (10 to 14kHz for voice).</p>
                                <p><strong className="text-primary-300">Comp Ratio/Threshold:</strong> smooths peaks. Higher ratio = tighter dynamics.</p>
                                <p><strong className="text-primary-300">LUFS:</strong> loudness target. -16 is good for social; -14 is punchier.</p>
                                <p><strong className="text-primary-300">Remove Silence:</strong> trims leading silence only (safe mode).</p>
                                <p><strong className="text-primary-300">De-esser:</strong> reduces harsh s sounds (0.3 to 0.7 typical).</p>
                                <p><strong className="text-primary-300">Limiter:</strong> catches peaks to avoid clipping (ceiling around -1dB).</p>
                                <p><strong className="text-primary-300">Presence Boost:</strong> adds clarity around 3 to 5kHz if voice sounds dull.</p>
                                <p className="text-help">
                                    Pro effects we can add next: multiband EQ, expander, saturation, room removal, and breath control.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="field-label">Preset</label>
                            <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
                                <option value="clean_voice">Clean voice (recommended)</option>
                                <option value="podcast">Podcast (louder)</option>
                                <option value="warm">Warm (softer)</option>
                                <option value="raw">Raw (no processing)</option>
                            </Select>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="field-label">
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
                                <label className="field-label">
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
                                <label className="field-label">
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
                                <label className="field-label">
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
                                <label className="field-label">
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
                                <label className="field-label">
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
                                <label className="field-label">
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
                                <label className="field-label">
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
                                        <label className="field-label">
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
                                        <label className="field-label">
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
                                        <label className="field-label">
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
                                        <label className="field-label">
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
                                        <label className="field-label">
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
                </>
    );

    const soundtrackControls = (
        <>
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
                        </div>

                        {musicItems.length > 0 ? (
                            <div className="space-y-3">
                                {musicItems.slice(0, 20).map((item: any) => (
                                    <div key={item.path || item.name} className="flex flex-col md:flex-row md:items-center gap-3 bg-dark-900/60 border border-white/[0.06] rounded-lg p-3">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[0.8125rem] font-medium text-content-secondary">{item.name || 'Audio'}</p>
                                            <p className="text-[0.75rem] font-mono text-gray-300 truncate mt-0.5" title={item.path}>{item.path}</p>
                                            {item.mtime && (
                                                <p className="field-help">{new Date(item.mtime).toLocaleString()}</p>
                                            )}
                                        </div>
                                        <audio controls src={toOutputUrl(item.path, api.mediaBaseUrl)} className="w-full md:w-64" />
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
                                    <p className="field-help">Showing latest 20 items.</p>
                                )}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-300">No audio files found. Upload or process audio first.</p>
                        )}
                    </div>
                </>
    );

    const cloneControls = (
        <>
                        <div className="space-y-4">
                            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[0.8125rem] text-content-secondary leading-relaxed flex items-start gap-2">
                                <InfoTooltip
                                    width="lg"
                                    iconClassName="!text-content-tertiary !w-4 !h-4 mt-0.5 shrink-0"
                                    content="Cloning is governed by the chosen provider's usage policy. Make sure you have explicit recorded consent before cloning any voice that isn't your own."
                                />
                                <span>Consent required — clone only voices you own or have explicit permission to use. Provide at least one clear sample file path from your outputs.</span>
                            </div>

                            {/* Provider selector. ElevenLabs and Chatterbox are the only
                                providers with usable cloning APIs in this app; Azure and
                                Edge are surfaced as disabled so it's obvious they exist
                                but aren't supported here. */}
                            <div>
                                <label className="field-label">Provider</label>
                                <div className="inline-flex flex-wrap gap-1 rounded-lg border border-white/10 p-1 bg-black/20">
                                    <button
                                        type="button"
                                        onClick={() => setCloneProvider('elevenlabs')}
                                        disabled={!ttsEnabled}
                                        className={`px-3 py-1.5 text-xs font-medium rounded transition ${cloneProvider === 'elevenlabs'
                                            ? 'bg-primary-500 text-white'
                                            : 'text-gray-300 hover:bg-white/5'
                                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                                    >
                                        ElevenLabs <span className="opacity-60">· cloud</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCloneProvider('chatterbox')}
                                        disabled={!chatterboxAvailable}
                                        title={chatterboxAvailable ? '' : 'CHATTERBOX_URL not set or bridge unreachable.'}
                                        className={`px-3 py-1.5 text-xs font-medium rounded transition ${cloneProvider === 'chatterbox'
                                            ? 'bg-[#7fb5aa]/20 text-content-secondary'
                                            : 'text-gray-300 hover:bg-white/5'
                                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                                    >
                                        Chatterbox <span className="opacity-60">· self-hosted</span>
                                    </button>
                                    <button
                                        type="button"
                                        disabled
                                        title="Azure cloning needs Custom Neural Voice or Personal Voice activation on your Azure tenant — not wired in this app."
                                        className="px-3 py-1.5 text-xs font-medium rounded text-gray-500 opacity-50 cursor-not-allowed"
                                    >
                                        Azure <span className="opacity-60">· tenant-only</span>
                                    </button>
                                    <button
                                        type="button"
                                        disabled
                                        title="Edge-TTS is the Microsoft Edge Read-Aloud service. Stock voices only — no cloning API exists."
                                        className="px-3 py-1.5 text-xs font-medium rounded text-gray-500 opacity-50 cursor-not-allowed"
                                    >
                                        Edge <span className="opacity-60">· no cloning</span>
                                    </button>
                                </div>
                                <p className="field-help">
                                    {cloneProvider === 'chatterbox'
                                        ? 'Chatterbox conditions on a single reference WAV at synthesis time. The sample is uploaded to your bridge once and reused for every future render.'
                                        : 'ElevenLabs creates a permanent voice in your ElevenLabs library. Counts against your monthly character / voice-slot quota.'}
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <Input
                                    value={cloneVoiceName}
                                    onChange={(e) => setCloneVoiceName(e.target.value)}
                                    placeholder="Clone name (e.g. Segun Narrator)"
                                />
                                <Input
                                    value={cloneSamplePath}
                                    onChange={(e) => setCloneSamplePath(e.target.value)}
                                    placeholder="Sample audio path (e.g. server/outputs/user-audio-xxx.wav)"
                                />
                            </div>
                            <Input
                                value={cloneVoiceDescription}
                                onChange={(e) => setCloneVoiceDescription(e.target.value)}
                                placeholder="Optional description"
                            />
                            <div className="space-y-2 text-xs">
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={cloneHasRights} onChange={(e) => setCloneHasRights(e.target.checked)} />
                                    I confirm I have rights and consent to clone this voice.
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={cloneNoImpersonation} onChange={(e) => setCloneNoImpersonation(e.target.checked)} />
                                    I will not use this to impersonate or deceive.
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={cloneTermsAccepted} onChange={(e) => setCloneTermsAccepted(e.target.checked)} />
                                    I accept the chosen provider's terms and responsibility for usage.
                                </label>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="secondary"
                                    className="text-xs h-8"
                                    onClick={() => {
                                        setCloneSamplePath(audioPath);
                                        toast.success('Sample path loaded from current audio. Click Clone Voice to proceed.');
                                    }}
                                    disabled={!audioPath}
                                >
                                    Use Current Audio Path
                                </Button>
                                <Button
                                    onClick={handleCloneVoice}
                                    isLoading={isCloningVoice}
                                    disabled={cloneProvider === 'elevenlabs' ? !ttsEnabled : !chatterboxAvailable}
                                >
                                    Clone Voice
                                </Button>
                            </div>

                            {/* Saved Chatterbox clones — server-side list keyed by user. */}
                            {chatterboxVoices.length > 0 && (
                                <div className="pt-3 border-t border-white/[0.06]">
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="text-[0.8125rem] font-semibold text-gray-200">Saved Chatterbox clones</h4>
                                        <span className="text-meta">{chatterboxVoices.length} total</span>
                                    </div>
                                    <div className="space-y-2">
                                        {chatterboxVoices.map((cv) => (
                                            <div key={cv.id} className="flex items-center gap-2 bg-dark-900/40 border border-white/[0.06] rounded-lg p-2">
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-[0.875rem] font-medium text-content-secondary truncate">{cv.name}</div>
                                                    <div className="text-meta font-mono truncate">{cv.refFilename || cv.refPath}</div>
                                                </div>
                                                <Button
                                                    variant="secondary"
                                                    className="text-[0.6875rem] h-7"
                                                    onClick={() => {
                                                        setProvider('chatterbox');
                                                        setVoiceId(cv.id);
                                                        toast.success(`Voice "${cv.name}" selected — generate to test.`);
                                                    }}
                                                >
                                                    Use
                                                </Button>
                                                <button
                                                    type="button"
                                                    onClick={() => deleteChatterboxVoice(cv.id)}
                                                    title="Delete this saved clone"
                                                    className="p-1.5 rounded text-gray-500 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                </>
    );

    const presetControls = (
        <>
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

                        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 space-y-2">
                            <p className="text-help">
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
                                <div key={p.id} className="border border-white/[0.08] bg-dark-900/40 rounded-lg p-3 flex items-center justify-between">
                                    <div>
                                        <div className="text-[0.9375rem] font-semibold text-white">{p.label}</div>
                                        <div className="text-meta mt-0.5">Voice ID: {p.voiceId || 'not set'}</div>
                                        <div className="text-meta">Stability {p.stability} • Similarity {p.similarity}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button variant="secondary" className="text-xs h-8" onClick={() => {
                                            applyPreset(p);
                                            toast.success(`Applied preset: ${p.label}`);
                                        }}>
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
                </>
    );

    const takesPanel = (
                        <div className="flex h-full min-h-0 flex-col gap-3">
                            {/* The current track IS the contract with Render - keep it
                                visible and editable here, same as classic's Current
                                Audio card. */}
                            <div>
                                <label className="field-label">Current audio</label>
                                <Input
                                    value={audioPath}
                                    onChange={(e) => setAudioPath(e.target.value)}
                                    placeholder="e.g. server/outputs/audio.mp3"
                                    className="bg-black/20"
                                />
                            </div>
                            {audioHistory.length === 0 ? (
                                <p className="text-[11px] text-editor-faint">No takes yet.</p>
                            ) : (
                                <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
                                    {audioHistory.map((item) => {
                                        const isCurrent = item.path === audioPath;
                                        return (
                                        <div
                                            key={item.id}
                                            className={`surface-raised flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 ${isCurrent ? 'border border-[#7fb5aa]/25' : ''}`}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => setAudioPath(item.path)}
                                                className="min-w-0 flex-1 truncate text-left text-xs text-content-secondary"
                                                title={item.path}
                                            >
                                                {item.kind}
                                            </button>
                                            {isCurrent && (
                                                <CheckCircle2 size={12} className="shrink-0 text-content-secondary" aria-label="Current take" />
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(item.path);
                                                    toast.success('Copied');
                                                }}
                                                aria-label="Copy path"
                                                className="shrink-0 rounded p-1 text-editor-faint hover:text-white"
                                            >
                                                <Clipboard size={12} />
                                            </button>
                                        </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
    );

    // ---- Embedded (inside the Timeline editor) ------------------------------
    // Sub-tabs over the SAME hoisted blocks; a pinned footer carries the take
    // onto the timeline: Current audio -> Land on VO lane -> Next: Render.
    if (embedded) {
        const tabs: Array<{ id: LabTabId; label: string; count?: number }> = [
            { id: 'generate', label: 'Generate' },
            { id: 'record', label: 'Record' },
            { id: 'treat', label: 'Treat' },
            { id: 'music', label: 'Music' },
            { id: 'clone', label: 'Clone', count: voicePresets.length || undefined },
            { id: 'compare', label: 'Compare' },
            { id: 'animation', label: 'Animation' },
            { id: 'takes', label: 'Takes', count: audioHistory.length || undefined },
        ];
        const canLand = Boolean(audioPath.trim()) && embedded.hasProject;
        const landTitle = !audioPath.trim()
            ? 'Generate, record or pick a take first'
            : !embedded.hasProject ? 'Create a documentary timeline first (Scenes tool)' : 'Add the current audio as a clip on the voice-over lane';
        return (
            <div className="editor-embed flex h-full min-h-0 flex-col">
                <div role="tablist" aria-label="Voice lab" className="mb-2 flex flex-wrap gap-1">
                    {tabs.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            role="tab"
                            aria-selected={labTab === t.id}
                            onClick={() => setLabTab(t.id)}
                            className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                                labTab === t.id ? 'border-editor-accent/60 bg-editor-accent/10 text-editor-accent' : 'border-editor-line text-editor-dim hover:text-editor-text'
                            }`}
                        >
                            {t.label}{t.count ? <span className="ml-1 text-[10px] opacity-70">{t.count}</span> : null}
                        </button>
                    ))}
                </div>
                <div className="lab-body min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
                    {labTab === 'generate' && (
                        <div className="space-y-3">
                            <Textarea
                                value={ttsText}
                                onChange={(e) => setTtsText(e.target.value)}
                                placeholder="What should the voice say?"
                                aria-label="Voice script"
                                className="h-28 bg-black/20 text-xs"
                            />
                            <div className="flex flex-wrap gap-1.5">
                                <Button variant="secondary" className="h-7 text-[11px]" onClick={handleUseLatestScript}>Use latest script</Button>
                                <Button variant="secondary" className="h-7 text-[11px]" onClick={handleFormatForVoice}>Format for voice</Button>
                            </div>
                            {providerControls}
                        </div>
                    )}
                    {labTab === 'record' && recordUploadPanel}
                    {labTab === 'treat' && <div className="space-y-3">{treatmentControls}</div>}
                    {labTab === 'music' && <div className="space-y-3">{soundtrackControls}</div>}
                    {labTab === 'clone' && (
                        <div className="space-y-1">
                            <PanelSection title="Voice clone" defaultOpen>
                                <div className="space-y-4">{cloneControls}</div>
                            </PanelSection>
                            <PanelSection title="Voice presets" count={voicePresets.length}>
                                <div className="space-y-4">{presetControls}</div>
                            </PanelSection>
                        </div>
                    )}
                    {labTab === 'compare' && <CompareVoices />}
                    {labTab === 'animation' && <AnimationPicker defaultOpen />}
                    {labTab === 'takes' && takesPanel}
                </div>
                <div className="mt-2 shrink-0 space-y-1.5 border-t border-editor-line pt-2">
                    <p className="truncate text-[10px] text-editor-faint" title={audioPath || undefined}>
                        {audioPath.trim() ? `Current audio · ${currentTrackLabel}` : 'No current audio yet — generate, record or pick a take.'}
                    </p>
                    {currentAudioUrl && <audio controls src={currentAudioUrl} className="h-8 w-full" />}
                    <Button
                        onClick={() => { embedded.onLandVoiceover({ path: audioPath, label: currentTrackLabel }); setLanded(true); }}
                        disabled={!canLand}
                        title={landTitle}
                        className="h-9 w-full text-xs"
                    >
                        Land on VO lane
                    </Button>
                    {landed && (
                        <Button variant="secondary" onClick={embedded.onNext} className="h-9 w-full border-editor-line text-xs">
                            Next: Render → Output tool
                        </Button>
                    )}
                </div>
            </div>
        );
    }

    // ---- Editor layout -----------------------------------------------------
    // Same shell as Timeline and Render. The panels reuse the blocks the page
    // ALREADY hoists (providerControls, recordUploadPanel, treatmentControls,
    // cloneControls, presetControls) rather than re-creating them, so there is
    // exactly one definition of every control and the two layouts cannot drift.
    if (editorLayout) {
        return (
            <EditorShell
                topBar={(
                    <>
                        <span className="font-semibold">Give it a voice</span>
                        {audioPath.trim() && (
                            <span
                                className="cursor-help truncate rounded-md border border-editor-line px-2.5 py-1 text-[12px] text-editor-dim"
                                title={audioPath}
                            >
                                Track ready
                            </span>
                        )}
                        <span className="flex-1" />
                        <Button variant="secondary" className="h-8 text-xs" onClick={() => setEditorLayout(false)}>
                            Classic view
                        </Button>
                    </>
                )}
                tools={[
                    { id: 'script', label: 'Script', icon: <Wand2 size={17} /> },
                    { id: 'record', label: 'Record', icon: <Mic size={17} /> },
                    { id: 'treat', label: 'Treat', icon: <SlidersHorizontal size={17} /> },
                    { id: 'clone', label: 'Clone', icon: <Users size={17} /> },
                    { id: 'music', label: 'Music', icon: <Music size={17} /> },
                    { id: 'takes', label: 'Takes', icon: <HistoryIcon size={17} />, count: audioHistory.length },
                ]}
                panels={{
                    script: (
                        <div className="space-y-4">
                            <Textarea
                                value={ttsText}
                                onChange={(e) => setTtsText(e.target.value)}
                                placeholder="What should the voice say?"
                                className="h-40 bg-black/20"
                            />
                            <div className="flex flex-wrap gap-2">
                                <Button variant="secondary" className="h-8 text-xs" onClick={handleUseLatestScript}>
                                    Use latest script
                                </Button>
                                <Button variant="secondary" className="h-8 text-xs" onClick={handleFormatForVoice}>
                                    Format for voice
                                </Button>
                            </div>
                            {providerControls}
                        </div>
                    ),
                    record: recordUploadPanel,
                    treat: (
                        <div className="space-y-3">{treatmentControls}</div>
                    ),
                    clone: (
                        <div className="space-y-1">
                            <PanelSection title="Voice clone" defaultOpen>
                                <div className="space-y-4">{cloneControls}</div>
                            </PanelSection>
                            <PanelSection title="Voice presets" count={voicePresets.length}>
                                <div className="space-y-4">{presetControls}</div>
                            </PanelSection>
                        </div>
                    ),
                    music: (
                        <div className="space-y-3">{soundtrackControls}</div>
                    ),
                    takes: takesPanel,
                }}
                stage={(
                    audioPath.trim() ? (
                        <div className="flex h-full max-h-full w-full max-w-2xl flex-col items-center justify-center gap-3">
                            <audio src={api.mediaUrl(audioPath)} controls className="w-full" />
                            <p className="truncate text-[11px] text-editor-faint" title={audioPath}>
                                {audioPath.split(/[\\/]/).pop()}
                            </p>
                        </div>
                    ) : (
                        <p className="max-w-md text-center text-[12px] text-editor-faint">
                            Write a script and press Generate, or record your own. The take appears
                            here so you can hear it before rendering.
                        </p>
                    )
                )}
            />
        );
    }


    return (
        <div>
            <div className="mb-5 flex items-start justify-between gap-4">
                <ScreenHeader eyebrow="Studio" title={<>Give it a <em>voice</em>.</>} />
                {/* Opt-in, same as Timeline and Render; classic stays the fallback. */}
                <Button
                    variant="secondary"
                    className="h-9 shrink-0 text-xs"
                    onClick={() => setEditorLayout(true)}
                    title="Rail, panel and preview - the same shell as Timeline"
                >
                    Editor view
                </Button>
            </div>

            <div className="mb-6">
                <GuideSteps
                    storageKey="voiceAudio"
                    title="Make a voice track in 4 steps"
                    steps={[
                        {
                            label: <>Pick a provider and press <strong>Generate</strong> — or record / upload your own under <strong>Record / Upload</strong>.</>,
                        },
                        {
                            label: <>Optional: clean it up under <strong>Audio Treatment</strong> (denoise, loudness, EQ).</>,
                        },
                        {
                            label: <>Your newest clip automatically becomes <strong>Current Audio</strong> — that's the track Render uses.</>,
                            detail: <>To switch back to an earlier clip, click <strong>Use</strong> on it under <em>Recent Audio</em>.</>,
                        },
                        {
                            label: <>Head to <strong>Render</strong> to turn it into a video.</>,
                        },
                    ]}
                    tip={<>Want background music? Open <strong>Soundtrack Library</strong> and click <strong>Use in Render</strong> on a track.</>}
                />
            </div>

            <div className="space-y-6">
                {/* Sticky now-playing player — pins under the app header (above the mobile
                    nav) so preview + "Use in Render" stay reachable while scrolling. z-20
                    keeps it under the app shell header/nav (z-30+) but over page content. */}
                {currentAudioUrl && (
                    <div className="sticky top-2 z-20 -mx-1 px-1">
                        <VoicePlayer src={currentAudioUrl} label={currentTrackLabel} kindLabel={currentTrackKind} />
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
                    <div className="space-y-4 min-w-0">
                        <CreateVoiceHero
                    ttsText={ttsText}
                    onTtsTextChange={setTtsText}
                    onUseLatestScript={handleUseLatestScript}
                    onFormatForVoice={handleFormatForVoice}
                    onInsertTemplate={handleInsertTemplate}
                    providerControls={providerControls}
                    recordUploadPanel={recordUploadPanel}
                />

                <RevealSection title="Audio treatment" storageKey="va.treatment">
                    {treatmentControls}
                </RevealSection>

                <RevealSection
                    title="Soundtrack library"
                    storageKey="va.soundtrack"
                    info="Use any audio file from outputs as a soundtrack for Render."
                >
                    {soundtrackControls}
                </RevealSection>

                <RevealSection title="Current audio" storageKey="va.current" defaultOpen>
                    <Card
                        title="Current Audio"
                        headerExtra={audioPath.trim() ? (
                            <span className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full bg-[#7fb5aa]/15 text-content-secondary border border-[#7fb5aa]/25">
                                <CheckCircle2 size={12} />
                                Used in Render
                            </span>
                        ) : undefined}
                    >
                        <Input
                            value={audioPath}
                            onChange={(e) => setAudioPath(e.target.value)}
                            placeholder="e.g. server/outputs/audio.mp3"
                        />
                        <p className="text-help mt-2">
                            {audioPath.trim()
                                ? 'This is the track the Render and Timeline pages will use. Generate, record, or click Use on a Recent Audio clip to change it.'
                                : 'No track selected yet. Generate a voice above, record/upload, or click Use on a Recent Audio clip — it will appear here.'}
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
                                <Link
                                    to="/app/render"
                                    className="inline-flex items-center justify-center gap-1.5 text-xs h-9 px-4 rounded-lg font-medium bg-primary-500 text-white hover:bg-primary-400 transition-colors whitespace-nowrap"
                                >
                                    Go to Render
                                    <ArrowRight size={14} />
                                </Link>
                            </div>
                        )}
                    </Card>
                </RevealSection>

                <RevealSection title="Voice clone" storageKey="va.clone">
                    {cloneControls}
                </RevealSection>

                <RevealSection title="Voice presets" storageKey="va.presets">
                    {presetControls}
                </RevealSection>

                {/* Caption animation picker — kinetic typography styles ported from lumina,
                    synced to the word timings the TTS pipeline produces. */}
                <AnimationPicker />
                {/* Side-by-side Voice Lab compare — synth the same line across 2-4
                    providers in parallel, rate them, and persist the rating. */}
                <CompareVoices />
                    </div>

                    <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
                        <RevealSection title="Recent audio" storageKey="va.recent" defaultOpen>
                    {audioHistory.length === 0 ? (
                        <p className="text-sm text-gray-300">No processed or uploaded audio yet.</p>
                    ) : (
                        <div className="space-y-3">
                            {(showAllRecent ? audioHistory : audioHistory.slice(0, 6)).map((item) => {
                                const isCurrent = item.path === audioPath;
                                return (
                                <div
                                    key={item.id}
                                    // Stacked, NOT md:flex-row. These cards live in a fixed
                                    // 320px rail, but `md:` is a VIEWPORT breakpoint — on any
                                    // desktop it forced a horizontal row into a narrow column,
                                    // overlapping the timestamp, buttons and File path toggle.
                                    className={`flex flex-col gap-2 rounded-lg p-3 border ${
                                        isCurrent
                                            ? 'bg-[#7fb5aa]/[0.06] border-[#7fb5aa]/25'
                                            : 'bg-dark-900/60 border-white/5'
                                    }`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[0.8125rem] font-medium text-content-secondary flex items-center gap-1.5">
                                            {item.kind}
                                            {isCurrent && (
                                                <span className="inline-flex items-center gap-1 text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-full bg-[#7fb5aa]/15 text-content-secondary">
                                                    <CheckCircle2 size={10} />
                                                    Current
                                                </span>
                                            )}
                                        </p>
                                        <p className="text-meta mt-0.5">
                                            {new Date(item.createdAt).toLocaleString()}
                                        </p>
                                        {/* Raw output path is debug detail — collapse it behind a
                                            clear toggle so the card reads cleanly. Native <details>
                                            keeps it accessible with no per-card React state. */}
                                        <details className="group mt-1">
                                            <summary className="inline-flex items-center gap-1 text-[0.6875rem] text-content-tertiary hover:text-primary-300 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                                                <ChevronDown size={11} className="transition-transform group-open:rotate-180" />
                                                File path
                                            </summary>
                                            <p className="text-meta font-mono break-all mt-1">{item.path}</p>
                                        </details>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {isCurrent ? (
                                            <span className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded-lg text-content-secondary bg-[#7fb5aa]/10 border border-[#7fb5aa]/20 whitespace-nowrap">
                                                <CheckCircle2 size={14} />
                                                In use
                                            </span>
                                        ) : (
                                        <Button
                                            variant="secondary"
                                            className="text-xs h-8"
                                            onClick={() => {
                                                setAudioPath(item.path);
                                                toast.success(
                                                    (t) => (
                                                        <span>
                                                            Audio path set as current.{' '}
                                                            <Link
                                                                to="/app/render"
                                                                className="underline text-primary-300 font-semibold"
                                                                onClick={() => toast.dismiss(t.id)}
                                                            >
                                                                Open Render →
                                                            </Link>
                                                        </span>
                                                    ),
                                                    { duration: 6000 },
                                                );
                                            }}
                                        >
                                            <Play size={14} className="mr-2" />
                                            Use
                                        </Button>
                                        )}
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
                                    <audio controls src={toOutputUrl(item.path, api.mediaBaseUrl)} className="w-full md:w-64" />
                                </div>
                                );
                            })}
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
                        </RevealSection>
                    </aside>
                </div>
            </div>
        </div>
    );
}
