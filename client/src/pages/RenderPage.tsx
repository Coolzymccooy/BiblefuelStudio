import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
const CAPTION_LINE_SEP = String.fromCharCode(10);
import { EditorShell } from '../components/editor/EditorShell';
import { RenderAudioPanel } from '../components/render/RenderAudioPanel';
import { RenderOutputPanel } from '../components/render/RenderOutputPanel';
import { RenderCaptionsPanel, type CaptionMotionOption } from '../components/render/RenderCaptionsPanel';
import { RenderBackgroundsPanel } from '../components/render/RenderBackgroundsPanel';
import { RenderDeliveryPanel } from '../components/render/RenderDeliveryPanel';
import { RenderSharePanel } from '../components/render/RenderSharePanel';
import { checkRenderReadiness } from '../lib/renderReadiness';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Section } from '../components/ui/Section';
import { GuideSteps, type GuideStep } from '../components/ui/GuideSteps';
import { api, DIRECT_UPLOAD_MAX_BYTES, RESUMABLE_UPLOAD_MAX_BYTES } from '../lib/api';
import { uploadMedia } from '../lib/mediaUpload';
import toast from 'react-hot-toast';
import { Play, Library, Type, Video, CheckCircle2, ClipboardList, AudioLines, Share2, X as XIcon } from 'lucide-react';
import { loadJson, saveJson, STORAGE_KEYS, toOutputUrl } from '../lib/storage';
import { LAYOUT_OPTIONS } from '../lib/layoutOptions';
import { usePersistedState } from '../lib/usePersistedState';
import { useConfig } from '../lib/config';
import { useNotifications } from '../lib/notifications';
import { ShareSheet } from '../components/ShareSheet';
import { RenderProgressOverlay } from '../components/RenderProgressOverlay';
import { MediaTrimmer } from '../components/MediaTrimmer';
import { BackgroundLibraryModal } from '../components/BackgroundLibraryModal';
import { applyGeneratedVisuals, type GenerateMode } from '../lib/generativeVisuals';
import { buildSpeakableLines } from '../lib/speakableScript';

/** Mirrors the server's MAX_BACKGROUNDS — keep in sync with render.js. */
const MAX_BACKGROUNDS = 30;
/** Client-side ceiling; large files (>90MB) go via the resumable path. Mirrors
 *  the server's RESUMABLE_MAX_BYTES so oversized uploads fail client-side first. */
const MAX_UPLOAD_MB = Math.floor(RESUMABLE_UPLOAD_MAX_BYTES / 1024 / 1024);

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

type RenderLabTabId = 'captions' | 'visuals' | 'audio' | 'output' | 'share';

/**
 * Embedded mode: the whole render lab docked inside the Timeline editor
 * (its Output tool). Same hoisted panels as the page's own editor layout, so
 * every render control exists exactly once and the parity gate covers both.
 */
export interface RenderLabEmbed {
    /** Caption lines from the host, used when the lab has none of its own yet. */
    seedLines?: string;
    /** Source audio from the host, used when the lab has no audio yet. */
    seedAudioPath?: string;
    /** A finished render (server output path) - the host previews it on stage. */
    onRendered?: (file: string) => void;
}

export function RenderPage() {
    return <RenderLab />;
}

