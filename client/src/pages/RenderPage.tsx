import { useEffect, useRef, useState, type ChangeEvent, type SyntheticEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Textarea } from '../components/ui/Textarea';
import { Select } from '../components/ui/Select';
import { Field } from '../components/ui/Field';
import { Section } from '../components/ui/Section';
import { GuideSteps, type GuideStep } from '../components/ui/GuideSteps';
import { MusicPicker } from '../components/MusicPicker';
import { api, UPLOAD_TIMEOUT_MS } from '../lib/api';
import toast from 'react-hot-toast';
import { Play, Library, Video, CheckCircle2, ClipboardList, AudioLines, Share2, X as XIcon, Plus, ChevronUp, ChevronDown, Trash2, Sparkles, Scissors } from 'lucide-react';
import { loadJson, saveJson, STORAGE_KEYS, toOutputUrl } from '../lib/storage';
import { LAYOUT_OPTIONS } from '../lib/layoutOptions';
import { usePersistedState } from '../lib/usePersistedState';
import { useConfig } from '../lib/config';
import { useNotifications } from '../lib/notifications';
import { ShareSheet } from '../components/ShareSheet';
import { RenderProgressOverlay } from '../components/RenderProgressOverlay';
import { MediaTrimmer } from '../components/MediaTrimmer';
import { applyGeneratedVisuals, type GenerateMode } from '../lib/generativeVisuals';

/** Mirrors the server's MAX_BACKGROUNDS — keep in sync with render.js. */
const MAX_BACKGROUNDS = 30;
/** Mirrors the server's MAX_INPUT_MB so big uploads fail client-side first. */
const MAX_UPLOAD_MB = 200;

interface LibraryItem {
    id: string;
    url: string;
    previewUrl?: string;
    image: string;
    savedAt?: string;
    /**
     * Optional discriminator for local-file uploads. Library/Pexels entries
     * omit this (treated as video). Set to 'image' for stills so the server
     * uses `-loop 1 -t SEG` instead of `-stream_loop -1`.
     */
    kind?: 'image' | 'video';
}

interface Script {
    title: string;
    hook: string;
    verse: string;
    reference: string;
    reflection: string;
    cta: string;
}

interface AudioItem {
    id: string;
    path: string;
    kind: string;
    createdAt: string;
}

