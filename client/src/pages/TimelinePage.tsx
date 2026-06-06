import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { api, UPLOAD_TIMEOUT_MS } from '../lib/api';
import toast from 'react-hot-toast';
import {
    Play,
    Save,
    Trash2,
    Plus,
    Music,
    Volume2,
    Waves,
    Library,
    Film,
    Download,
    Sparkles,
    X,
    Share2,
    Scissors,
    History as HistoryIcon,
    RotateCcw,
} from 'lucide-react';
import { loadJson, saveJson, STORAGE_KEYS } from '../lib/storage';
import { LAYOUT_OPTIONS } from '../lib/layoutOptions';
import { usePersistedState } from '../lib/usePersistedState';
import { pickTranscribeAction, baseName, type TranscriptRecord } from '../lib/transcribeAction';
import { AnimationPicker } from '../components/voicelab/AnimationPicker';
import { ShareSheet } from '../components/ShareSheet';
import { MediaTrimmer } from '../components/MediaTrimmer';

interface TranscriptWord {
    text: string;
    startMs: number;
    endMs: number;
}

function groupWordsIntoLines(words: TranscriptWord[], wordsPerLine: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < words.length; i += wordsPerLine) {
        out.push(words.slice(i, i + wordsPerLine).map((w) => w.text).join(' '));
    }
    return out;
}