export function RenderLab({ embedded }: { embedded?: RenderLabEmbed } = {}) {
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
    // Editor layout, mirroring Timeline. Persisted, and the classic view stays
    // as the fallback - the operator asked to keep it, and it has been a real
    // escape hatch more than once during this work.
    const [editorLayout, setEditorLayout] = useState<boolean>(
        () => loadJson<boolean>('bf.render.editorLayout', false),
    );
    useEffect(() => { saveJson('bf.render.editorLayout', editorLayout); }, [editorLayout]);
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
    // Caption MOTION - how captions are timed, independent of the style's look.
    const [captionMotion, setCaptionMotion] = useState<string>('words');
    const [captionStagger, setCaptionStagger] = useState<boolean>(false);
    const [captionHighlight, setCaptionHighlight] = useState<boolean>(false);
    const [captionMotions, setCaptionMotions] = useState<CaptionMotionOption[]>([]);
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
    // Embedded: which lab tab is open.
    const [labTab, setLabTab] = useState<RenderLabTabId>('captions');
    // Seeds from the host apply ONCE, and only into empty state - the lab's
    // own persisted values win when present.
    const seededRef = useRef(false);
    useEffect(() => {
        if (!embedded || seededRef.current) return;
        seededRef.current = true;
        if (embedded.seedLines && !lines.trim()) setLines(embedded.seedLines);
        if (embedded.seedAudioPath && !audioPath.trim()) setAudioPath(embedded.seedAudioPath);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [embedded?.seedLines, embedded?.seedAudioPath]);
    const finishedFile = result?.file || completedRender?.file;
    useEffect(() => {
        if (finishedFile && embedded?.onRendered) embedded.onRendered(finishedFile);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [finishedFile]);
    // When a background render finishes, bring the "Render complete" banner into
    // view so the user lands on the result instead of the config they left.
    const renderDoneRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (completedRender) {
            requestAnimationFrame(() => renderDoneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        }
    }, [completedRender]);
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
            const res = await api.get<{
                ok: boolean;
                animations: Array<{ id: string; label: string; renderable: boolean }>;
                motions?: CaptionMotionOption[];
            }>('/api/tts/animations');
            if (cancelled || !res.ok) return;
            if (res.data?.animations) setAnimations(res.data.animations);
            // Motions come from the same endpoint so the picker can never offer
            // a timing the renderer does not implement.
            if (Array.isArray(res.data?.motions)) setCaptionMotions(res.data.motions);
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

    // Live readiness, so the operator sees what is missing BEFORE pressing
    // Render rather than discovering it one toast at a time afterwards.
    const readinessFor = (mode: 'video' | 'waveform') => checkRenderReadiness({
        mode,
        lines,
        audioPath,
        backgroundPath,
        backgroundItemCount: backgroundItems.length,
        autoBackground,
    });
    const videoReadiness = readinessFor('video');
    const waveformReadiness = readinessFor('waveform');

    const handleRender = async (mode: 'video' | 'waveform') => {
        const hasMultiBg = backgroundItems.length > 0;
        const useAuto = autoBackground && mode === 'video' && !backgroundPath && !hasMultiBg;

        // One readiness pass instead of four sequential early returns. The old
        // form fired a toast and returned on the FIRST failure, so fixing it only
        // revealed the next; this reports every blocker at once, and the same
        // verdict drives the readiness shown on the controls themselves.
        const readiness = checkRenderReadiness({
            mode,
            lines,
            audioPath,
            backgroundPath,
            backgroundItemCount: backgroundItems.length,
            autoBackground,
        });
        if (!readiness.ready) {
            toast.error(readiness.blockers.map((b) => b.message).join(' '));
            return;
        }
        const cleanLines = lines.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 6);
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
                captionMotion,
                captionStagger,
                captionHighlight,
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

    // Upload several dropped background files in sequence, honouring the
    // MAX_BACKGROUNDS cap up-front.
    const handleDroppedBackgrounds = async (files: File[]) => {
        const remaining = MAX_BACKGROUNDS - backgroundItems.length;
        if (remaining <= 0) {
            toast.error(`Max ${MAX_BACKGROUNDS} backgrounds. Remove one to add another.`);
            return;
        }
        const toUpload = files.slice(0, remaining);
        if (files.length > toUpload.length) {
            toast(`Adding ${toUpload.length} of ${files.length} — ${MAX_BACKGROUNDS} background max.`, { icon: 'ℹ️' });
        }
        for (const file of toUpload) {
            await handleLocalBackgroundUpload(file);
        }
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
        // Large clips stream to storage over seconds — show live progress.
        const isLarge = file.size > DIRECT_UPLOAD_MAX_BYTES;
        const toastId = 'render-bg-upload';
        if (isLarge) toast.loading('Uploading… 0%', { id: toastId });
        try {
            const data = await uploadMedia(
                file,
                file.name,
                'background',
                isLarge ? (pct) => toast.loading(`Uploading… ${pct}%`, { id: toastId }) : undefined,
            );
            const filePath = data.file;
            const publicUrl = api.mediaUrl(filePath);
            // Videos have no browser-derivable poster; the server returns a
            // first-frame .jpg so the tile shows a real thumbnail instead of a
            // black square. Images are their own thumbnail.
            const thumbUrl = data.thumb ? api.mediaUrl(data.thumb) : publicUrl;
            const item: LibraryItem = {
                id: filePath,
                url: publicUrl,
                previewUrl: publicUrl,
                image: thumbUrl,
                savedAt: new Date().toISOString(),
                kind: data.kind,
            };
            // Functional updates so sequential (multi-file) drops accumulate
            // instead of clobbering each other via stale closure state.
            setBackgroundItems((prev) => [...prev, item]);
            setBackgroundPath((prev) => prev || filePath);
            const msg = `${data.kind === 'image' ? 'Image' : 'Video'} added as background`;
            if (isLarge) toast.success(msg, { id: toastId }); else toast.success(msg);
        } catch (e) {
            toast.error((e as Error).message || 'Background upload failed', isLarge ? { id: toastId } : undefined);
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

    const clearAllBackgrounds = () => {
        if (backgroundItems.length === 0) return;
        if (!window.confirm(`Remove all ${backgroundItems.length} selected backgrounds?`)) return;
        setBackgroundItems([]);
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

    const [isSharing, setIsSharing] = useState(false);
    const handleShare = async () => {
        if (isSharing) return; // guard against double-taps while the post is in flight
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

        setIsSharing(true);
        try {
            const res = await api.post('/api/social/post', payload);
            if (res.ok) toast.success('Share triggered');
            else toast.error(res.error || 'Share failed');
        } finally {
            setIsSharing(false);
        }
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
        // Waveform-only rules. GuideSteps covered background, text and voice;
        // these two refusals existed only as post-click toasts, so a waveform
        // render could look ready and then be rejected.
        ...(waveformReadiness.blockers
            .filter((b) => b.field === 'background' && backgroundItems.length > 1)
            .map((b) => ({
                label: 'Waveform needs a single background',
                status: 'todo' as const,
                detail: b.message,
            }))),
    ];

    // ---- Shared across layouts ---------------------------------------------
    // Panels used by BOTH the editor shell and the classic view, built once so
    // the two layouts cannot drift. The modals and the progress overlay are
    // here for the same reason: a button that opens a modal which only the
    // classic return renders is a control that silently does nothing in the
    // editor - the exact defect this refactor exists to prevent.
    const backgroundsPanel = (
        <RenderBackgroundsPanel
            autoBackground={autoBackground}
            onAutoBackgroundChange={setAutoBackground}
            backgroundPath={backgroundPath}
            onBackgroundPathChange={setBackgroundPath}
            backgroundItems={backgroundItems}
            isUploading={isUploadingBackground}
            maxBackgrounds={MAX_BACKGROUNDS}
            maxUploadMb={MAX_UPLOAD_MB}
            durationSec={durationSec}
            onDropFiles={handleDroppedBackgrounds}
            onUploadFile={handleLocalBackgroundUpload}
            onOpenLibrary={openLibrary}
            onClearAll={clearAllBackgrounds}
            onMoveUp={moveBackgroundUp}
            onMoveDown={moveBackgroundDown}
            onRemove={removeBackground}
            onTrimItem={(item) => setTrimTarget({
                kind: 'video',
                path: item.id,
                apply: (p) => setBackgroundItems(backgroundItems.map((b) => b.id === item.id ? { ...b, id: p, url: api.mediaUrl(p), previewUrl: api.mediaUrl(p), image: api.mediaUrl(p) } : b)),
            })}
            getImageSrc={getImageSrc}
            onImageError={handleImageError}
            genVisualsMode={genVisualsMode}
            onGenVisualsModeChange={setGenVisualsMode}
            genVisualsCount={genVisualsCount}
            onGenVisualsCountChange={setGenVisualsCount}
            onGenerateVisuals={handleGenerateVisuals}
            isGeneratingVisuals={isGeneratingVisuals}
            kenBurns={kenBurns}
            onKenBurnsChange={setKenBurns}
        />
    );

    const deliveryPanel = (
        <RenderDeliveryPanel
            renderInBackground={renderInBackground}
            onRenderInBackgroundChange={setRenderInBackground}
            isLongRender={isLongRender}
            kineticCaptions={kineticCaptions}
            onKineticCaptionsChange={setKineticCaptions}
            ttsVoiceId={ttsVoiceId}
            onTtsVoiceIdChange={setTtsVoiceId}
            renderEnabled={renderEnabled}
            isRendering={isRendering}
            onRenderVideo={() => handleRender('video')}
            onRenderWaveform={() => handleRender('waveform')}
            videoBlockerMessage={videoReadiness.blockers[0]?.message}
            waveformBlockerMessage={waveformReadiness.blockers[0]?.message}
        />
    );

    const sharePanel = (
        <RenderSharePanel
            lines={lines}
            latestRenderFile={result?.file}
            jobVideoOptions={jobVideoOptions}
            shareVideoPath={shareVideoPath}
            onShareVideoPathChange={setShareVideoPath}
            onRefreshVideos={loadJobVideos}
            postDestination={postDestination}
            onPostDestinationChange={setPostDestination}
            selectedWebhook={selectedWebhook}
            onSelectedWebhookChange={setSelectedWebhook}
            webhookOptions={webhookOptions}
            selectedProfile={selectedProfile}
            onSelectedProfileChange={setSelectedProfile}
            bufferProfiles={bufferProfiles}
            youtubePrivacy={youtubePrivacy}
            onYoutubePrivacyChange={setYoutubePrivacy}
            onShare={handleShare}
            isSharing={isSharing}
        />
    );

    const sharedOverlays = (
        <>
            <RenderProgressOverlay
                active={isRenderInFlight && !completedRender && !result?.file}
                progress={overlayProgress}
                kind={overlayKind}
                mode={overlayMode}
            />

            <BackgroundLibraryModal
                open={showLibraryModal}
                onClose={() => setShowLibraryModal(false)}
                items={libraryItems}
                isLoading={isLoadingLibrary}
                mode="multi"
                max={MAX_BACKGROUNDS}
                selectedIds={backgroundItems.map((b) => b.id)}
                onPick={toggleBackgroundItem}
                onClear={() => setBackgroundItems([])}
                onDone={() => {
                    setShowLibraryModal(false);
                    if (backgroundItems.length > 0) {
                        toast.success(`${backgroundItems.length} background${backgroundItems.length === 1 ? '' : 's'} selected`);
                    }
                }}
                getImageSrc={getImageSrc}
                getVideoSrc={(item) => (isVideoUrl(item.previewUrl || item.url) ? toMediaUrl(item.previewUrl || item.url) : null)}
                onImageError={handleImageError}
            />

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
        </>
    );

    // ---- Editor layout -----------------------------------------------------
    // The same shell Timeline uses: icon rail, docked panel, stage. Classic
    // view stays as the fallback, and BOTH layouts render the same extracted
    // panels - two copies of a control is exactly how Timeline's overlays
    // became unreachable in one layout.
    // The five render panels, defined ONCE for the editor layout and the
    // embedded lab.
    const labPanels: Record<RenderLabTabId, ReactNode> = {
                    captions: (
                        <RenderCaptionsPanel
                            lines={lines}
                            onLinesChange={setLines}
                            typographyPreset={typographyPreset}
                            onTypographyPresetChange={setTypographyPreset}
                            motions={captionMotions}
                            captionMotion={captionMotion}
                            onCaptionMotionChange={setCaptionMotion}
                            captionStagger={captionStagger}
                            onCaptionStaggerChange={setCaptionStagger}
                            captionHighlight={captionHighlight}
                            onCaptionHighlightChange={setCaptionHighlight}
                            layout={layout}
                            onLayoutChange={setLayout}
                            layoutOptions={LAYOUT_OPTIONS}
                            depth={depth}
                            onDepthChange={setDepth}
                            animations={animations}
                            hasScripts={scripts.length > 0}
                            onOpenScripts={() => setShowScriptsModal(true)}
                            onUseLatestScript={() => setLines(buildLinesFromScript(scripts[0]))}
                            onFormatForVideo={() => {
                                const next = buildSpeakableLines(lines, { maxLines: 6, maxChars: 72 }).join(CAPTION_LINE_SEP);
                                setLines(next);
                                toast.success('Formatted for video');
                            }}
                            maxLines={6}
                        />
                    ),
                    visuals: backgroundsPanel,
                    audio: (
                        <RenderAudioPanel
                            audioPath={audioPath}
                            onAudioPathChange={setAudioPath}
                            audioHistory={audioHistory}
                            onTrim={(p) => setTrimTarget({ kind: 'audio', path: p, apply: setAudioPath })}
                            musicPath={musicPath}
                            musicVolume={musicVolume}
                            autoDuck={autoDuck}
                            onMusicChange={(m) => {
                                setMusicPath(m.path);
                                setMusicVolume(m.volume);
                                setAutoDuck(m.autoDuck);
                            }}
                        />
                    ),
                    output: (
                        <div className="space-y-4">
                            <RenderOutputPanel
                                aspect={aspect}
                                onAspectChange={(v) => setAspect(v as typeof aspect)}
                                durationSec={durationSec}
                                onDurationChange={setDurationSec}
                                captionWidth={captionWidth}
                                onCaptionWidthChange={setCaptionWidth}
                                isLongRender={isLongRender}
                            />
                            {deliveryPanel}
                        </div>
                    ),
                    share: (
                        <div className="space-y-4">
                            {(result?.file || completedRender?.file) && (
                                <ShareSheet
                                    videoUrl={toOutputUrl(result?.file || completedRender?.file, api.mediaBaseUrl)}
                                    caption={lines.split('\n').filter(Boolean).join(' ')}
                                    title={lines.split('\n').filter(Boolean)[0]}
                                    filename={`biblefuel-${new Date().toISOString().slice(0, 10)}`}
                                />
                            )}
                            {sharePanel}
                        </div>
                    ),
    };

    // ---- Embedded (inside the Timeline editor) ------------------------------
    if (embedded) {
        const tabs: Array<{ id: RenderLabTabId; label: string }> = [
            { id: 'captions', label: 'Captions' },
            { id: 'visuals', label: 'Visuals' },
            { id: 'audio', label: 'Audio' },
            { id: 'output', label: 'Output' },
            { id: 'share', label: 'Share' },
        ];
        return (
            <div className="editor-embed flex min-h-0 flex-col">
                <div role="tablist" aria-label="Render lab" className="mb-2 flex flex-wrap gap-1">
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
                            {t.label}
                        </button>
                    ))}
                </div>
                <div className="min-h-0 space-y-3">{labPanels[labTab]}</div>
                {sharedOverlays}
            </div>
        );
    }

    if (editorLayout) {
        return (
            <>
            <EditorShell
                topBar={(
                    <>
                        <span className="font-semibold">Send it to the world</span>
                        {audioPath.trim() && (
                            <span
                                className="cursor-help truncate rounded-md border border-editor-line px-2.5 py-1 text-[12px] text-editor-dim"
                                title={audioPath}
                            >
                                Voice loaded
                            </span>
                        )}
                        <span className="flex-1" />
                        <Button variant="secondary" className="h-8 text-xs" onClick={() => setEditorLayout(false)}>
                            Classic view
                        </Button>
                        <Button
                            className="h-8 text-xs"
                            onClick={() => handleRender('video')}
                            disabled={isRendering}
                            title={videoReadiness.blockers[0]?.message || 'Render the video'}
                        >
                            {isRendering ? 'Rendering...' : 'Render'}
                        </Button>
                    </>
                )}
                tools={[
                    { id: 'captions', label: 'Captions', icon: <Type size={17} /> },
                    { id: 'visuals', label: 'Visuals', icon: <Library size={17} /> },
                    { id: 'audio', label: 'Audio', icon: <AudioLines size={17} /> },
                    { id: 'output', label: 'Output', icon: <Video size={17} /> },
                    { id: 'share', label: 'Share', icon: <Share2 size={17} /> },
                ]}
                panels={labPanels}
                stage={(
                    (result?.file || completedRender?.file) ? (
                        <div className="flex h-full max-h-full flex-col items-center justify-center gap-2">
                            <video
                                src={toMediaUrl(result?.file || completedRender?.file)}
                                controls
                                className="max-h-[calc(100%-3.5rem)] max-w-full rounded-lg"
                            />
                            <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
                                <a
                                    href={toMediaUrl(result?.file || completedRender?.file)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex h-8 items-center rounded-md border border-editor-line px-2.5 text-xs text-editor-dim transition-colors hover:bg-editor-hover"
                                >
                                    Open
                                </a>
                                <button
                                    type="button"
                                    onClick={() => { setResult(null); setCompletedRender(null); }}
                                    className="text-[11px] text-editor-faint underline-offset-2 hover:underline"
                                >
                                    Back to setup
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="max-w-md text-center">
                            <p className="text-[12px] text-editor-faint">
                                {videoReadiness.ready
                                    ? 'Ready to render. Your video appears here when it is done.'
                                    : 'Finish the steps on the left, then press Render.'}
                            </p>
                            {videoReadiness.blockers.length > 0 && (
                                <ul className="mt-3 space-y-1 text-left">
                                    {videoReadiness.blockers.map((b) => (
                                        <li key={b.field} className="text-[11px] text-editor-dim">{b.message}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )
                )}
            />
            {sharedOverlays}
            </>
        );
    }


    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-start justify-between gap-4">
                <div>
                <div className="bf-eyebrow">Studio</div>
                <h2 className="font-displaySerif text-[28px] leading-[1.08] font-semibold text-bf-cream mt-1.5">Send it to <em className="italic font-medium text-bf-gold">the world</em>.</h2>
                </div>
                {/* Same affordance as Timeline: the editor is opt-in and the
                    classic view remains the fallback. */}
                <Button
                    variant="secondary"
                    className="h-9 shrink-0 text-xs"
                    onClick={() => setEditorLayout(true)}
                    title="Rail, panel and preview - the same shell as Timeline"
                >
                    Editor view
                </Button>
            </div>

            

            {completedRender && (
                <div ref={renderDoneRef} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl border border-[#7fb5aa]/30 bg-[#7fb5aa]/10 shadow-[0_10px_40px_rgba(127,181,170,0.15)] animate-fade-in">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                        <CheckCircle2 size={20} className="text-[#7fb5aa] flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-white">Render complete</p>
                            {completedRender.file && (
                                <p className="text-[10px] font-mono text-[#a5cec6]/80 truncate">{completedRender.file}</p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {completedRender.file && (
                            <Button
                                variant="secondary"
                                className="h-9 text-xs border-[#7fb5aa]/30 bg-[#7fb5aa]/10 hover:bg-[#7fb5aa]/20"
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
                <Card title="Share your video" className="border-[#7fb5aa]/20 bg-[#7fb5aa]/[0.03]">
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
                    {backgroundsPanel}

                    <Section title="Captions" defaultOpen={true} collapsible={false}>
                        {/* Extracted so the editor shell and the classic layout
                            render the SAME panel. Two copies would drift apart the
                            first time either was touched - that is exactly how the
                            Timeline's overlays became unreachable in one layout. */}
                        <RenderCaptionsPanel
                            lines={lines}
                            onLinesChange={setLines}
                            typographyPreset={typographyPreset}
                            onTypographyPresetChange={setTypographyPreset}
                            motions={captionMotions}
                            captionMotion={captionMotion}
                            onCaptionMotionChange={setCaptionMotion}
                            captionStagger={captionStagger}
                            onCaptionStaggerChange={setCaptionStagger}
                            captionHighlight={captionHighlight}
                            onCaptionHighlightChange={setCaptionHighlight}
                            layout={layout}
                            onLayoutChange={setLayout}
                            layoutOptions={LAYOUT_OPTIONS}
                            depth={depth}
                            onDepthChange={setDepth}
                            animations={animations}
                            hasScripts={scripts.length > 0}
                            onOpenScripts={() => setShowScriptsModal(true)}
                            onUseLatestScript={() => setLines(buildLinesFromScript(scripts[0]))}
                            onFormatForVideo={() => {
                                const next = buildSpeakableLines(lines, { maxLines: 6, maxChars: 72 }).join(String.fromCharCode(10));
                                setLines(next);
                                toast.success('Formatted for video');
                            }}
                            maxLines={6}
                        />
                    </Section>

                    <Section title="Output & Timing">
                        <RenderOutputPanel
                            aspect={aspect}
                            onAspectChange={(v) => setAspect(v as typeof aspect)}
                            durationSec={durationSec}
                            onDurationChange={setDurationSec}
                            captionWidth={captionWidth}
                            onCaptionWidthChange={setCaptionWidth}
                            isLongRender={isLongRender}
                        />
                    </Section>

                    <Section title="Audio">
                        <RenderAudioPanel
                            audioPath={audioPath}
                            onAudioPathChange={setAudioPath}
                            audioHistory={audioHistory}
                            onTrim={(p) => setTrimTarget({ kind: 'audio', path: p, apply: setAudioPath })}
                            musicPath={musicPath}
                            musicVolume={musicVolume}
                            autoDuck={autoDuck}
                            onMusicChange={(m) => {
                                setMusicPath(m.path);
                                setMusicVolume(m.volume);
                                setAutoDuck(m.autoDuck);
                            }}
                        />
                    </Section>

                    {deliveryPanel}
                </div>
            </Card>

            {result?.file && (
                <Card title="Render Result" className="border-[#7fb5aa]/20 bg-[#7fb5aa]/5">
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
                    {sharePanel}
                </Card>
                </div>
            )}

            {sharedOverlays}
        </div>
    );
}