export function RenderPage() {
    const { config } = useConfig();
    const renderEnabled = config.features.render;
    const [backgroundPath, setBackgroundPath] = useState('');
    const [audioPath, setAudioPath] = useState('');
    const [lines, setLines] = useState('');
    const [isRendering, setIsRendering] = useState(false);
    const [renderInBackground, setRenderInBackground] = useState(false);
    // Auto background (default on): when no clip is picked, BibleFuel chooses one
    // per overlay line from the user's library (AI-generates if the pool is
    // empty). Picking clips manually overrides it. Video mode only.
    const [autoBackground, setAutoBackground] = useState(true);
    const [result, setResult] = useState<any>(null);
    const [showLibraryModal, setShowLibraryModal] = useState(false);
    const [libraryItems, setLibraryItems] = useState<any[]>([]);
    const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
    const [trimTarget, setTrimTarget] = useState<
      | { kind: 'audio' | 'video'; path: string; apply: (p: string) => void }
      | null
    >(null);
    // Ordered list of backgrounds — Pexels picks + local uploads. When > 1
    // the render switches to the queued scenes[] path on the server (hard
    // cuts at equal slots). Persisted so a refresh keeps the picks.
    const [backgroundItems, setBackgroundItems] = usePersistedState<LibraryItem[]>(
        STORAGE_KEYS.renderBackgrounds,
        [],
    );
    const [isUploadingBackground, setIsUploadingBackground] = useState(false);
    const [showScriptsModal, setShowScriptsModal] = useState(false);
    const [scripts, setScripts] = useState<Script[]>([]);
    const [audioHistory, setAudioHistory] = useState<AudioItem[]>([]);
    const [aspect, setAspect] = useState<'portrait' | 'landscape' | 'square'>('portrait');
    const [captionWidth, setCaptionWidth] = useState(90);
    const [musicPath, setMusicPath] = useState('');
    const [musicVolume, setMusicVolume] = useState(0.3);
    const [autoDuck, setAutoDuck] = useState(true);
    const [durationSec, setDurationSec] = useState(20);
    const [kineticCaptions, setKineticCaptions] = useState(false);
    const [ttsVoiceId, setTtsVoiceId] = useState('');
    const [genVisualsMode, setGenVisualsMode] = useState<GenerateMode>('alongside');
    const [genVisualsCount, setGenVisualsCount] = useState(2);
    const [isGeneratingVisuals, setIsGeneratingVisuals] = useState(false);
    const [kenBurns, setKenBurns] = useState(false);
    const [typographyPreset, setTypographyPreset] = useState<string>('cinematic-default');
    const [layout, setLayout] = useState<string>('center');
    const [depth, setDepth] = useState<boolean>(false);
    const [animations, setAnimations] = useState<Array<{ id: string; label: string; renderable: boolean }>>([]);
    const [postDestination, setPostDestination] = useState<'webhook' | 'buffer' | 'youtube' | 'instagram' | 'tiktok'>('webhook');
    const [youtubePrivacy, setYoutubePrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
    const [webhookOptions, setWebhookOptions] = useState<{ id: string; name: string }[]>([]);
    const [selectedWebhook, setSelectedWebhook] = useState('');
    const [bufferProfiles, setBufferProfiles] = useState<string[]>([]);
    const [selectedProfile, setSelectedProfile] = useState('');
    const [jobVideoOptions, setJobVideoOptions] = useState<{ id: string; label: string; path: string }[]>([]);
    const [shareVideoPath, setShareVideoPath] = useState('');
    const [completedRender, setCompletedRender] = useState<{ jobId: string; file: string; jobType?: string } | null>(null);
    const [activeBackgroundJob, setActiveBackgroundJob] = useState<{ id: string; kind: 'video' | 'waveform'; progress: number } | null>(null);
    const myEnqueuedJobsRef = useRef<Set<string>>(new Set());
    const lastRenderKindRef = useRef<'video' | 'waveform'>('video');
    const notifications = useNotifications();
    const location = useLocation();
    const navigate = useNavigate();

    const toMediaUrl = (value: string | undefined | null) => toOutputUrl(value, api.mediaBaseUrl);
    const isVideoUrl = (value: string | undefined | null) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(String(value || ''));
    const deriveThumbUrl = (value: string | undefined | null) => {
        const raw = String(value || '').replace(/\\/g, '/').trim();
        if (!raw || raw.startsWith('http://') || raw.startsWith('https://')) return '';
        const file = raw.split('/').pop() || '';
        const stem = file.replace(/\.[^.]+$/, '');
        if (!stem) return '';
        return toMediaUrl(`/outputs/${stem}.jpg`);
    };
    const getImageSrc = (item: any) => {
        return toMediaUrl(item?.image) || deriveThumbUrl(item?.previewUrl || item?.url) || '';
    };
    const handleImageError = (event: SyntheticEvent<HTMLImageElement>, item: any) => {
        const fallback = deriveThumbUrl(item?.previewUrl || item?.url);
        const img = event.currentTarget;
        const alreadyTried = img.dataset.fallbackApplied === '1';
        if (!alreadyTried && fallback && img.src !== fallback) {
            img.dataset.fallbackApplied = '1';
            img.src = fallback;
            return;
        }
        img.style.display = 'none';
    };

    useEffect(() => {
        const cachedScripts = loadJson<Script[]>(STORAGE_KEYS.scripts, []);
        if (cachedScripts.length) setScripts(cachedScripts);
        const cachedAudioPath = loadJson<string>(STORAGE_KEYS.audioPath, '');
        if (cachedAudioPath) setAudioPath(cachedAudioPath);
        const cachedHistory = loadJson<AudioItem[]>(STORAGE_KEYS.audioHistory, []);
        if (cachedHistory.length) setAudioHistory(cachedHistory);
        const cachedLines = loadJson<string>(STORAGE_KEYS.renderLines, '');
        if (cachedLines) setLines(cachedLines);
        const cachedBg = loadJson<string>(STORAGE_KEYS.renderBackgroundPath, '');
        if (cachedBg) setBackgroundPath(cachedBg);
        const cachedBgMode = loadJson<boolean>(STORAGE_KEYS.renderInBackground, false);
        if (cachedBgMode) setRenderInBackground(cachedBgMode);
        const cachedAspect = loadJson<'portrait' | 'landscape' | 'square'>(STORAGE_KEYS.renderAspect, 'portrait');
        setAspect(cachedAspect);
        const cachedCaptionWidth = loadJson<number>(STORAGE_KEYS.renderCaptionWidth, 90);
        setCaptionWidth(cachedCaptionWidth);
        const cachedMusicPath = loadJson<string>(STORAGE_KEYS.renderMusicPath, '');
        if (cachedMusicPath) setMusicPath(cachedMusicPath);
        const cachedMusicVol = loadJson<number>(STORAGE_KEYS.renderMusicVolume, 0.3);
        setMusicVolume(cachedMusicVol);
        const cachedAutoDuck = loadJson<boolean>(STORAGE_KEYS.renderAutoDuck, true);
        setAutoDuck(cachedAutoDuck);
        const cachedDuration = loadJson<number>(STORAGE_KEYS.renderDurationSec, 20);
        setDurationSec(cachedDuration);
        const cachedTtsVoice = loadJson<string>(STORAGE_KEYS.ttsVoiceId, '');
        if (cachedTtsVoice) setTtsVoiceId(cachedTtsVoice);
        const cachedTypography = loadJson<string>(STORAGE_KEYS.renderTypographyPreset, 'cinematic-default');
        setTypographyPreset(cachedTypography);
        const cachedLayout = loadJson<string>(STORAGE_KEYS.renderLayout, 'center');
        setLayout(cachedLayout);
        const cachedDepth = loadJson<boolean>(STORAGE_KEYS.renderDepth, false);
        setDepth(cachedDepth);
    }, []);

    useEffect(() => {
        saveJson(STORAGE_KEYS.renderTypographyPreset, typographyPreset);
    }, [typographyPreset]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.renderLayout, layout);
    }, [layout]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.renderDepth, depth);
    }, [depth]);

    // Load the kinetic caption-animation catalog so the dropdown lists the
    // word-synced animations (cinematic-worship, word-boxes, hero-bold, …) in
    // addition to the classic presets. Falls back to classic-only if it fails.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const res = await api.get<{ ok: boolean; animations: Array<{ id: string; label: string; renderable: boolean }> }>(
                '/api/tts/animations',
            );
            if (!cancelled && res.ok && res.data?.animations) setAnimations(res.data.animations);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (ttsVoiceId) saveJson(STORAGE_KEYS.ttsVoiceId, ttsVoiceId);
    }, [ttsVoiceId]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.audioPath, audioPath);
    }, [audioPath]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.renderLines, lines);
    }, [lines]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.renderBackgroundPath, backgroundPath);
    }, [backgroundPath]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.renderInBackground, renderInBackground);
    }, [renderInBackground]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.renderAspect, aspect);
    }, [aspect]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.renderCaptionWidth, captionWidth);
    }, [captionWidth]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.renderMusicPath, musicPath);
    }, [musicPath]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.renderMusicVolume, musicVolume);
    }, [musicVolume]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.renderAutoDuck, autoDuck);
    }, [autoDuck]);

    useEffect(() => {
        saveJson(STORAGE_KEYS.renderDurationSec, durationSec);
    }, [durationSec]);

    const isLongRender = durationSec > 60;

    useEffect(() => {
        if (isLongRender && !renderInBackground) {
            setRenderInBackground(true);
        }
    }, [isLongRender, renderInBackground]);

    // Handle deep-link: /render?share=<jobId> — fetch that job and surface the banner
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const jobId = params.get('share');
        if (!jobId) return;
        let cancelled = false;
        (async () => {
            const res = await api.get(`/api/jobs/${encodeURIComponent(jobId)}`);
            if (cancelled) return;
            const job = res.ok ? (res.data?.job || res.data) : null;
            if (job && (job.status === 'done' || job.status === 'failed')) {
                const file = job.result?.outFile || job.result?.file || '';
                setCompletedRender({ jobId, file, jobType: job.type });
                if (file) setShareVideoPath(file);
            }
        })();
        // strip the query param once consumed so banner doesn't reappear on back/forward
        navigate(location.pathname, { replace: true });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // React to notifications for jobs enqueued from this page
    useEffect(() => {
        if (completedRender) return;
        const match = notifications.find((n) => {
            if (n.kind !== 'job_done' && n.kind !== 'job_failed') return false;
            const jobId = (n.meta?.jobId as string | undefined) || '';
            return jobId && myEnqueuedJobsRef.current.has(jobId);
        });
        if (match) {
            const jobId = (match.meta?.jobId as string) || '';
            const file = (match.meta?.file as string | undefined) || '';
            // Clear the in-flight overlay regardless of done/failed.
            setActiveBackgroundJob((curr) => (curr && curr.id === jobId ? null : curr));
            if (match.kind === 'job_done') {
                setCompletedRender({ jobId, file, jobType: match.meta?.jobType as string | undefined });
                if (file) setShareVideoPath(file);
            }
        }
    }, [notifications, completedRender]);

    // Poll progress for the active background job so the overlay's progress
    // bar reflects what ffmpeg is actually doing. The global notification
    // poller runs every 8s and only fires on terminal states; we need
    // finer-grained progress here, hence a separate 2s poll while the overlay
    // is up.
    useEffect(() => {
        if (!activeBackgroundJob) return;
        let cancelled = false;
        const pollOne = async () => {
            try {
                const res = await api.get(`/api/jobs/${activeBackgroundJob.id}`);
                if (cancelled) return;
                const job = res.ok ? (res.data?.job || res.data) : null;
                if (!job) return;
                if (job.status === 'done' || job.status === 'failed') {
                    setActiveBackgroundJob(null);
                    return;
                }
                if (typeof job.progress === 'number') {
                    setActiveBackgroundJob((curr) => curr ? { ...curr, progress: job.progress } : curr);
                }
            } catch { /* swallow — next tick retries */ }
        };
        void pollOne();
        const id = setInterval(pollOne, 2000);
        return () => { cancelled = true; clearInterval(id); };
    }, [activeBackgroundJob?.id]);

    const buildLinesFromScript = (script: Script) => {
        return [
            script.hook,
            `${script.verse} (${script.reference})`,
            script.reflection,
            script.cta,
        ].filter(Boolean).join('\n');
    };

    const handleRender = async (mode: 'video' | 'waveform') => {
        const hasMultiBg = backgroundItems.length > 0;
        // Auto mode (video only) lets the server source a background, so a manual
        // pick isn't required. Waveform still needs an explicit background.
        const useAuto = autoBackground && mode === 'video' && !backgroundPath && !hasMultiBg;
        if (!backgroundPath && !hasMultiBg && !useAuto) {
            toast.error('Background is required (or turn on Auto for video)');
            return;
        }
        const cleanLines = lines.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6);
        if (cleanLines.length === 0) {
            toast.error('Overlay text lines are required (max 6)');
            return;
        }
        if (mode === 'waveform' && !audioPath.trim()) {
            toast.error('Audio Path is required for waveform mode');
            return;
        }
        if (mode === 'waveform' && backgroundItems.length > 1) {
            toast.error('Waveform render uses a single background. Remove extras or use Video Render.');
            return;
        }
        // Kinetic captions require the async worker path (it does TTS-with-timestamps
        // server-side, which can take several seconds before render even starts).
        // voiceId is optional — server falls back to ELEVENLABS_VOICE_ID env / Sarah.
        // Multi-bg (scenes[]) also forces background mode — only the queued
        // renderAdvancedVideo path knows how to splice scenes.
        const isMultiBg = mode === 'video' && backgroundItems.length > 1;
        // Auto must run on the async path: the server picks per-beat scenes from
        // the user's library (or AI-generates), which only renderVideoCore does.
        const useBackground = renderInBackground || (kineticCaptions && mode === 'video') || isMultiBg || useAuto;

        setIsRendering(true);
        lastRenderKindRef.current = mode;
        // Clear any previous completion banner so the overlay isn't competing
        // with a stale "Render complete" card from the last job.
        setCompletedRender(null);
        setResult(null);
        try {
            const endpoint = useBackground ? '/api/jobs/enqueue' : `/api/render/${mode}`;
            // Single-bg path uses `backgroundPath`; multi-bg path uses
            // `scenes[]` with equal slots and explicit kind so the server
            // picks `-loop 1` for images vs `-stream_loop -1` for videos.
            const primaryBg = backgroundItems[0]?.id || backgroundPath;
            const perSlotSec = isMultiBg
                ? Math.max(0.5, durationSec / backgroundItems.length)
                : 0;
            const scenesPayload = isMultiBg
                ? {
                    scenes: backgroundItems.map((b) => ({
                        backgroundPath: String(b.id),
                        duration: perSlotSec,
                        kind: b.kind || 'video',
                    })),
                }
                : useAuto
                    ? { autoBackground: true }
                    : { backgroundPath: primaryBg };
            const corePayload = {
                ...scenesPayload,
                audioPath,
                lines: cleanLines,
                durationSec,
                aspect,
                captionWidthPct: captionWidth,
                musicPath: musicPath || undefined,
                musicVolume,
                autoDuck,
                typographyPreset,
                kenBurns,
                layout,
                depth,
                ...(kineticCaptions && mode === 'video'
                    ? { kineticCaptions: true, ...(ttsVoiceId.trim() ? { voiceId: ttsVoiceId.trim() } : {}) }
                    : {}),
            };
            const payload = useBackground
                ? { type: mode === 'video' ? 'render_video' : 'render_waveform', payload: corePayload }
                : corePayload;

            const response = await api.post(endpoint, payload);

            if (response.ok) {
                if (useBackground) {
                    const newJobId: string | undefined = response.data?.id || response.data?.job?.id;
                    if (newJobId) {
                        myEnqueuedJobsRef.current.add(newJobId);
                        setActiveBackgroundJob({ id: newJobId, kind: mode, progress: 0 });
                    }
                    toast.success(kineticCaptions ? 'Kinetic render queued — voice + word captions in progress' : 'Job enqueued — you\'ll be notified when it\'s ready');
                } else {
                    toast.success('Video rendered successfully!');
                    setResult(response.data);
                }
            } else {
                toast.error(response.error || 'Rendering failed');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsRendering(false);
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


    /**
     * Toggle a library item in the ordered backgroundItems list. First click
     * adds it; clicking an already-selected item removes it. Order = render
     * sequence. Modal stays open so the user can build a multi-bg list.
     */
    const toggleBackgroundItem = (item: any) => {
        const exists = backgroundItems.some((b) => b.id === item.id);
        if (exists) {
            setBackgroundItems(backgroundItems.filter((b) => b.id !== item.id));
            return;
        }
        if (backgroundItems.length >= MAX_BACKGROUNDS) {
            toast.error(`Max ${MAX_BACKGROUNDS} backgrounds. Remove one to add another.`, { id: 'bg-cap' });
            return;
        }
        const normalized: LibraryItem = {
            id: item.id,
            url: item.url,
            previewUrl: item.previewUrl,
            image: item.image,
            savedAt: item.savedAt,
            kind: item.kind,
        };
        setBackgroundItems([...backgroundItems, normalized]);
        // Keep the legacy single-bg field aligned so the instant path (which
        // reads backgroundPath) still works when only one is picked.
        if (backgroundItems.length === 0) setBackgroundPath(String(item.id));
    };

    /**
     * Upload a local video or image as a background. Slots into the same
     * backgroundItems list as Pexels picks — order matters; new uploads
     * append. Server `/upload-background` returns `{file, kind}` where kind
     * discriminates image vs video for the scenes[] payload.
     */
    const handleLocalBackgroundUpload = async (file: File) => {
        if (backgroundItems.length >= MAX_BACKGROUNDS) {
            toast.error(`Max ${MAX_BACKGROUNDS} backgrounds. Remove one to add another.`);
            return;
        }
        if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
            toast.error(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max upload is ${MAX_UPLOAD_MB} MB.`);
            return;
        }
        setIsUploadingBackground(true);
        try {
            const response = await api.uploadRaw<{ file: string; kind: 'image' | 'video' }>(
                '/api/media/upload-background',
                file,
                { filename: file.name, timeout: UPLOAD_TIMEOUT_MS },
            );
            if (!response.ok || !response.data?.file) {
                toast.error(response.error || 'Background upload failed');
                return;
            }
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
            const next = [...backgroundItems, item];
            setBackgroundItems(next);
            if (next.length === 1) setBackgroundPath(filePath);
            toast.success(`${response.data.kind === 'image' ? 'Image' : 'Video'} added as background`);
        } catch {
            toast.error('Background upload failed');
        } finally {
            setIsUploadingBackground(false);
        }
    };


    const handleGenerateVisuals = async () => {
        const scriptLines = lines.split('\n').map((l) => l.trim()).filter(Boolean);
        if (scriptLines.length === 0) { toast.error('Add some script lines first'); return; }
        setIsGeneratingVisuals(true);
        const toastId = toast.loading('Generating visuals from your script…');
        try {
            const res = await api.post('/api/imagegen/generate', { lines: scriptLines, count: genVisualsCount, aspect });
            if (!res.ok || !Array.isArray(res.data?.items) || res.data.items.length === 0) {
                if (res.status === 503) { toast.error('AI visuals aren\'t configured on this server yet.', { id: toastId }); return; }
                if (res.status === 429) { toast.error('Daily AI-image limit reached. Try again tomorrow or upgrade.', { id: toastId }); return; }
                toast.error(res.error || 'Could not generate visuals', { id: toastId });
                return;
            }
            const generatedItems = (res.data.items as Array<{ id: string; publicUrl: string }>).map((it) => {
                const mediaUrl = `${api.mediaBaseUrl}${it.publicUrl}`;
                return { id: it.id, url: mediaUrl, previewUrl: mediaUrl, image: mediaUrl, kind: 'image' as const, savedAt: new Date().toISOString() };
            });
            const next = applyGeneratedVisuals(backgroundItems as never[], generatedItems as never[], genVisualsMode, MAX_BACKGROUNDS) as typeof backgroundItems;
            setBackgroundItems(next);
            if (next.length > 0 && !backgroundPath) setBackgroundPath(String(next[0].id));
            const failedNote = res.data.failed ? ` (${res.data.failed} failed)` : '';
            toast.success(`Added ${res.data.generated} AI visual${res.data.generated === 1 ? '' : 's'}${failedNote}`, { id: toastId });
        } catch {
            toast.error('Could not generate visuals', { id: toastId });
        } finally {
            setIsGeneratingVisuals(false);
        }
    };

    const moveBackgroundUp = (idx: number) => {
        if (idx <= 0) return;
        const next = [...backgroundItems];
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
        setBackgroundItems(next);
    };

    const moveBackgroundDown = (idx: number) => {
        if (idx >= backgroundItems.length - 1) return;
        const next = [...backgroundItems];
        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
        setBackgroundItems(next);
    };

    const removeBackground = (idx: number) => {
        setBackgroundItems(backgroundItems.filter((_, i) => i !== idx));
    };

    const loadSocialConfig = async () => {
        const res = await api.get('/api/social/config');
        if (res.ok && res.data) {
            setWebhookOptions(res.data.webhooks || []);
            setSelectedWebhook(res.data.webhooks?.[0]?.id || '');
            setBufferProfiles(res.data.buffer?.profileIds || []);
            setSelectedProfile(res.data.buffer?.profileIds?.[0] || '');
        }
    };

    useEffect(() => {
        loadSocialConfig();
    }, []);

    const loadJobVideos = async () => {
        const items: { id: string; label: string; path: string }[] = [];
        const seen = new Set<string>();

        const res = await api.get('/api/jobs');
        if (res.ok && res.data?.jobs) {
            (res.data.jobs as any[])
                .filter((j) => j.status === 'done' && j.type === 'render_video' && j.result?.outFile)
                .map((j) => ({
                    id: j.id,
                    label: `${j.id.slice(0, 8)} • ${new Date(j.createdAt).toLocaleString()}`,
                    path: j.result.outFile,
                }))
                .forEach((item) => {
                    const key = String(item.path || '');
                    if (!key || seen.has(key)) return;
                    seen.add(key);
                    items.push(item);
                });
        }

        const media = await api.get('/api/media/video-list');
        if (media.ok && media.data?.items) {
            (media.data.items as any[]).forEach((entry) => {
                const mediaPath = String(entry?.path || '').trim();
                if (!mediaPath || seen.has(mediaPath)) return;
                seen.add(mediaPath);
                items.push({
                    id: `media_${entry?.name || mediaPath}`,
                    label: `media • ${entry?.name || mediaPath.split(/[\\/]/).pop()}`,
                    path: mediaPath,
                });
            });
        }

        setJobVideoOptions(items);
        if (!shareVideoPath && !result?.file && items.length > 0) {
            setShareVideoPath(items[0].path);
        }
    };

    useEffect(() => {
        loadJobVideos();
    }, []);

    useEffect(() => {
        if (result?.file) setShareVideoPath(result.file);
    }, [result?.file]);

    const handleShare = async () => {
        const effectivePath = shareVideoPath || result?.file;
        const fileUrl = effectivePath ? toOutputUrl(effectivePath, api.mediaBaseUrl) : '';
        if (!fileUrl) {
            toast.error('Render a video first');
            return;
        }
        const caption = lines.split('\n').filter(Boolean).join(' ');
        if (!caption) {
            toast.error('Caption is empty');
            return;
        }

        const payload: any = {
            destination: postDestination,
            caption,
            videoUrl: fileUrl,
        };
        if (postDestination === 'webhook') payload.webhookId = selectedWebhook;
        if (postDestination === 'buffer') payload.profileIds = [selectedProfile];
        if (postDestination === 'youtube') payload.privacyStatus = youtubePrivacy;

        const res = await api.post('/api/social/post', payload);
        if (res.ok) toast.success('Share triggered');
        else toast.error(res.error || 'Share failed');
    };

    const isRenderInFlight = isRendering || !!activeBackgroundJob;
    const overlayKind: 'video' | 'waveform' = activeBackgroundJob?.kind ?? lastRenderKindRef.current;
    const overlayMode: 'instant' | 'queued' = activeBackgroundJob ? 'queued' : 'instant';
    const overlayProgress = activeBackgroundJob?.progress;

    // Live readiness checklist driving the steps banner. Mirrors the guard
    // logic in handleRender() so the ticks match what the render buttons
    // actually require: a background (or Auto on) + at least one overlay line.
    const cleanLineCount = lines.split('\n').map((l) => l.trim()).filter(Boolean).length;
    const usingAutoBackground = autoBackground && !backgroundPath.trim() && backgroundItems.length === 0;
    const hasBackground = Boolean(backgroundPath.trim()) || backgroundItems.length > 0 || usingAutoBackground;
    const hasVoice = Boolean(audioPath.trim());
    const backgroundDetail = usingAutoBackground
        ? 'Auto is on — BibleFuel will pick mood-matched clips for you (video only).'
        : backgroundItems.length > 1
            ? `${backgroundItems.length} clips — hard cuts between them.`
            : 'A clip or image is selected.';
    const renderSteps: GuideStep[] = [
        {
            label: hasBackground ? 'Background ready' : 'Choose a background',
            status: hasBackground ? 'done' : 'todo',
            detail: hasBackground
                ? backgroundDetail
                : 'Pick from your library, upload one, generate AI visuals — or leave Auto on.',
        },
        {
            label: cleanLineCount > 0
                ? `Overlay text ready (${cleanLineCount}/6 line${cleanLineCount === 1 ? '' : 's'})`
                : 'Add overlay text',
            status: cleanLineCount > 0 ? 'done' : 'todo',
            detail: 'One line per caption slide, up to 6. This is required.',
        },
        {
            label: hasVoice ? 'Voice track selected' : 'Add a voice track',
            status: hasVoice ? 'done' : 'optional',
            detail: hasVoice
                ? 'Used as narration. Turn on Kinetic captions below for word-by-word reveal.'
                : 'Optional with a video background; required for waveform. Make one in Voice & Audio.',
        },
    ];

    return (
        <div className="space-y-6 animate-fade-in">
            <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-primary-200">
                Video Renderer
            </h2>

            <RenderProgressOverlay
                active={isRenderInFlight && !completedRender && !result?.file}
                progress={overlayProgress}
                kind={overlayKind}
                mode={overlayMode}
            />

            {completedRender && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 shadow-[0_10px_40px_rgba(16,185,129,0.15)] animate-fade-in">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                        <CheckCircle2 size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-white">Render complete</p>
                            {completedRender.file && (
                                <p className="text-[10px] font-mono text-emerald-200/80 truncate">{completedRender.file}</p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {completedRender.file && (
                            <Button
                                variant="secondary"
                                className="h-9 text-xs border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20"
                                onClick={() => {
                                    const url = toOutputUrl(completedRender.file, api.mediaBaseUrl);
                                    window.open(url, '_blank');
                                }}
                            >
                                <Play size={14} className="mr-1.5" />
                                Open
                            </Button>
                        )}
                        {completedRender.file && (
                            <Button
                                className="h-9 text-xs"
                                onClick={() => {
                                    setShareVideoPath(completedRender.file);
                                    document.getElementById('share-kit')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }}
                            >
                                <Share2 size={14} className="mr-1.5" />
                                Share
                            </Button>
                        )}
                        <button
                            onClick={() => setCompletedRender(null)}
                            className="p-2 text-gray-400 hover:text-white transition-colors"
                            aria-label="Dismiss"
                        >
                            <XIcon size={16} />
                        </button>
                    </div>
                </div>
            )}

            {completedRender?.file && !result?.file && (
                <Card title="Share your video" className="border-emerald-500/20 bg-emerald-500/[0.03]">
                    <ShareSheet
                        videoUrl={toOutputUrl(completedRender.file, api.mediaBaseUrl)}
                        caption={lines.split('\n').filter(Boolean).join(' ')}
                        title={lines.split('\n').filter(Boolean)[0]}
                        filename={`biblefuel-${new Date().toISOString().slice(0, 10)}`}
                    />
                </Card>
            )}

            <GuideSteps
                storageKey="render"
                title="What you need to render"
                steps={renderSteps}
                tip={<>Soundtrack, frame size and duration are optional — set them below. Long renders (60s+) and kinetic captions run in the background and notify you when ready.</>}
            />

            <Card title="Configuration">
                {!renderEnabled && (
                    <div className="mb-4 text-xs text-yellow-200 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                        Rendering is disabled because FFmpeg was not detected on the server.
                    </div>
                )}
                <div className="space-y-4">
                    <Field
                        label="Background"
                        tooltip={`Pick 1–${MAX_BACKGROUNDS} clips or images. With more than one, the render hard-cuts between them at equal slots (durationSec/N each) and automatically queues as a background job. Use the arrows to reorder.`}
                    >
                        {/* Auto background (video): default on. BibleFuel picks one
                            clip per overlay line from your library, generating one if
                            the library is empty. Picking clips below overrides it. */}
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
                                    Auto — let BibleFuel choose (video)
                                </span>
                                <span className="block text-[10px] text-content-secondary mt-0.5">
                                    {backgroundItems.length > 0 || backgroundPath
                                        ? 'Overridden — your selected background will be used.'
                                        : 'Picks a mood-matched clip per line from your library. Generates one if it’s empty.'}
                                </span>
                            </span>
                        </label>
                        {backgroundItems.length > 0 ? (
                            <div className="space-y-2">
                                <ul className="space-y-2 max-h-[22rem] overflow-y-auto pr-1">
                                    {backgroundItems.map((item, idx) => {
                                        const isImage = item.kind === 'image';
                                        return (
                                            <li
                                                key={`${item.id}-${idx}`}
                                                className="flex items-center gap-2 p-2 rounded-lg border border-white/10 bg-white/[0.03]"
                                            >
                                                <div className="relative w-12 h-16 bg-black rounded overflow-hidden flex-shrink-0">
                                                    <img
                                                        src={getImageSrc(item)}
                                                        className="w-full h-full object-cover"
                                                        alt=""
                                                        loading="lazy"
                                                        onError={(e) => handleImageError(e, item)}
                                                    />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-500/20 text-primary-200 font-semibold">
                                                            {idx + 1}/{backgroundItems.length}
                                                        </span>
                                                        {isImage && (
                                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">
                                                                img
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-[10px] font-mono text-content-tertiary truncate mt-0.5">
                                                        {String(item.id).split(/[\\/]/).pop()}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    <button
                                                        onClick={() => moveBackgroundUp(idx)}
                                                        disabled={idx === 0}
                                                        className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                                        aria-label="Move up"
                                                    >
                                                        <ChevronUp size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => moveBackgroundDown(idx)}
                                                        disabled={idx === backgroundItems.length - 1}
                                                        className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                                        aria-label="Move down"
                                                    >
                                                        <ChevronDown size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => removeBackground(idx)}
                                                        className="p-1.5 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-300"
                                                        aria-label="Remove"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                    {item.kind === 'video' && item.id && (
                                                      <button
                                                        type="button"
                                                        onClick={() => setTrimTarget({
                                                          kind: 'video',
                                                          path: item.id,
                                                          apply: (p) => setBackgroundItems(backgroundItems.map((b) => b.id === item.id ? { ...b, id: p, url: api.mediaUrl(p), previewUrl: api.mediaUrl(p), image: api.mediaUrl(p) } : b)),
                                                        })}
                                                        className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-black/50 text-primary-200 hover:bg-black/70"
                                                        title="Trim this clip"
                                                        aria-label="Trim this clip"
                                                      >
                                                        <Scissors size={13} />
                                                      </button>
                                                    )}
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                                {backgroundItems.length > 1 && (
                                    <p className="text-[10px] text-amber-300/80">
                                        Hard cuts between {backgroundItems.length} clips, ~{(durationSec / backgroundItems.length).toFixed(1)}s each. Auto-queues as background job.
                                    </p>
                                )}
                                <div className="grid grid-cols-2 gap-2">
                                    <Button
                                        onClick={openLibrary}
                                        variant="secondary"
                                        className="h-9 text-xs border-dashed border-white/10"
                                        disabled={backgroundItems.length >= MAX_BACKGROUNDS}
                                    >
                                        <Library size={14} className="mr-1.5" />
                                        {backgroundItems.length >= MAX_BACKGROUNDS ? 'Library' : 'Add from library'}
                                    </Button>
                                    <label
                                        className={`inline-flex items-center justify-center gap-1.5 h-9 text-xs rounded-md border cursor-pointer border-primary-500/30 bg-primary-500/10 text-primary-200 hover:bg-primary-500/20 ${backgroundItems.length >= MAX_BACKGROUNDS || isUploadingBackground ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <Plus size={14} />
                                        {isUploadingBackground ? 'Uploading…' : 'Upload from device'}
                                        <input
                                            type="file"
                                            className="hidden"
                                            accept=".mp4,.mov,.webm,.m4v,.jpg,.jpeg,.png,.webp"
                                            disabled={backgroundItems.length >= MAX_BACKGROUNDS || isUploadingBackground}
                                            onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                if (f) handleLocalBackgroundUpload(f);
                                                e.target.value = '';
                                            }}
                                        />
                                    </label>
                                </div>
                                <p className="text-help">
                                    Up to {MAX_UPLOAD_MB} MB per file. Video (mp4/mov/webm) or image (jpg/png/webp).
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                <Input
                                    value={backgroundPath}
                                    onChange={(e) => setBackgroundPath(e.target.value)}
                                    placeholder="Pick a background video or image"
                                    className="bg-black/20"
                                />
                                <div className="grid grid-cols-2 gap-2">
                                    <Button onClick={openLibrary} variant="secondary" className="h-10 border-dashed border-white/10 text-xs">
                                        <Library size={14} className="mr-1.5" />
                                        From library
                                    </Button>
                                    <label
                                        className={`inline-flex items-center justify-center gap-1.5 h-10 text-xs rounded-md border cursor-pointer border-primary-500/30 bg-primary-500/10 text-primary-200 hover:bg-primary-500/20 ${isUploadingBackground ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <Plus size={14} />
                                        {isUploadingBackground ? 'Uploading…' : 'Upload from device'}
                                        <input
                                            type="file"
                                            className="hidden"
                                            accept=".mp4,.mov,.webm,.m4v,.jpg,.jpeg,.png,.webp"
                                            disabled={isUploadingBackground}
                                            onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                if (f) handleLocalBackgroundUpload(f);
                                                e.target.value = '';
                                            }}
                                        />
                                    </label>
                                </div>
                                <p className="text-help">
                                    Pick up to {MAX_BACKGROUNDS}. Video (mp4/mov/webm) or image (jpg/png/webp). Up to {MAX_UPLOAD_MB} MB each.
                                </p>
                            </div>
                        )}
                    </Field>

                    <div className="mt-3 rounded-xl border border-primary-500/20 bg-primary-500/[0.04] p-3 space-y-2">
                        <div className="flex items-center gap-2">
                            <Sparkles size={14} className="text-primary-300" />
                            <span className="text-content-secondary text-xs font-medium">Generate visuals from my script</span>
                        </div>
                        <p className="text-meta">Bible-safe AI imagery (landscapes &amp; symbols) created from your lines. Uses your daily AI-image allowance.</p>
                        <div className="flex flex-wrap items-center gap-2">
                            <select value={genVisualsMode} onChange={(e) => setGenVisualsMode(e.target.value as GenerateMode)} className="h-9 text-xs rounded-md bg-dark-900/70 border border-white/10 px-2 text-gray-200">
                                <option value="alongside">Alongside my backgrounds</option>
                                <option value="replace">Only AI visuals</option>
                            </select>
                            <select value={genVisualsCount} onChange={(e) => setGenVisualsCount(Number(e.target.value))} className="h-9 text-xs rounded-md bg-dark-900/70 border border-white/10 px-2 text-gray-200">
                                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} image{n === 1 ? '' : 's'}</option>)}
                            </select>
                            <Button onClick={handleGenerateVisuals} disabled={isGeneratingVisuals} className="h-9 text-xs">
                                <Sparkles size={14} className="mr-1.5" />
                                {isGeneratingVisuals ? 'Generating…' : 'Generate'}
                            </Button>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-content-secondary cursor-pointer pt-1">
                            <input type="checkbox" checked={kenBurns} onChange={(e) => setKenBurns(e.target.checked)} className="rounded border-white/10 bg-black/50 checked:bg-primary-500" />
                            Add subtle motion (Ken Burns) to image backgrounds
                        </label>
                    </div>

                    <Section title="Captions" defaultOpen={true} collapsible={false}>
                        <Field
                            label="Overlay text"
                            badge="Max 6 lines"
                            tooltip="One line per caption slide. Lines are auto-sliced to fit the frame and the chosen animation rhythm."
                        >
                            <Textarea
                                value={lines}
                                onChange={(e) => setLines(e.target.value)}
                                placeholder="Enter your script lines here..."
                                className="bg-black/20 h-32"
                            />
                            <div className="mt-2 flex flex-wrap gap-2">
                                <Button
                                    variant="secondary"
                                    className="h-8 text-xs"
                                    onClick={() => setShowScriptsModal(true)}
                                >
                                    <ClipboardList size={14} className="mr-2" />
                                    Pick From Scripts
                                </Button>
                                {scripts.length > 0 && (
                                    <Button
                                        variant="secondary"
                                        className="h-8 text-xs"
                                        onClick={() => setLines(buildLinesFromScript(scripts[0]))}
                                    >
                                        Use Latest Script
                                    </Button>
                                )}
                            </div>
                        </Field>
                        <Field
                            label="Caption animation"
                            tooltip="Word-synced motion applies when Kinetic captions are on. The list matches the Voice Lab picker."
                        >
                            <Select value={typographyPreset} onChange={(e: ChangeEvent<HTMLSelectElement>) => setTypographyPreset(e.target.value)}>
                                {animations.length > 0 && (
                                    <optgroup label="Caption animations (word-synced)">
                                        {animations.map((a) => (
                                            <option key={a.id} value={a.id}>
                                                {a.label}{a.renderable ? '' : ' (preview-only)'}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                                <optgroup label="Classic presets (no motion)">
                                    <option value="cinematic-default">Cinematic (default)</option>
                                    <option value="intimate-fade">Intimate fade</option>
                                    <option value="scripture-emphasis">Scripture emphasis</option>
                                    <option value="playful-pop">Playful pop</option>
                                    <option value="worship-cinematic">Worship cinematic</option>
                                </optgroup>
                            </Select>
                        </Field>
                        <Field
                            label="Text layout"
                            tooltip="Where word captions sit on the frame. Bottom layouts keep text in the safe band above the TikTok/Reels caption strip; staggered alternates left/centre/right per phrase."
                        >
                            <Select value={layout} onChange={(e: ChangeEvent<HTMLSelectElement>) => setLayout(e.target.value)}>
                                {LAYOUT_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </Select>
                        </Field>
                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={depth}
                                onChange={(e) => setDepth(e.target.checked)}
                                className="rounded border-white/10 bg-black/50 checked:bg-primary-500"
                            />
                            Layered depth (ghost shadow behind each word)
                        </label>
                    </Section>

                    <Section title="Output & Timing">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Field label="Output frame" tooltip="Aspect ratio of the output video. Captions auto-wrap to the selected frame.">
                                <Select value={aspect} onChange={(e: ChangeEvent<HTMLSelectElement>) => setAspect(e.target.value as any)}>
                                    <option value="portrait">Portrait (9:16)</option>
                                    <option value="landscape">Landscape (16:9)</option>
                                    <option value="square">Square (1:1)</option>
                                </Select>
                            </Field>
                            <Field label="Duration">
                                <Select value={String(durationSec)} onChange={(e: ChangeEvent<HTMLSelectElement>) => setDurationSec(Number(e.target.value))}>
                                    <option value="20">20s (default)</option>
                                    <option value="60">60s</option>
                                    <option value="120">120s</option>
                                    <option value="180">180s</option>
                                </Select>
                                {isLongRender && (
                                    <div className="mt-2 text-[0.6875rem] text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded-md px-2 py-1 inline-block">
                                        Long renders run in the background
                                    </div>
                                )}
                            </Field>
                        </div>
                        <Field
                            label={`Caption width (${captionWidth}%)`}
                            tooltip="Width of the caption block relative to the frame. Lower values add more padding around the text and force tighter line wrapping."
                        >
                            <input
                                type="range"
                                min="60"
                                max="100"
                                step="2"
                                value={captionWidth}
                                onChange={(e) => setCaptionWidth(Number(e.target.value))}
                                className="w-full accent-primary-500"
                            />
                        </Field>
                    </Section>

                    <Section title="Audio">
                        <Field
                            label="Voice track"
                            badge="Required for waveform"
                            tooltip="Your narration track. Generate one in Voice & Audio, or upload your own. Required for waveform videos; optional when you supply a background video."
                        >
                            <Input
                                value={audioPath}
                                onChange={(e) => setAudioPath(e.target.value)}
                                placeholder="Pick a narration track or generate one in Voice & Audio"
                                className="bg-black/20"
                            />
                            {audioPath.trim() && (
                              <button
                                type="button"
                                onClick={() => setTrimTarget({ kind: 'audio', path: audioPath.trim(), apply: setAudioPath })}
                                className="mt-2 inline-flex items-center gap-1.5 text-[0.6875rem] px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors"
                              >
                                <Scissors size={12} /> Trim
                              </button>
                            )}
                            {audioHistory.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {audioHistory.slice(0, 4).map((item) => (
                                        <button
                                            key={item.id}
                                            onClick={() => setAudioPath(item.path)}
                                            className="text-[0.6875rem] px-2 py-0.5 rounded-full bg-white/[0.06] text-gray-300 hover:bg-white/[0.12] hover:text-white transition-colors"
                                        >
                                            {item.kind}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </Field>
                        <MusicPicker
                          value={{ path: musicPath || null, volume: musicVolume, autoDuck }}
                          onChange={(m) => {
                            setMusicPath(m.path || '');
                            setMusicVolume(m.volume);
                            setAutoDuck(m.autoDuck ?? true);
                          }}
                          busy={false}
                        />
                    </Section>

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="background"
                            checked={renderInBackground}
                            onChange={(e) => setRenderInBackground(e.target.checked)}
                            className="rounded border-white/10 bg-black/50 checked:bg-primary-500"
                            disabled={isLongRender || kineticCaptions}
                        />
                        <label htmlFor="background" className="text-[0.875rem] text-gray-300">
                            Render in background
                        </label>
                        {isLongRender && (
                            <span className="text-[0.6875rem] text-yellow-300/90">Required for 60s+</span>
                        )}
                        {kineticCaptions && (
                            <span className="text-[0.6875rem] text-amber-300/90">Forced on by kinetic captions</span>
                        )}
                    </div>

                    <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-4 space-y-3">
                        <label className="flex items-start gap-2.5 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={kineticCaptions}
                                onChange={(e) => setKineticCaptions(e.target.checked)}
                                className="mt-0.5 rounded border-white/10 bg-black/50 checked:bg-amber-500"
                            />
                            <div className="flex-1 min-w-0">
                                <div className="text-[0.9375rem] font-semibold text-white">Kinetic captions</div>
                                <p className="text-help mt-0.5 leading-relaxed">
                                    Word-by-word reveal synced to voice. Generates audio from your script
                                    via ElevenLabs and highlights each word as it's spoken. Overrides the
                                    voice track above.
                                </p>
                            </div>
                        </label>
                        {kineticCaptions && (
                            <div className="pl-6">
                                <Field label="ElevenLabs voice ID" badge="Optional">
                                    <Input
                                        value={ttsVoiceId}
                                        onChange={(e) => setTtsVoiceId(e.target.value)}
                                        placeholder="Leave blank to use the server default (Sarah)"
                                        className="font-mono text-[0.8125rem]"
                                    />
                                </Field>
                                <p className="field-help">
                                    Auto-fills from the voice saved on the Voice & Audio page. If blank,
                                    falls back to <code className="text-gray-400 bg-white/[0.04] px-1 py-0.5 rounded">ELEVENLABS_VOICE_ID</code> in
                                    <code className="text-gray-400 bg-white/[0.04] px-1 py-0.5 rounded ml-1">.env</code>, then to ElevenLabs' default.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Button
                            onClick={() => handleRender('video')}
                            isLoading={isRendering}
                            className="w-full h-12 text-md"
                            disabled={!renderEnabled || (isLongRender && !renderInBackground)}
                        >
                            <Video size={18} className="mr-2" />
                            {renderInBackground ? 'Queue Video Render' : 'Start Instant Render'}
                        </Button>
                        <Button
                            onClick={() => handleRender('waveform')}
                            isLoading={isRendering}
                            variant="secondary"
                            className="w-full h-12 text-md"
                            disabled={!renderEnabled || (isLongRender && !renderInBackground)}
                        >
                            <AudioLines size={18} className="mr-2" />
                            {renderInBackground ? 'Queue Waveform Render' : 'Render Waveform MP4'}
                        </Button>
                    </div>
                </div>
            </Card>

            {result?.file && (
                <Card title="Render Result" className="border-green-500/20 bg-green-500/5">
                    <ShareSheet
                        videoUrl={toOutputUrl(result.file, api.mediaBaseUrl)}
                        caption={lines.split('\n').filter(Boolean).join(' ')}
                        title={lines.split('\n').filter(Boolean)[0]}
                        filename={`biblefuel-${new Date().toISOString().slice(0, 10)}`}
                    />
                </Card>
            )}

            {lines && (
                <div id="share-kit">
                <Card
                    title="Share Kit"
                    className="border-white/10 bg-white/[0.03]"
                    collapsible
                    defaultOpen={false}
                    tooltip="One-click captions + downloads for TikTok, IG Reels and YouTube Shorts. Pick a rendered video above, then copy/paste straight into your scheduler."
                >
                    <div className="space-y-3">
                        <p className="text-help">
                            Copy your caption and upload the rendered file to TikTok/IG/YouTube Shorts.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <div>
                                <label className="field-label">Video to share</label>
                                <Select value={shareVideoPath} onChange={(e) => setShareVideoPath(e.target.value)}>
                                    {result?.file && <option value={result.file}>Latest Instant Render</option>}
                                    {jobVideoOptions.length > 0 && (
                                        <optgroup label="Completed Jobs">
                                            {jobVideoOptions.map((item) => (
                                                <option key={item.id} value={item.path}>{item.label}</option>
                                            ))}
                                        </optgroup>
                                    )}
                                    {!result?.file && jobVideoOptions.length === 0 && (
                                        <option value="">No rendered videos found</option>
                                    )}
                                </Select>
                            </div>
                            <div>
                                <label className="field-label">Or paste a path</label>
                                <Input
                                    value={shareVideoPath}
                                    onChange={(e) => setShareVideoPath(e.target.value)}
                                    placeholder="outputs/video-xyz.mp4"
                                    className="bg-black/20"
                                />
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="secondary"
                                className="text-xs h-8"
                                onClick={loadJobVideos}
                            >
                                Refresh Rendered Videos
                            </Button>
                        </div>
                        <div className="bg-black/30 border border-white/10 rounded-lg p-3 text-xs text-gray-200 whitespace-pre-wrap">
                            {lines.split('\n').filter(Boolean).join(' ')}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="secondary"
                                className="text-xs h-8 w-full sm:w-auto"
                                onClick={() => {
                                    navigator.clipboard.writeText(lines.split('\n').filter(Boolean).join(' '));
                                    toast.success('Caption copied');
                                }}
                            >
                                Copy Caption
                            </Button>
                        </div>

                        <div className="pt-2 border-t border-white/10 space-y-2">
                            <div className="text-[0.8125rem] font-medium text-gray-300">Auto-post</div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                <Select value={postDestination} onChange={(e) => setPostDestination(e.target.value as any)}>
                                    <option value="webhook">Webhook (Zapier/Make)</option>
                                    <option value="buffer">Buffer (Legacy)</option>
                                    <option value="youtube">YouTube (Direct)</option>
                                    <option value="instagram">Instagram (Direct)</option>
                                    <option value="tiktok">TikTok (Direct)</option>
                                </Select>
                                {postDestination === 'webhook' ? (
                                    <Select value={selectedWebhook} onChange={(e) => setSelectedWebhook(e.target.value)}>
                                        <option value="">Select webhook...</option>
                                        {webhookOptions.map((w) => (
                                            <option key={w.id} value={w.id}>{w.name}</option>
                                        ))}
                                    </Select>
                                ) : postDestination === 'buffer' ? (
                                    <Select value={selectedProfile} onChange={(e) => setSelectedProfile(e.target.value)}>
                                        <option value="">Select profile...</option>
                                        {bufferProfiles.map((id) => (
                                            <option key={id} value={id}>{id}</option>
                                        ))}
                                    </Select>
                                ) : postDestination === 'youtube' ? (
                                    <Select value={youtubePrivacy} onChange={(e) => setYoutubePrivacy(e.target.value as any)}>
                                        <option value="private">YouTube Private</option>
                                        <option value="unlisted">YouTube Unlisted</option>
                                        <option value="public">YouTube Public</option>
                                    </Select>
                                ) : (
                                    <div className="text-[10px] text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded-md px-2 py-1">
                                        Direct API requires OAuth setup
                                    </div>
                                )}
                                <Button onClick={handleShare} className="text-xs h-8">
                                    Share Now
                                </Button>
                            </div>
                        </div>
                    </div>
                </Card>
                </div>
            )}

            {showLibraryModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowLibraryModal(false)} />
                    {/* Plain div (not <Card>) — Card wraps children in an extra
                        <div> that breaks `flex flex-col`, so the inner
                        overflow-y-auto grid has no flex parent to constrain
                        its height against and content overflows below the
                        viewport with no scrollbar. Bug was reported by the
                        user as "hard to scroll the background picker".

                        max-h in dvh (not vh): iOS reports vh against the
                        largest viewport (toolbars hidden), so an 88vh box
                        overflows the visible area when Safari's bottom toolbar
                        is up and the footer Done button ends up off-screen.
                        dvh tracks the live viewport so Done is always visible. */}
                    <div className="relative w-full max-w-[min(1280px,95vw)] max-h-[88dvh] flex flex-col rounded-xl bg-dark-900/95 backdrop-blur-xl border border-white/20 shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
                            <div>
                                <h3 className="font-bold text-lg text-white">Select Backgrounds</h3>
                                <p className="text-subtitle mt-0.5">
                                    {backgroundItems.length} of {MAX_BACKGROUNDS} selected · click to toggle, order = render sequence
                                </p>
                            </div>
                            <button onClick={() => setShowLibraryModal(false)} className="text-gray-500 hover:text-white" aria-label="Close">
                                <XIcon size={20} />
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                            {isLoadingLibrary ? (
                                <div className="col-span-full py-20 flex justify-center">
                                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-500" />
                                </div>
                            ) : libraryItems.length > 0 ? (
                                libraryItems.map((item) => {
                                    const selectedIdx = backgroundItems.findIndex((b) => b.id === item.id);
                                    const isSelected = selectedIdx !== -1;
                                    const atCap = backgroundItems.length >= MAX_BACKGROUNDS;
                                    const disabled = !isSelected && atCap;
                                    return (
                                        <div
                                            key={item.id}
                                            className={`group relative aspect-[9/16] bg-black rounded-xl overflow-hidden transition-all shadow-lg cursor-pointer ${
                                                isSelected
                                                    ? 'ring-2 ring-primary-400'
                                                    : disabled
                                                        ? 'ring-1 ring-white/10 hover:ring-amber-400/50'
                                                        : 'hover:ring-2 hover:ring-primary-500'
                                            }`}
                                            onClick={() => {
                                                // toggleBackgroundItem already handles the cap
                                                // (toasts a "max reached" hint), so we let the
                                                // tap through instead of disabling the tile —
                                                // disabled tiles greyed out the whole library
                                                // and users couldn't tell the backgrounds apart.
                                                toggleBackgroundItem(item);
                                            }}
                                        >
                                            {/* Full-opacity thumbnails so each background reads as
                                                a distinct image. At cap, unselected tiles stay
                                                clearly visible (slightly dimmed) rather than
                                                fading into an indistinct grey mass. */}
                                            <img
                                                src={getImageSrc(item)}
                                                className={`w-full h-full object-cover transition-opacity ${disabled ? 'opacity-70' : 'opacity-100'}`}
                                                alt=""
                                                loading="lazy"
                                                onError={(e) => handleImageError(e, item)}
                                            />
                                            {isVideoUrl(item.previewUrl || item.url) && (
                                                <video
                                                    src={toMediaUrl(item.previewUrl || item.url)}
                                                    className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity"
                                                    muted
                                                    loop
                                                    playsInline
                                                    autoPlay
                                                    preload="metadata"
                                                    onError={(e) => {
                                                        e.currentTarget.style.display = 'none';
                                                    }}
                                                />
                                            )}
                                            {isSelected && (
                                                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary-500 text-white text-[11px] font-bold flex items-center justify-center shadow-lg">
                                                    {selectedIdx + 1}
                                                </div>
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
                        <div className="flex items-center justify-between p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-white/10 bg-black/30 shrink-0">
                            <Button
                                variant="secondary"
                                className="text-xs h-9"
                                onClick={() => setBackgroundItems([])}
                                disabled={backgroundItems.length === 0}
                            >
                                Clear all
                            </Button>
                            <Button
                                className="text-xs h-9"
                                onClick={() => {
                                    setShowLibraryModal(false);
                                    if (backgroundItems.length > 0) {
                                        toast.success(`${backgroundItems.length} background${backgroundItems.length === 1 ? '' : 's'} selected`);
                                    }
                                }}
                            >
                                <CheckCircle2 size={14} className="mr-1.5" />
                                Done
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {showScriptsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowScriptsModal(false)} />
                    <div className="relative w-full max-w-4xl max-h-[80vh] flex flex-col rounded-xl bg-dark-900/95 backdrop-blur-xl border border-white/20 shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
                            <h3 className="font-bold text-lg text-white">Scripts Library</h3>
                            <button onClick={() => setShowScriptsModal(false)} className="text-gray-500 hover:text-white">
                                <CheckCircle2 size={24} />
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-4">
                            {scripts.length === 0 ? (
                                <div className="text-center opacity-50 text-white py-12">
                                    <ClipboardList size={48} className="mx-auto mb-4" />
                                    <p>No scripts found. Generate scripts first.</p>
                                </div>
                            ) : (
                                scripts.map((script, idx) => (
                                    <div
                                        key={`${script.title}-${idx}`}
                                        className="border border-white/10 rounded-xl p-4 hover:border-primary-500/40 transition"
                                    >
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="font-semibold text-white text-sm">{idx + 1}. {script.title}</h4>
                                            <div className="flex gap-2">
                                                <Button
                                                    variant="secondary"
                                                    className="text-xs h-8"
                                                    onClick={() => {
                                                        const text = buildLinesFromScript(script);
                                                        setLines(text);
                                                        setShowScriptsModal(false);
                                                        toast.success('Script loaded into overlay');
                                                    }}
                                                >
                                                    Use
                                                </Button>
                                                <Button
                                                    variant="secondary"
                                                    className="text-xs h-8"
                                                    onClick={() => {
                                                        const text = buildLinesFromScript(script);
                                                        navigator.clipboard.writeText(text);
                                                        toast.success('Copied to clipboard');
                                                    }}
                                                >
                                                    Copy
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-300 space-y-1">
                                            <p>{script.hook}</p>
                                            <p>{script.verse} ({script.reference})</p>
                                            <p>{script.reflection}</p>
                                            <p>{script.cta}</p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
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