// Re-flow edited caption lines back into a TranscriptWord[] for the render
// route. Word-level timing precision is lost (we redistribute uniformly across
// the original span) but editability beats perfect alignment for sermon
// recaptioning — users care more about fixing transcription errors than
// keeping sub-second sync on every token.
/** "m:ss" for under-an-hour render runs (which is all of them at our caps). */
function formatElapsed(ms: number): string {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Linear ETA: if percent% finished after elapsed ms, total≈elapsed/(percent/100).
 * Subtract elapsed to get remaining. Clamps to ≥0 so a slightly-over-100 percent
 * (rounding artifact) doesn't render as a negative time. Caller should only
 * invoke this when percent > 1 to avoid wild estimates at the start.
 */
function estimateEtaMs(elapsedMs: number, percent: number): number {
    const fraction = Math.min(0.999, Math.max(0.01, percent / 100));
    const totalMs = elapsedMs / fraction;
    return Math.max(0, totalMs - elapsedMs);
}

function reflowWordsFromEditedLines(
    originalWords: TranscriptWord[],
    lines: string[],
): TranscriptWord[] {
    const lineWords = lines.flatMap((l) => l.split(/\s+/).filter(Boolean));
    if (!originalWords.length || !lineWords.length) return [];

    // Pair each edited word positionally with its original Whisper word so
    // each caption inherits the REAL spoken timing. Even-distribution (the
    // previous approach) collapses pauses and uneven speech into a uniform
    // metronome — captions then race ahead of the audio. If the edited list
    // runs past the original (user added words), interpolate the overrun
    // from the original's average word duration.
    const last = originalWords[originalWords.length - 1];
    const avgWordMs = Math.max(
        1,
        (last.endMs - originalWords[0].startMs) / originalWords.length,
    );

    return lineWords.map((text, idx) => {
        const original = originalWords[idx];
        if (original) {
            return { text, startMs: original.startMs, endMs: original.endMs };
        }
        const overrun = idx - originalWords.length + 1;
        return {
            text,
            startMs: Math.round(last.endMs + (overrun - 1) * avgWordMs),
            endMs: Math.round(last.endMs + overrun * avgWordMs),
        };
    });
}

interface TimelineClip {
    id: string;
    path: string;
    label?: string;
    startSec: number | null;
    durationSec: number | null;
}

interface LibraryItem {
    id: string;
    url: string;
    previewUrl?: string;
    image: string;
    savedAt: string;
    /**
     * Optional discriminator for local-file uploads. Pexels library entries
     * are always videos and omit this field. Set to 'image' when the user
     * uploaded a still — UI then renders <img> previews instead of <video>,
     * and the server route detects the .jpg/.png/.webp extension on the
     * resolved path and switches FFmpeg's input flags to -loop 1 -t SEG.
     */
    kind?: 'image' | 'video';
}

interface AudioItem {
    id: string;
    path: string;
    kind: string;
    createdAt: string;
}

/** Cap matched to the server's MAX_BACKGROUNDS — keep these in sync. */
const MAX_BACKGROUNDS = 4;

/**
 * Mirrors the server's MAX_INPUT_MB (default 200). Surfaced in the UI as
 * pre-upload hints + enforced client-side so a 300 MB upload fails fast
 * with a friendly toast instead of after a long base64 round-trip ending
 * in a generic server 413/400.
 */
const MAX_UPLOAD_MB = 200;

/** Server-recorded captioned-video render — shape mirrors renderHistory.js. */
interface RenderHistoryItem {
    jobId: string;
    file: string;
    createdAt: number;
    durationSec: number;
    sourceMediaPath?: string | null;
    backgroundId?: string | number | null;
    mode: 'video' | 'audio+bg';
}

export function TimelinePage() {
    const [clips, setClips] = useState<TimelineClip[]>([]);
    // Backgrounds are part of the captioned-video flow (Sermon Clip Studio).
    // Persisted as an ORDERED array of up to MAX_BACKGROUNDS items — the
    // render route hard-cuts between them at durationSec/N each. See the
    // server's MAX_BACKGROUNDS constant for the matching cap.
    const [backgroundItems, setBackgroundItems] = usePersistedState<LibraryItem[]>(
        STORAGE_KEYS.sclBackgrounds,
        [],
    );
    // Auto mode: when on (default), BibleFuel picks a mood-matched background per
    // beat from the user's own library — and AI-generates one if the pool is
    // empty. Manually selecting clips overrides auto for that render.
    const [autoBackground, setAutoBackground] = usePersistedState<boolean>(
        STORAGE_KEYS.sclAutoBackground,
        true,
    );
    const [showLibraryModal, setShowLibraryModal] = useState(false);
    const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
    const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [audioHistory, setAudioHistory] = useState<AudioItem[]>([]);
    const [showAddClipModal, setShowAddClipModal] = useState(false);
    const [manualPath, setManualPath] = useState('');
    const [currentAudioPath, setCurrentAudioPath] = useState('');
    const [renderedAudio, setRenderedAudio] = useState<string | null>(null);

    // Global controls
    const [fadeIn, setFadeIn] = useState(0);
    const [fadeOut, setFadeOut] = useState(0);
    const [normalizeLUFS, setNormalizeLUFS] = useState(-14);
    const [deess, setDeess] = useState(true);

    // Sermon Clip Studio state — every field persisted so a browser refresh
    // doesn't wipe an in-progress sermon. Ephemeral flags (isUploading,
    // isTranscribing, isRenderingVideo) stay on plain useState because their
    // value across refreshes is meaningless.
    const [sourceMediaPath, setSourceMediaPath] = usePersistedState<string | null>(
        STORAGE_KEYS.sclSourcePath,
        null,
    );
    const [sourceMediaKind, setSourceMediaKind] = usePersistedState<'audio' | 'video' | null>(
        STORAGE_KEYS.sclSourceKind,
        null,
    );
    const [isUploading, setIsUploading] = useState(false);
    // 0..100 while a media upload is in flight, null when idle. Drives the
    // upload progress bar so large background/music files don't look frozen.
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [transcript, setTranscript] = usePersistedState<TranscriptWord[] | null>(
        STORAGE_KEYS.sclTranscript,
        null,
    );
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [editedLines, setEditedLines] = usePersistedState<string[]>(
        STORAGE_KEYS.sclEditedLines,
        [],
    );
    const [musicPath, setMusicPath] = usePersistedState<string | null>(
        STORAGE_KEYS.sclMusicPath,
        null,
    );
    const [musicVolume, setMusicVolume] = usePersistedState<number>(
        STORAGE_KEYS.sclMusicVolume,
        0.25,
    );
    const [autoDuck, setAutoDuck] = usePersistedState<boolean>(
        STORAGE_KEYS.sclAutoDuck,
        true,
    );
    const [typographyPreset, setTypographyPreset] = usePersistedState<string>(
        STORAGE_KEYS.sclTypographyPreset,
        'cinematic-worship',
    );
    const [layout, setLayout] = usePersistedState<string>(
        STORAGE_KEYS.sclLayout,
        'center',
    );
    const [depth, setDepth] = usePersistedState<boolean>(
        STORAGE_KEYS.sclDepth,
        false,
    );
    const [renderedVideo, setRenderedVideo] = usePersistedState<string | null>(
        STORAGE_KEYS.sclRenderedVideo,
        null,
    );
    const [isRenderingVideo, setIsRenderingVideo] = useState(false);
    // Determinate progress for the captioned-video render. Fed by the server's
    // SSE stream of ffmpeg `time=` parses; runs 0..100 and freezes at 100 once
    // the `done` event arrives. Drives the inline progress card below.
    const [renderProgress, setRenderProgress] = useState(0);
    const [renderElapsedMs, setRenderElapsedMs] = useState(0);
    // 'preparing' = ffmpeg is opening inputs / fetching remote backgrounds /
    // building the filtergraph (no determinate progress yet); 'encoding' once
    // the first `time=` arrives. Lets the card show an honest "Preparing…"
    // state instead of a frozen 0%.
    const [renderPhase, setRenderPhase] = useState<'preparing' | 'encoding'>('preparing');
    // Recent Renders — the user's last N captioned-video renders, fetched
    // from the server on mount and refetched after each successful render so
    // the panel stays in sync without manual refresh.
    const [renderHistory, setRenderHistory] = useState<RenderHistoryItem[]>([]);
    // The render currently open in the Share sheet (a media URL), or null. Lets
    // any completed render — the latest one or any item in Recent Renders — be
    // shared straight from the Timeline page.
    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const [trimTarget, setTrimTarget] = useState<
        | { kind: 'audio' | 'video'; path: string; apply: (p: string) => void }
        | null
    >(null);
    // With 2+ backgrounds, sync the cuts to spoken phrases and crossfade between
    // them (vs. equal hard cuts). On by default — it's the more cinematic result.
    const [syncBackgrounds, setSyncBackgrounds] = usePersistedState<boolean>(
        STORAGE_KEYS.sclSyncBackgrounds,
        true,
    );
    const [transcriptHistory, setTranscriptHistory] = useState<TranscriptRecord[]>([]);
    const [showHistory, setShowHistory] = useState(false);

    const readFileAsDataUrl = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });

    const handleSourceUpload = async (file: File) => {
        // Client-side gate matches the server's MAX_INPUT_MB so a 300 MB
        // upload fails up front instead of after a long base64 → HTTP round
        // trip that ends in a generic 413.
        if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
            toast.error(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max upload is ${MAX_UPLOAD_MB} MB.`);
            return;
        }
        const isVideo = /\.(mp4|mov|webm|m4v)$/i.test(file.name);
        setIsUploading(true);
        try {
            const dataUrl = await readFileAsDataUrl(file);
            setUploadProgress(0);
            const endpoint = isVideo ? '/api/media/upload-source-video' : '/api/media/upload-audio';
            const response = await api.post(
                endpoint,
                { dataUrl, filename: file.name },
                undefined,
                { timeout: UPLOAD_TIMEOUT_MS, onUploadProgress: setUploadProgress },
            );
            if (!response.ok || !response.data?.file) {
                toast.error(response.error || 'Upload failed');
                return;
            }
            setSourceMediaPath(response.data.file);
            setSourceMediaKind(isVideo ? 'video' : 'audio');
            setTranscript(null);
            setEditedLines([]);
            // Audio uploads feed the legacy "Main Assembly" clip list so the
            // existing Render Audio path Just Works — without this, users hit
            // a "Timeline is empty" toast even though they just uploaded a
            // sermon. Video uploads skip this because the Main Assembly is
            // audio-only mastering; they use the Render Captioned Video path.
            //
            // Uploading a *second* source REPLACES the assembly's clip list
            // instead of appending. Without this, the legacy Render Audio
            // path tries to concat both the old (possibly stale) clip and
            // the new one, throws an ffmpeg validation error, and the user
            // has to manually delete the duplicate to recover.
            if (!isVideo) {
                const clip: TimelineClip = {
                    id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    path: response.data.file,
                    label: file.name,
                    startSec: null,
                    durationSec: null,
                };
                const next = [clip];
                setClips(next);
                saveClipsToCache(next);
            }
            toast.success(`${isVideo ? 'Video' : 'Audio'} uploaded`);
        } catch {
            toast.error('Upload failed');
        } finally {
            setIsUploading(false);
            setUploadProgress(null);
        }
    };

    const loadTranscriptHistory = useCallback(async () => {
        const res = await api.get('/api/transcripts?limit=50');
        if (res.ok && Array.isArray(res.data?.items)) setTranscriptHistory(res.data.items as TranscriptRecord[]);
    }, []);

    const saveTranscript = useCallback(async (words: TranscriptWord[], lines: string[]) => {
        if (!sourceMediaPath || !words.length) return;
        const res = await api.post('/api/transcripts', {
            sourceFile: baseName(sourceMediaPath),
            words,
            editedLines: lines,
            typographyPreset,
        });
        if (res.ok) void loadTranscriptHistory();
    }, [sourceMediaPath, typographyPreset, loadTranscriptHistory]);

    const applyTranscriptRecord = useCallback((rec: TranscriptRecord) => {
        setTranscript(rec.words as TranscriptWord[]);
        setEditedLines(rec.editedLines);
        if (rec.typographyPreset) setTypographyPreset(rec.typographyPreset);
        setShowHistory(false);
    }, [setTranscript, setEditedLines, setTypographyPreset]);

    const deleteTranscriptRecord = useCallback(async (id: string) => {
        const res = await api.delete(`/api/transcripts/${encodeURIComponent(id)}`);
        if (res.ok) void loadTranscriptHistory();
    }, [loadTranscriptHistory]);

    const runFreshTranscribe = async () => {
        if (!sourceMediaPath) { toast.error('Upload a sermon first'); return; }
        setIsTranscribing(true);
        const toastId = toast.loading('Transcribing — this can take a minute...');
        try {
            const response = await api.post('/api/transcribe', { mediaPath: sourceMediaPath });
            if (!response.ok || !Array.isArray(response.data?.words)) {
                toast.error(response.error || 'Transcription failed', { id: toastId });
                return;
            }
            const words: TranscriptWord[] = response.data.words;
            const lines = groupWordsIntoLines(words, 8);
            setTranscript(words);
            setEditedLines(lines);
            toast.success(`Transcribed ${words.length} words`, { id: toastId });
            void saveTranscript(words, lines);
        } catch {
            toast.error('Transcription failed', { id: toastId });
        } finally {
            setIsTranscribing(false);
        }
    };

    const handleTranscribe = async () => {
        if (!sourceMediaPath) { toast.error('Upload a sermon first'); return; }
        const action = pickTranscribeAction(transcriptHistory, sourceMediaPath);
        if (action.mode === 'reuse') {
            applyTranscriptRecord(action.record);
            toast.success('Reused saved transcript — 0 quota used', { id: 'tx-reuse' });
            return;
        }
        await runFreshTranscribe();
    };

    /**
     * Upload a local video or image to use as a background clip. Slots into
     * the same backgroundItems list as Pexels picks — order matters; this
     * becomes the next segment in the sequence.
     */
    const handleLocalBackgroundUpload = async (file: File) => {
        if (backgroundItems.length >= MAX_BACKGROUNDS) {
            toast.error(`Max ${MAX_BACKGROUNDS} backgrounds reached. Remove one to add another.`);
            return;
        }
        if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
            toast.error(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max upload is ${MAX_UPLOAD_MB} MB.`);
            return;
        }
        setIsUploading(true);
        try {
            const dataUrl = await readFileAsDataUrl(file);
            setUploadProgress(0);
            const response = await api.post<{ file: string; kind: 'image' | 'video' }>(
                '/api/media/upload-background',
                { dataUrl, filename: file.name },
                undefined,
                { timeout: UPLOAD_TIMEOUT_MS, onUploadProgress: setUploadProgress },
            );
            if (!response.ok || !response.data?.file) {
                toast.error(response.error || 'Background upload failed');
                return;
            }
            // Build a synthetic LibraryItem so the rest of the multi-bg flow
            // treats local uploads identically to Pexels picks. id is the
            // server file path — resolveAssetPath returns it directly without
            // going through library.json.
            const filePath = response.data.file;
            const publicUrl = api.mediaUrl(filePath);
            const item: LibraryItem = {
                id: filePath,
                url: publicUrl,
                previewUrl: publicUrl,
                image: publicUrl,
                savedAt: new Date().toISOString(),
                kind: response.data.kind,
            };
            setBackgroundItems([...backgroundItems, item]);
            toast.success(`${response.data.kind === 'image' ? 'Image' : 'Video'} added as background`);
        } catch {
            toast.error('Background upload failed');
        } finally {
            setIsUploading(false);
            setUploadProgress(null);
        }
    };

    const handleMusicUpload = async (file: File) => {
        if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
            toast.error(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max upload is ${MAX_UPLOAD_MB} MB.`);
            return;
        }
        setIsUploading(true);
        try {
            const dataUrl = await readFileAsDataUrl(file);
            setUploadProgress(0);
            const response = await api.post(
                '/api/media/upload-audio',
                { dataUrl, filename: file.name },
                undefined,
                { timeout: UPLOAD_TIMEOUT_MS, onUploadProgress: setUploadProgress },
            );
            if (!response.ok || !response.data?.file) {
                toast.error(response.error || 'Music upload failed');
                return;
            }
            setMusicPath(response.data.file);
            toast.success('Music uploaded');
        } catch {
            toast.error('Music upload failed');
        } finally {
            setIsUploading(false);
            setUploadProgress(null);
        }
    };

    const handleRenderCaptionedVideo = async () => {
        if (!sourceMediaPath) {
            toast.error('Upload a sermon audio or video first');
            return;
        }
        if (!transcript || !transcript.length) {
            toast.error('Transcribe the sermon first');
            return;
        }
        // Audio sources need a background. In Auto mode BibleFuel supplies one
        // from the user's library (or AI-generates it), so a manual pick is only
        // required when Auto is off. Video sources bring their own visual layer.
        if (sourceMediaKind === 'audio' && backgroundItems.length === 0 && !autoBackground) {
            toast.error('Pick a video background, or turn on Auto to let BibleFuel choose');
            return;
        }

        const words = reflowWordsFromEditedLines(transcript, editedLines);
        setIsRenderingVideo(true);
        setRenderProgress(0);
        setRenderPhase('preparing');
        setRenderElapsedMs(0);
        const startedAt = Date.now();
        const elapsedTimer = setInterval(() => {
            setRenderElapsedMs(Date.now() - startedAt);
        }, 250);

        try {
            // Multi-bg: send the full ORDERED list as backgroundPaths[]. Server
            // hard-cuts at durationSec/N. Falls back to single-bg when only
            // one is selected (server treats N=1 as the legacy lean path).
            // Manual picks always win; otherwise Auto mode asks the server to
            // choose per-beat from the user's library (and AI-generate if empty).
            const useAuto = autoBackground && backgroundItems.length === 0;
            const payload = sourceMediaKind === 'video'
                ? { videoPath: sourceMediaPath }
                : useAuto
                    ? { audioPath: sourceMediaPath, autoBackground: true }
                    : {
                        audioPath: sourceMediaPath,
                        backgroundPaths: backgroundItems.map((b) => String(b.id)),
                    };
            // Honour the Main Assembly clip's START / DURATION trim. Sent only
            // when set; the server defaults to the full sermon when omitted.
            const assemblyClip = clips[0];
            const trim = {
                startSec: assemblyClip?.startSec ?? undefined,
                durationSec: assemblyClip?.durationSec ?? undefined,
            };
            // POST returns immediately with a jobId; the heavy lifting runs in
            // the background. We track real ffmpeg progress via SSE on the
            // returned jobId so the inline card shows a determinate bar.
            const response = await api.post<{ jobId: string; durationSec: number }>(
                '/api/render/captioned-video',
                {
                    ...payload,
                    ...trim,
                    words,
                    typographyPreset,
                    layout,
                    depth,
                    musicPath: musicPath || undefined,
                    musicVolume,
                    autoDuck,
                    // Only meaningful with 2+ manually-picked backgrounds.
                    syncBackgrounds: backgroundItems.length > 1 && syncBackgrounds,
                },
            );
            if (!response.ok || !response.data?.jobId) {
                clearInterval(elapsedTimer);
                setIsRenderingVideo(false);
                toast.error(response.error || 'Render failed to start');
                return;
            }

            // Open SSE. Token goes on the query string because EventSource
            // can't set Authorization headers — server's requireAuth accepts
            // ?token= as a documented fallback.
            const token = api.getToken();
            const sseUrl = `${api.baseUrl}/api/render/captioned-video-progress/${response.data.jobId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
            const sse = new EventSource(sseUrl);

            const finish = () => {
                clearInterval(elapsedTimer);
                sse.close();
                setIsRenderingVideo(false);
            };

            sse.addEventListener('progress', (e) => {
                const data = JSON.parse((e as MessageEvent).data);
                if (data.phase === 'preparing' || data.phase === 'encoding') setRenderPhase(data.phase);
                if (typeof data.percent === 'number') setRenderProgress(data.percent);
            });
            sse.addEventListener('done', (e) => {
                const data = JSON.parse((e as MessageEvent).data);
                setRenderProgress(100);
                if (data.file) {
                    const fileName = String(data.file).split(/[\\/]/).pop();
                    setRenderedVideo(api.mediaUrl(fileName));
                    toast.success('Captioned video ready');
                }
                finish();
            });
            sse.addEventListener('error', (e) => {
                // Two shapes hit this handler: a real 'error' SSE event from
                // the server (carries a parseable data payload) and a transport
                // error (no data). Treat the latter as a transient blip and let
                // EventSource auto-reconnect — only finalize on the typed
                // server event.
                const raw = (e as MessageEvent).data;
                if (!raw) return;
                try {
                    const data = JSON.parse(raw);
                    toast.error(data.error || 'Render failed');
                } catch {
                    toast.error('Render failed');
                }
                finish();
            });
        } catch {
            clearInterval(elapsedTimer);
            setIsRenderingVideo(false);
            toast.error('Render failed');
        }
        // No finally — completion is owned by the SSE event handlers above
        // (each calls finish() which clears the timer + flips isRendering).
    };

    const fetchRenderHistory = async () => {
        const res = await api.get<{ items: RenderHistoryItem[] }>(
            '/api/render/captioned-video-history?limit=20',
        );
        if (res.ok && Array.isArray(res.data?.items)) {
            setRenderHistory(res.data.items);
        }
    };

    // Refetch history whenever a render completes successfully. Tracking on
    // renderedVideo (set by the SSE 'done' handler) keeps this decoupled from
    // the render handler itself, so any future producer that flips
    // renderedVideo will also refresh the panel.
    useEffect(() => {
        if (renderedVideo) fetchRenderHistory();
    }, [renderedVideo]);

    useEffect(() => {
        const cached = loadJson<TimelineClip[]>(STORAGE_KEYS.timelineClips, []);
        if (cached.length) setClips(cached);
        const cachedHistory = loadJson<AudioItem[]>(STORAGE_KEYS.audioHistory, []);
        if (cachedHistory.length) setAudioHistory(cachedHistory);
        // Fetch on mount so the panel shows past renders even before any new
        // render fires (covers the post-refresh case).
        fetchRenderHistory();
        const cachedAudioPath = loadJson<string>(STORAGE_KEYS.audioPath, '');
        if (cachedAudioPath) setCurrentAudioPath(cachedAudioPath);
    }, []);

    useEffect(() => { void loadTranscriptHistory(); }, [loadTranscriptHistory]);

    useEffect(() => {
        if (!transcript || !transcript.length || !sourceMediaPath || !editedLines.length) return;
        const t = setTimeout(() => { void saveTranscript(transcript, editedLines); }, 1200);
        return () => clearTimeout(t);
    }, [editedLines, transcript, sourceMediaPath, saveTranscript]);

    const saveClipsToCache = (newClips: TimelineClip[]) => {
        saveJson(STORAGE_KEYS.timelineClips, newClips);
    };

    const handleAddClip = (path: string, label?: string) => {
        if (!path.trim()) {
            toast.error('Audio path is required');
            return;
        }
        const clip: TimelineClip = {
            id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            path,
            label,
            startSec: null,
            durationSec: null,
        };
        const next = [...clips, clip];
        setClips(next);
        saveClipsToCache(next);
        setManualPath('');
        setShowAddClipModal(false);
        toast.success('Clip added');
    };

    const handleRemoveClip = (id: string) => {
        const newClips = clips.filter(c => c.id !== id);
        setClips(newClips);
        saveClipsToCache(newClips);
    };

    const handleUpdateClip = (id: string, patch: Partial<TimelineClip>) => {
        const next = clips.map((c) => (c.id === id ? { ...c, ...patch } : c));
        setClips(next);
        saveClipsToCache(next);
    };

    const handleRender = async () => {
        if (clips.length === 0) {
            toast.error('Timeline is empty');
            return;
        }

        const toastId = toast.loading('Rendering timeline audio...');
        try {
            const response = await api.post('/api/audio-adv/timeline', {
                clips: clips.map((c) => ({
                    path: c.path,
                    startSec: c.startSec != null ? c.startSec : undefined,
                    durationSec: c.durationSec != null ? c.durationSec : undefined,
                })),
                normalizeLUFS,
                fades: { inMs: fadeIn, outMs: fadeOut },
                deess: { enabled: deess, amount: 0.55 },
            });

            if (response.ok) {
                toast.success('Audio rendered successfully!', { id: toastId });
                if (response.data?.file) {
                    const fileName = response.data.file.split(/[\\/]/).pop();
                    setRenderedAudio(api.mediaUrl(fileName));
                }
            } else {
                toast.error(response.error || 'Rendering failed', { id: toastId });
            }
        } catch (error) {
            toast.error('An error occurred', { id: toastId });
        }
    };

    const handlePreview = async () => {
        if (clips.length === 0) {
            toast.error('Timeline is empty');
            return;
        }
        if (backgroundItems.length === 0) {
            toast.error('Please select a background first');
            return;
        }

        setIsPreviewing(true);
        try {
            // The legacy /timeline-preview endpoint is single-background only.
            // Use the FIRST selection so this quick-preview UI keeps working
            // even when the captioned-video flow has 4 backgrounds queued.
            const response = await api.post('/api/audio-adv/timeline-preview', {
                clips: clips.map((c) => ({
                    path: c.path,
                    startSec: c.startSec != null ? c.startSec : undefined,
                    durationSec: c.durationSec != null ? c.durationSec : undefined,
                })),
                backgroundPath: backgroundItems[0].id,
                normalizeLUFS,
                fades: { inMs: fadeIn, outMs: fadeOut },
                deess: { enabled: deess, amount: 0.55 },
            });

            if (response.ok && response.data?.file) {
                toast.success('Preview generated!');
                const fileName = response.data.file.split(/[\\/]/).pop();
                setPreviewUrl(api.mediaUrl(fileName));
            } else {
                toast.error(response.error || 'Preview failed');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsPreviewing(false);
        }
    };

    const openLibrary = async () => {
        setShowLibraryModal(true);
        setIsLoadingLibrary(true);
        try {
            const response = await api.get('/api/library');
            if (response.ok && response.data?.library?.items) {
                setLibraryItems(response.data.library.items);
            }
        } catch (error) {
            toast.error('Failed to load library');
        } finally {
            setIsLoadingLibrary(false);
        }
    };

    const totalDuration = useMemo(() => {
        return clips.reduce((acc, c) => acc + (c.durationSec || 0), 0);
    }, [clips]);

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-primary-200">
                        Timeline Editor
                    </h2>
                    <p className="text-content-secondary">Assemble and master your audio clips with precision.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                    <Button variant="secondary" onClick={() => toast.success('Saved')} className="w-full sm:w-auto">
                        <Save size={16} className="mr-2" />
                        Save Project
                    </Button>
                    <Button onClick={handleRender} className="w-full sm:w-auto">
                        <Play size={16} className="mr-2" />
                        Render Audio
                    </Button>
                    <Button
                        onClick={handleRenderCaptionedVideo}
                        disabled={
                            isRenderingVideo
                            || !sourceMediaPath
                            || !transcript
                            || (sourceMediaKind === 'audio' && backgroundItems.length === 0 && !autoBackground)
                        }
                        className="w-full sm:w-auto"
                    >
                        <Film size={16} className="mr-2" />
                        {isRenderingVideo ? 'Rendering...' : 'Render Captioned Video'}
                    </Button>
                </div>
            </div>

            <Card
                title="Source Media"
                tooltip="Your source recording. Audio is mastered into the assembly for an audio render; video keeps its frames for a captioned-video render."
            >
                <p className="text-help mb-3">
                    Drop in a finished sermon — audio (MP3, WAV, M4A) or video (MP4, MOV, WEBM).
                    <span className="text-help"> Up to {MAX_UPLOAD_MB} MB.</span>
                </p>
                <label className="inline-flex items-center gap-3 px-4 py-2 rounded-lg bg-primary-500/10 border border-primary-500/30 text-primary-200 cursor-pointer hover:bg-primary-500/20">
                    <Film size={16} />
                    <span className="text-sm">{isUploading ? 'Uploading...' : 'Choose file'}</span>
                    <input
                        type="file"
                        className="hidden"
                        accept=".mp3,.wav,.m4a,.mp4,.mov,.webm,.m4v"
                        disabled={isUploading}
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleSourceUpload(f);
                        }}
                    />
                </label>
                {sourceMediaPath && (
                    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-gray-300">
                        <span>
                            <span className="text-content-tertiary">Loaded ({sourceMediaKind}):</span>{' '}
                            <span className="font-mono break-all">{sourceMediaPath.split(/[\\/]/).pop()}</span>
                        </span>
                        <button
                            type="button"
                            onClick={() => setTrimTarget({
                                kind: sourceMediaKind === 'video' ? 'video' : 'audio',
                                path: sourceMediaPath,
                                apply: (p) => {
                                    setSourceMediaPath(p);
                                    if (sourceMediaKind !== 'video') {
                                        const clip: TimelineClip = {
                                            id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                                            path: p,
                                            label: p.split(/[\\/]/).pop() || 'clip',
                                            startSec: null,
                                            durationSec: null,
                                        };
                                        setClips([clip]);
                                        saveClipsToCache([clip]);
                                    }
                                },
                            })}
                            className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors"
                        >
                            <Scissors size={12} /> Trim
                        </button>
                    </div>
                )}
            </Card>

            <Card
                title="Transcribe & Caption"
                tooltip="Sends the uploaded sermon through Whisper to extract a word-level transcript with timings. Long sermons are auto-chunked. Edit the lines below — word timings redistribute uniformly across edited spans, so fix transcription errors freely. Pick a kinetic style to control how each word animates on screen."
            >
                <div className="flex items-center justify-between gap-4 mb-4">
                    <p className="text-help">
                        Generate a word-level transcript with timings, then refine the lines below before rendering captions.
                    </p>
                    <div className="flex items-center gap-2 relative">
                        {transcript && transcript.length > 0 && (
                            <>
                                <Button
                                    variant="secondary"
                                    onClick={() => { setTranscript(null); setEditedLines([]); }}
                                    className="h-9 text-xs"
                                    title="Clear the working transcript (saved history is kept)"
                                >
                                    Clear
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={runFreshTranscribe}
                                    disabled={isTranscribing || !sourceMediaPath}
                                    className="h-9 text-xs"
                                    title="Run a fresh Whisper pass (uses render quota)"
                                >
                                    <RotateCcw size={14} className="mr-1.5" />
                                    Re-transcribe
                                </Button>
                            </>
                        )}
                        {transcriptHistory.length > 0 && (
                            <Button
                                variant="secondary"
                                onClick={() => setShowHistory((v) => !v)}
                                className="h-9 text-xs"
                                title="Saved transcripts"
                            >
                                <HistoryIcon size={14} className="mr-1.5" />
                                History
                            </Button>
                        )}
                        <Button
                            onClick={handleTranscribe}
                            disabled={!sourceMediaPath || isTranscribing}
                            className="h-9 text-xs"
                        >
                            <Waves size={14} className="mr-2" />
                            {isTranscribing ? 'Transcribing...' : 'Transcribe'}
                        </Button>

                        {showHistory && (
                            <div className="absolute right-0 top-11 z-30 w-80 max-h-80 overflow-y-auto rounded-xl border border-white/15 bg-dark-900/98 backdrop-blur-xl shadow-2xl p-2">
                                <p className="text-caption px-2 py-1">Saved transcripts</p>
                                {transcriptHistory.map((h) => (
                                    <div key={h.id} className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-white/5">
                                        <button
                                            type="button"
                                            onClick={() => applyTranscriptRecord(h)}
                                            className="flex-1 min-w-0 text-left"
                                        >
                                            <p className="text-content-secondary text-xs truncate">{h.label}</p>
                                            <p className="text-meta">{h.sourceFile} · {h.lineCount} lines</p>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void deleteTranscriptRecord(h.id)}
                                            className="shrink-0 p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-white/5"
                                            aria-label="Delete saved transcript"
                                            title="Delete"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <div className="mb-4">
                    <p className="text-xs text-gray-400 mb-2">Kinetic typography style</p>
                    <AnimationPicker
                        value={typographyPreset}
                        onChange={(id) => setTypographyPreset(id)}
                    />
                    <div className="mt-3">
                        <p className="text-xs text-gray-400 mb-2">Text layout</p>
                        <select
                            value={layout}
                            onChange={(e) => setLayout(e.target.value)}
                            className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-primary-500/40 focus:outline-none"
                        >
                            {LAYOUT_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer mt-3">
                            <input
                                type="checkbox"
                                checked={depth}
                                onChange={(e) => setDepth(e.target.checked)}
                                className="rounded border-white/10 bg-black/50 checked:bg-primary-500"
                            />
                            Layered depth (ghost shadow behind each word)
                        </label>
                    </div>
                </div>
                {editedLines.length > 0 && (
                    <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                        {editedLines.map((line, idx) => (
                            <input
                                key={idx}
                                type="text"
                                value={line}
                                onChange={(e) => {
                                    const next = [...editedLines];
                                    next[idx] = e.target.value;
                                    setEditedLines(next);
                                }}
                                className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-primary-500/40 focus:outline-none"
                            />
                        ))}
                    </div>
                )}
            </Card>

            <Card
                title="Music Bed"
                tooltip="Background music under the sermon. Auto-duck lowers it while someone is speaking and lifts it back between phrases, so the message stays clear."
            >
                <div className="space-y-4">
                    <p className="text-help">
                        Optional background music, mixed under the sermon. MP3, WAV or M4A, <span className="text-help">up to {MAX_UPLOAD_MB} MB.</span>
                    </p>
                    <label className="inline-flex items-center gap-3 px-4 py-2 rounded-lg bg-primary-500/10 border border-primary-500/30 text-primary-200 cursor-pointer hover:bg-primary-500/20">
                        <Music size={16} />
                        <span className="text-sm">{musicPath ? 'Replace music' : 'Choose music file'}</span>
                        <input
                            type="file"
                            className="hidden"
                            accept=".mp3,.wav,.m4a"
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleMusicUpload(f);
                            }}
                        />
                    </label>
                    {musicPath && (
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-gray-300 font-mono break-all">
                                {musicPath.split(/[\\/]/).pop()}
                            </p>
                            <button
                                type="button"
                                onClick={() => setTrimTarget({ kind: 'audio', path: musicPath, apply: setMusicPath })}
                                className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors"
                            >
                                <Scissors size={12} /> Trim
                            </button>
                        </div>
                    )}
                    <div>
                        <label className="block text-xs text-gray-400 mb-1">
                            Music volume: {Math.round(musicVolume * 100)}%
                        </label>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={musicVolume}
                            onChange={(e) => setMusicVolume(Number(e.target.value))}
                            className="w-full"
                        />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-300">
                        <input
                            type="checkbox"
                            checked={autoDuck}
                            onChange={(e) => setAutoDuck(e.target.checked)}
                        />
                        Auto-duck music under speech (sidechain compression)
                    </label>
                </div>
            </Card>

            {isRenderingVideo && (
                <Card
                    title="Rendering captioned video"
                    tooltip="Live progress from the FFmpeg encoder. Percent is computed from the encoder's processed time against the sermon duration, so the bar reflects real work — not a fake animation."
                >
                    <div className="space-y-3">
                        <div className="flex items-baseline justify-between gap-4">
                            <span className="text-sm text-gray-300">
                                {renderPhase === 'preparing' && renderProgress < 1
                                    ? 'Preparing…'
                                    : renderProgress < 100
                                        ? 'Encoding...'
                                        : 'Finalizing...'}
                            </span>
                            <span className="text-xl font-semibold tabular-nums text-primary-300">
                                {renderPhase === 'preparing' && renderProgress < 1
                                    ? ''
                                    : `${Math.round(renderProgress)}%`}
                            </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                            {renderPhase === 'preparing' && renderProgress < 1 ? (
                                // Indeterminate: no real percentage exists yet, so show a
                                // pulsing bar rather than a frozen 0% with a fake ETA.
                                <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-primary-500 to-primary-300 animate-pulse" />
                            ) : (
                                <div
                                    className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-300 transition-[width] duration-300 ease-out"
                                    style={{ width: `${Math.max(2, renderProgress)}%` }}
                                />
                            )}
                        </div>
                        <div className="flex items-center justify-between text-meta tabular-nums">
                            <span>Elapsed {formatElapsed(renderElapsedMs)}</span>
                            <span>
                                {renderPhase === 'preparing' && renderProgress < 1
                                    ? 'Fetching backgrounds & building filters…'
                                    : renderProgress > 1
                                        ? `ETA ~${formatElapsed(estimateEtaMs(renderElapsedMs, renderProgress))}`
                                        : 'Estimating...'}
                            </span>
                        </div>
                    </div>
                </Card>
            )}

            {renderedVideo && !isRenderingVideo && (
                <Card
                    title="Rendered Captioned Video"
                    tooltip="The final sermon with kinetic captions burned onto the original video frames. Click Open to download or share."
                >
                    {/* Vertical (1080x1920) sermons render full-width-by-default would
                        push the page well past the viewport on a wide column. Cap by
                        viewport height instead and center horizontally so the whole
                        frame is always visible without scrolling. */}
                    <video
                        controls
                        src={renderedVideo}
                        className="block mx-auto rounded-lg max-h-[70vh] w-auto max-w-full bg-black"
                    />
                    <div className="mt-3 flex gap-2">
                        <Button
                            onClick={() => setShareUrl(renderedVideo)}
                            className="text-xs h-9"
                        >
                            <Share2 size={16} className="mr-2" />
                            Share
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => { void api.downloadMedia(renderedVideo, `biblefuel-${(renderedVideo.split('/').pop() || 'video').replace(/\.[^.]+$/, '').slice(0, 24)}.mp4`); }}
                            className="text-xs h-9"
                        >
                            <Download size={16} className="mr-2" />
                            Download
                        </Button>
                    </div>
                </Card>
            )}

            {renderHistory.length > 0 && (
                <Card
                    title="Recent Renders"
                    tooltip="Your last 20 captioned-video renders. Click any thumbnail to load it back into the preview above. Renders persist server-side per account."
                >
                    <div className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-2">
                        {renderHistory.map((item) => {
                            const fileName = item.file.split(/[\\/]/).pop() || '';
                            const url = api.mediaUrl(fileName);
                            const isActive = renderedVideo === url;
                            return (
                                <div
                                    key={item.jobId}
                                    className={`group relative shrink-0 w-32 aspect-[9/16] rounded-lg overflow-hidden bg-black/60 border ${isActive ? 'border-primary-400' : 'border-white/10 hover:border-white/30'} transition-colors`}
                                >
                                    {/* Full-area button loads this render back into the preview. */}
                                    <button
                                        type="button"
                                        onClick={() => setRenderedVideo(url)}
                                        className="absolute inset-0 h-full w-full"
                                        title={fileName}
                                    >
                                        {/* Browser-decoded video poster — gives us a real thumbnail
                                            without a separate server-side ffmpeg pass. preload="metadata"
                                            keeps the network cost small (header bytes only). */}
                                        <video
                                            src={url}
                                            preload="metadata"
                                            muted
                                            playsInline
                                            className="h-full w-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                                        />
                                        <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/90 to-transparent text-left">
                                            <p className="text-[10px] font-mono text-white/90 truncate">
                                                {new Date(item.createdAt).toLocaleString(undefined, {
                                                    month: 'short',
                                                    day: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}
                                            </p>
                                            <p className="text-[9px] text-white/60 truncate">
                                                {item.mode === 'video' ? 'video' : 'audio + bg'} · {Math.round(item.durationSec)}s
                                            </p>
                                        </div>
                                    </button>
                                    {/* Share this render — sits above the thumbnail button. */}
                                    <button
                                        type="button"
                                        onClick={() => setShareUrl(url)}
                                        className="absolute top-1 right-1 z-10 rounded-md bg-black/60 p-1.5 text-white/90 opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                                        title="Share this render"
                                        aria-label="Share this render"
                                    >
                                        <Share2 size={13} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </Card>
            )}

            {renderedAudio && (
                <Card title="Rendered Audio">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <audio controls src={renderedAudio} className="w-full" />
                        <Button
                            variant="secondary"
                            onClick={() => { void api.downloadMedia(renderedAudio, `biblefuel-${(renderedAudio.split('/').pop() || 'audio').replace(/\.[^.]+$/, '').slice(0, 24)}.mp3`); }}
                            className="text-xs h-9"
                        >
                            <Download size={16} className="mr-2" />
                            Download
                        </Button>
                    </div>
                </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-3 space-y-6">
                    {/* Timeline Canvas */}
                    <Card className="min-h-[400px] bg-black/40 border-white/5 relative overflow-hidden group">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(var(--primary-500-rgb),0.05),transparent)] pointer-events-none" />

                        <div className="p-6">
                            <div className="flex items-center justify-between mb-8">
                                <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-primary-500/10 flex items-center justify-center text-primary-400">
                                        <Waves size={20} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-lg">Main Assembly</h3>
                                        <p className="text-subtitle">Auto-sequenced timeline</p>
                                    </div>
                                </div>
                                <Button variant="secondary" onClick={() => setShowAddClipModal(true)} className="h-9 px-4 text-xs">
                                    <Plus size={14} className="mr-2" />
                                    Add Clip
                                </Button>
                            </div>

                            {clips.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 text-center opacity-30">
                                    <Music size={48} className="mb-4" />
                                    <p className="text-sm">No clips in timeline.</p>
                                    <p className="text-xs">Add clips from your processed audio list.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {clips.map((clip, idx) => (
                                        <div
                                            key={clip.id}
                                            className="group relative bg-white/[0.02] border border-white/5 rounded-xl p-4 hover:border-primary-500/30 hover:bg-white/[0.04] transition-all"
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex items-start gap-4 flex-1">
                                                    <div className="h-8 w-8 rounded-lg bg-black/40 flex items-center justify-center text-xs font-bold text-gray-500">
                                                        {idx + 1}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-gray-200 truncate">
                                                            {clip.label || clip.path.split('/').pop()}
                                                        </p>
                                                        <p className="text-[10px] text-content-tertiary font-mono break-all">{clip.path}</p>
                                                        <div className="grid grid-cols-2 gap-3 mt-3">
                                                            <label className="text-caption">
                                                                Start (sec)
                                                                <input
                                                                    type="number"
                                                                    value={clip.startSec ?? ''}
                                                                    onChange={(e) => handleUpdateClip(clip.id, { startSec: e.target.value === '' ? null : Number(e.target.value) })}
                                                                    className="mt-1 w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs"
                                                                    min={0}
                                                                    step={0.1}
                                                                />
                                                            </label>
                                                            <label className="text-caption">
                                                                Duration (sec)
                                                                <input
                                                                    type="number"
                                                                    value={clip.durationSec ?? ''}
                                                                    onChange={(e) => handleUpdateClip(clip.id, { durationSec: e.target.value === '' ? null : Number(e.target.value) })}
                                                                    className="mt-1 w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs"
                                                                    min={0}
                                                                    step={0.1}
                                                                />
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleRemoveClip(clip.id)}
                                                    className="p-2 text-gray-600 hover:text-red-400 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Master Controls */}
                    <Card title="Mastering & Filters">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-2">
                            <div className="space-y-4">
                                <label className="text-caption font-bold flex items-center gap-2">
                                    <Volume2 size={14} /> Normalize (LUFS)
                                </label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range"
                                        min="-24"
                                        max="-6"
                                        value={normalizeLUFS}
                                        onChange={(e) => setNormalizeLUFS(Number(e.target.value))}
                                        className="flex-1 accent-primary-500"
                                    />
                                    <span className="text-xs font-mono w-8">{normalizeLUFS}</span>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <label className="text-caption font-bold flex items-center gap-2">
                                    Fade In (ms)
                                </label>
                                <input
                                    type="number"
                                    className="bg-black/20 border border-white/10 rounded px-2 py-1 text-xs w-full font-mono"
                                    value={fadeIn}
                                    onChange={(e) => setFadeIn(Number(e.target.value))}
                                />
                            </div>

                            <div className="space-y-4">
                                <label className="text-caption font-bold flex items-center gap-2">
                                    Fade Out (ms)
                                </label>
                                <input
                                    type="number"
                                    className="bg-black/20 border border-white/10 rounded px-2 py-1 text-xs w-full font-mono"
                                    value={fadeOut}
                                    onChange={(e) => setFadeOut(Number(e.target.value))}
                                />
                            </div>

                            <div className="flex items-center gap-3 pt-6">
                                <input
                                    type="checkbox"
                                    id="deess"
                                    checked={deess}
                                    onChange={(e) => setDeess(e.target.checked)}
                                    className="rounded border-white/10 bg-black/50 checked:bg-primary-500"
                                />
                                <label htmlFor="deess" className="text-xs text-gray-400">Enable De-esser</label>
                            </div>
                        </div>
                    </Card>
                </div>

                <div className="space-y-6">
                    {/* Video Selection — ordered list of up to MAX_BACKGROUNDS
                        clips. Render hard-cuts between them at durationSec/N each. */}
                    <Card
                        title="Video Background"
                        tooltip={`Pick 1–${MAX_BACKGROUNDS} background clips. With more than one, the render hard-cuts between them at equal slots (1/N of the sermon duration each). Use the arrows to reorder.`}
                    >
                        <div className="p-2">
                            {/* Auto background: default on. BibleFuel picks a
                                mood-matched clip per beat from the user's library
                                (AI-generates one if the pool is empty). Picking
                                clips manually below overrides Auto. */}
                            <label className="flex items-start gap-2 mb-3 p-2 rounded-xl border border-primary-500/20 bg-primary-500/5 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={autoBackground}
                                    onChange={(e) => setAutoBackground(e.target.checked)}
                                    className="mt-0.5 accent-primary-500"
                                />
                                <span className="flex-1">
                                    <span className="flex items-center gap-1.5 text-xs font-semibold text-primary-200">
                                        <Sparkles size={13} />
                                        Auto — let BibleFuel choose
                                    </span>
                                    <span className="block text-[10px] text-content-secondary mt-0.5">
                                        {backgroundItems.length > 0
                                            ? 'Overridden — your selected clips below will be used.'
                                            : 'Picks a mood-matched background per beat from your library. Generates one if your library is empty.'}
                                    </span>
                                </span>
                            </label>
                            {backgroundItems.length > 0 ? (
                                <div className="space-y-3">
                                    {backgroundItems.map((item, idx) => (
                                        <div
                                            key={`${item.id}-${idx}`}
                                            className="flex gap-3 bg-black/30 rounded-xl p-2 border border-white/5"
                                        >
                                            <div className="relative w-20 aspect-[9/16] bg-black rounded-lg overflow-hidden shrink-0">
                                                {item.kind === 'image' ? (
                                                    <img
                                                        src={item.previewUrl || item.url}
                                                        alt=""
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <video
                                                        src={item.previewUrl || item.url}
                                                        muted
                                                        loop
                                                        autoPlay
                                                        playsInline
                                                        className="w-full h-full object-cover"
                                                    />
                                                )}
                                                <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-primary-500/80 text-[10px] font-bold text-white">
                                                    {idx + 1}
                                                </span>
                                                {item.kind === 'image' && (
                                                    <span className="absolute top-1 right-1 px-1 py-0.5 rounded bg-black/70 text-[8px] uppercase tracking-wider text-gray-300">
                                                        img
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0 flex flex-col justify-between">
                                                <p className="text-[10px] font-mono text-content-tertiary break-all line-clamp-2">
                                                    ID: {item.id}
                                                </p>
                                                <div className="flex items-center gap-1">
                                                    <Button
                                                        variant="secondary"
                                                        onClick={() => {
                                                            if (idx === 0) return;
                                                            const next = [...backgroundItems];
                                                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                                            setBackgroundItems(next);
                                                        }}
                                                        disabled={idx === 0}
                                                        className="h-7 px-2 text-xs"
                                                        aria-label="Move up"
                                                    >
                                                        ↑
                                                    </Button>
                                                    <Button
                                                        variant="secondary"
                                                        onClick={() => {
                                                            if (idx === backgroundItems.length - 1) return;
                                                            const next = [...backgroundItems];
                                                            [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                                            setBackgroundItems(next);
                                                        }}
                                                        disabled={idx === backgroundItems.length - 1}
                                                        className="h-7 px-2 text-xs"
                                                        aria-label="Move down"
                                                    >
                                                        ↓
                                                    </Button>
                                                    <Button
                                                        variant="secondary"
                                                        onClick={() =>
                                                            setBackgroundItems(
                                                                backgroundItems.filter((_, i) => i !== idx),
                                                            )
                                                        }
                                                        className="h-7 px-2 text-xs bg-red-500/10 text-red-300 border-red-500/20 hover:bg-red-500/30"
                                                        aria-label="Remove"
                                                    >
                                                        <Trash2 size={12} />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {backgroundItems.length > 1 && (
                                        <label className="flex items-start gap-2 px-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={syncBackgrounds}
                                                onChange={(e) => setSyncBackgrounds(e.target.checked)}
                                                className="mt-0.5 accent-primary-500"
                                            />
                                            <span className="text-[10px] text-help">
                                                Sync cuts to speech + crossfade
                                                <span className="block text-content-tertiary">
                                                    {syncBackgrounds
                                                        ? `${backgroundItems.length} clips change on spoken phrases, blended.`
                                                        : `Hard cuts between ${backgroundItems.length} clips, ~equal slots.`}
                                                </span>
                                            </span>
                                        </label>
                                    )}
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button
                                            onClick={openLibrary}
                                            disabled={backgroundItems.length >= MAX_BACKGROUNDS}
                                            variant="secondary"
                                            className="h-9 text-[10px]"
                                        >
                                            <Library size={14} className="mr-1" />
                                            {backgroundItems.length >= MAX_BACKGROUNDS ? 'Library' : 'From library'}
                                        </Button>
                                        <label
                                            className={`inline-flex items-center justify-center gap-1 h-9 text-[10px] rounded-md border ${
                                                backgroundItems.length >= MAX_BACKGROUNDS
                                                    ? 'opacity-40 cursor-not-allowed border-white/10 text-gray-500'
                                                    : 'cursor-pointer border-white/10 text-gray-200 hover:bg-white/5'
                                            }`}
                                        >
                                            <Plus size={14} />
                                            Upload from device
                                            <input
                                                type="file"
                                                className="hidden"
                                                accept=".mp4,.mov,.webm,.m4v,.jpg,.jpeg,.png,.webp"
                                                disabled={backgroundItems.length >= MAX_BACKGROUNDS || isUploading}
                                                onChange={(e) => {
                                                    const f = e.target.files?.[0];
                                                    if (f) handleLocalBackgroundUpload(f);
                                                    e.target.value = ''; // allow re-picking the same file
                                                }}
                                            />
                                        </label>
                                    </div>
                                    {uploadProgress !== null && (
                                        <div className="space-y-1 px-1">
                                            <div className="flex justify-between text-[10px] text-meta">
                                                <span>{uploadProgress < 100 ? 'Uploading…' : 'Processing…'}</span>
                                                <span>{uploadProgress}%</span>
                                            </div>
                                            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                                                <div
                                                    className="h-full bg-primary-500 transition-all duration-150"
                                                    style={{ width: `${uploadProgress}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                    <p className="text-help px-1">
                                        Up to {MAX_UPLOAD_MB} MB per file. Video (mp4, mov, webm) or image (jpg, png, webp).
                                    </p>
                                    <Button
                                        onClick={handlePreview}
                                        isLoading={isPreviewing}
                                        variant="secondary"
                                        className="w-full h-9 text-[10px] border-primary-500/20 text-primary-400"
                                    >
                                        <Film size={14} className="mr-2" />
                                        Preview with First Background
                                    </Button>
                                </div>
                            ) : (
                                <div className="py-10 border-2 border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center text-center px-4 space-y-3">
                                    <Library size={32} className="text-gray-600" />
                                    <p className="text-help">No backgrounds selected</p>
                                    <div className="grid grid-cols-2 gap-2 w-full">
                                        <Button onClick={openLibrary} className="h-9 text-[10px]">
                                            <Library size={14} className="mr-1" />
                                            From library
                                        </Button>
                                        <label
                                            className={`inline-flex items-center justify-center gap-1 h-9 text-[10px] rounded-md border cursor-pointer border-primary-500/30 bg-primary-500/10 text-primary-200 hover:bg-primary-500/20 ${isUploading ? 'opacity-50' : ''}`}
                                        >
                                            <Plus size={14} />
                                            Upload from device
                                            <input
                                                type="file"
                                                className="hidden"
                                                accept=".mp4,.mov,.webm,.m4v,.jpg,.jpeg,.png,.webp"
                                                disabled={isUploading}
                                                onChange={(e) => {
                                                    const f = e.target.files?.[0];
                                                    if (f) handleLocalBackgroundUpload(f);
                                                    e.target.value = '';
                                                }}
                                            />
                                        </label>
                                    </div>
                                    {uploadProgress !== null && (
                                        <div className="space-y-1 w-full px-1">
                                            <div className="flex justify-between text-[10px] text-meta">
                                                <span>{uploadProgress < 100 ? 'Uploading…' : 'Processing…'}</span>
                                                <span>{uploadProgress}%</span>
                                            </div>
                                            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                                                <div
                                                    className="h-full bg-primary-500 transition-all duration-150"
                                                    style={{ width: `${uploadProgress}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                    <p className="text-help px-1">
                                        Up to {MAX_UPLOAD_MB} MB. Video (mp4/mov/webm) or image (jpg/png/webp).
                                    </p>
                                </div>
                            )}
                        </div>
                    </Card>

                    <Card title="Stats" className="opacity-50">
                        <div className="space-y-4 p-2">
                            <div className="flex justify-between text-xs">
                                <span className="text-meta">Total Duration</span>
                                <span className="font-mono text-primary-400">
                                    {totalDuration.toFixed(2)}s
                                </span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-meta">Clips Count</span>
                                <span className="font-mono text-primary-400">{clips.length}</span>
                            </div>
                        </div>
                    </Card>

                    <Card title="Recent Audio">
                        {audioHistory.length === 0 ? (
                            <p className="text-help">No audio history yet.</p>
                        ) : (
                            <div className="space-y-2">
                                {audioHistory.slice(0, 5).map((item) => (
                                    <div key={item.id} className="text-xs text-content-tertiary break-all">
                                        <button
                                            onClick={() => handleAddClip(item.path, item.kind)}
                                            className="text-primary-400 hover:text-primary-300"
                                        >
                                            + Add
                                        </button>
                                        <span className="ml-2">{item.path}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                </div>
            </div>

            {/* Add Clip Modal */}
            {showAddClipModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowAddClipModal(false)} />
                    {/* Plain div (not <Card>) — Card wraps children in an extra
                        <div> that breaks flex flex-col, leaving the inner
                        overflow-y-auto section with no flex parent. Same fix
                        applied to all modals on this page + RenderPage. */}
                    <div className="relative w-full max-w-3xl max-h-[80vh] flex flex-col rounded-xl bg-dark-900/95 backdrop-blur-xl border border-white/20 shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
                            <h3 className="font-bold text-lg text-white">Add Clip</h3>
                            <button onClick={() => setShowAddClipModal(false)} className="text-gray-500 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 p-4 space-y-4 overflow-y-auto overscroll-contain">
                            {currentAudioPath && (
                                <div className="flex items-center justify-between bg-black/30 border border-white/10 rounded-lg p-3">
                                    <div className="text-xs text-gray-300 break-all">{currentAudioPath}</div>
                                    <Button onClick={() => handleAddClip(currentAudioPath, 'current')} className="text-xs h-8">
                                        Add Current
                                    </Button>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Manual audio path</label>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        value={manualPath}
                                        onChange={(e) => setManualPath(e.target.value)}
                                        placeholder="Pick an audio file from your library"
                                        className="flex-1 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
                                    />
                                    <Button onClick={() => handleAddClip(manualPath, 'manual')} className="text-xs h-9">
                                        Add
                                    </Button>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-caption mb-2">Recent Audio</h4>
                                {audioHistory.length === 0 ? (
                                    <p className="text-help">No recent audio found.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {audioHistory.map((item) => (
                                            <div key={item.id} className="flex items-center gap-2 bg-black/20 border border-white/10 rounded-lg p-2">
                                                <div className="flex-1 text-xs text-gray-300 break-all">{item.path}</div>
                                                <Button onClick={() => handleAddClip(item.path, item.kind)} className="text-xs h-8">
                                                    Add
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Library Picker Modal — multi-select up to MAX_BACKGROUNDS.
                Clicking a tile toggles its inclusion in the ordered list;
                selection order = render sequence. Done closes the modal. */}
            {showLibraryModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowLibraryModal(false)} />
                    {/* max-h in dvh (not vh): iOS reports vh against the LARGEST
                        viewport (toolbars hidden), so an 80vh box overflows the
                        actually-visible area when Safari's bottom toolbar is up,
                        pushing the footer Done button off-screen. dvh tracks the
                        live viewport so the footer always stays in view. */}
                    <div className="relative w-full max-w-4xl max-h-[88dvh] flex flex-col rounded-xl bg-dark-900/95 backdrop-blur-xl border border-white/20 shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
                            <div>
                                <h3 className="font-bold text-lg text-white">Select Backgrounds</h3>
                                <p className="text-subtitle mt-1">
                                    {backgroundItems.length} of {MAX_BACKGROUNDS} selected · click to toggle, order = render sequence
                                </p>
                            </div>
                            <button onClick={() => setShowLibraryModal(false)} className="text-gray-500 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                            {isLoadingLibrary ? (
                                <div className="col-span-full py-20 flex justify-center">
                                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-500" />
                                </div>
                            ) : libraryItems.length > 0 ? (
                                libraryItems.map((item) => {
                                    const selectedIdx = backgroundItems.findIndex((b) => b.id === item.id);
                                    const isSelected = selectedIdx >= 0;
                                    const atCap = backgroundItems.length >= MAX_BACKGROUNDS;
                                    const disabled = !isSelected && atCap;
                                    return (
                                        <div
                                            key={item.id}
                                            className={`group relative aspect-[9/16] bg-black rounded-xl overflow-hidden shadow-lg transition-all cursor-pointer ${
                                                isSelected
                                                    ? 'ring-2 ring-primary-400'
                                                    : disabled
                                                        ? 'ring-1 ring-white/10 hover:ring-amber-400/50'
                                                        : 'hover:ring-2 hover:ring-primary-500'
                                            }`}
                                            onClick={() => {
                                                if (isSelected) {
                                                    // Toggle off
                                                    setBackgroundItems(backgroundItems.filter((b) => b.id !== item.id));
                                                } else if (!atCap) {
                                                    // Toggle on — append so order matches the click sequence.
                                                    setBackgroundItems([...backgroundItems, item]);
                                                } else {
                                                    // At cap — guide instead of silently ignoring the tap.
                                                    toast.error(`Max ${MAX_BACKGROUNDS} backgrounds. Remove one to add another.`, { id: 'bg-cap' });
                                                }
                                            }}
                                        >
                                            {/* Full-opacity thumbnails so each background is
                                                clearly distinguishable. At cap, unselected tiles
                                                stay visible (just slightly dimmed) instead of
                                                greying out to an indistinct blur. */}
                                            <img src={item.image} className={`w-full h-full object-cover transition-opacity ${disabled ? 'opacity-70' : 'opacity-100'}`} alt="" />
                                            {isSelected && (
                                                <span className="absolute top-2 left-2 w-7 h-7 rounded-full bg-primary-500 text-white text-sm font-bold flex items-center justify-center shadow-lg">
                                                    {selectedIdx + 1}
                                                </span>
                                            )}
                                            <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                                                <p className="text-[10px] font-mono text-white truncate">ID: {item.id}</p>
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="col-span-full py-20 text-center opacity-30 text-white">
                                    <Library size={48} className="mx-auto mb-4" />
                                    <p>Your library is empty.</p>
                                </div>
                            )}
                        </div>
                        <div className="border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center justify-between gap-3 shrink-0">
                            <Button
                                variant="secondary"
                                onClick={() => setBackgroundItems([])}
                                disabled={backgroundItems.length === 0}
                                className="h-9 text-xs"
                            >
                                Clear all
                            </Button>
                            <Button
                                onClick={() => {
                                    setShowLibraryModal(false);
                                    if (backgroundItems.length > 0) {
                                        toast.success(`${backgroundItems.length} background${backgroundItems.length === 1 ? '' : 's'} selected`);
                                    }
                                }}
                                className="h-9 text-xs"
                            >
                                Done
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Preview Result Modal */}
            {previewUrl && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={() => setPreviewUrl(null)} />
                    <div className="relative w-full max-w-xl animate-in zoom-in-95 duration-200">
                        <Card className="border-primary-500/30 shadow-[0_0_50px_rgba(var(--primary-500-rgb),0.3)]">
                            <div className="aspect-[9/16] bg-black rounded-xl overflow-hidden mb-4 relative">
                                <video
                                    src={previewUrl}
                                    controls
                                    autoPlay
                                    className="w-full h-full object-contain"
                                />
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    onClick={() => { void api.downloadMedia(previewUrl, `biblefuel-${(previewUrl.split('/').pop() || 'preview').replace(/\.[^.]+$/, '').slice(0, 24)}.mp4`); }}
                                    className="flex-1"
                                >
                                    <Download size={16} className="mr-2" />
                                    Download Preview
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={() => setPreviewUrl(null)}
                                >
                                    Close
                                </Button>
                            </div>
                        </Card>
                    </div>
                </div>
            )}

            {shareUrl && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShareUrl(null)} />
                    <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-3 px-1">
                            <h3 className="font-bold text-lg text-white">Share your video</h3>
                            <button onClick={() => setShareUrl(null)} className="text-gray-400 hover:text-white p-1" aria-label="Close">
                                <X size={20} />
                            </button>
                        </div>
                        <ShareSheet
                            videoUrl={shareUrl}
                            caption={editedLines.join(' ').trim()}
                            title={editedLines[0] || ''}
                            filename={`biblefuel-${(shareUrl.split('/').pop() || 'video').replace(/\.[^.]+$/, '').slice(0, 24)}`}
                        />
                    </div>
                </div>
            )}

            {trimTarget && (
                <MediaTrimmer
                    serverPath={trimTarget.path}
                    kind={trimTarget.kind}
                    onCancel={() => setTrimTarget(null)}
                    onApply={(newPath) => { trimTarget.apply(newPath); setTrimTarget(null); }}
                />
            )}
        </div>
    );
}
