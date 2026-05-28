import { useEffect, useRef, useState, type ChangeEvent, type SyntheticEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Textarea } from '../components/ui/Textarea';
import { Select } from '../components/ui/Select';
import { Field } from '../components/ui/Field';
import { Section } from '../components/ui/Section';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { Play, Library, Video, CheckCircle2, ClipboardList, AudioLines, Share2, X as XIcon } from 'lucide-react';
import { loadJson, saveJson, STORAGE_KEYS, toOutputUrl } from '../lib/storage';
import { useConfig } from '../lib/config';
import { useNotifications } from '../lib/notifications';
import { ShareSheet } from '../components/ShareSheet';
import { RenderProgressOverlay } from '../components/RenderProgressOverlay';

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
    const [result, setResult] = useState<any>(null);
    const [showLibraryModal, setShowLibraryModal] = useState(false);
    const [libraryItems, setLibraryItems] = useState<any[]>([]);
    const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
    const [showMusicModal, setShowMusicModal] = useState(false);
    const [musicItems, setMusicItems] = useState<any[]>([]);
    const [isLoadingMusic, setIsLoadingMusic] = useState(false);
    const [backgroundItem, setBackgroundItem] = useState<any>(null);
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
    const [typographyPreset, setTypographyPreset] = useState<string>('cinematic-default');
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

    const toMediaUrl = (value: string | undefined | null) => toOutputUrl(value, api.baseUrl);
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
    }, []);

    useEffect(() => {
        saveJson(STORAGE_KEYS.renderTypographyPreset, typographyPreset);
    }, [typographyPreset]);

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
        if (!backgroundPath && !backgroundItem) {
            toast.error('Background is required');
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
        // Kinetic captions require the async worker path (it does TTS-with-timestamps
        // server-side, which can take several seconds before render even starts).
        // voiceId is optional — server falls back to ELEVENLABS_VOICE_ID env / Sarah.
        const useBackground = renderInBackground || (kineticCaptions && mode === 'video');

        setIsRendering(true);
        lastRenderKindRef.current = mode;
        // Clear any previous completion banner so the overlay isn't competing
        // with a stale "Render complete" card from the last job.
        setCompletedRender(null);
        setResult(null);
        try {
            const endpoint = useBackground ? '/api/jobs/enqueue' : `/api/render/${mode}`;
            const corePayload = {
                backgroundPath: backgroundItem?.id || backgroundPath,
                audioPath,
                lines: cleanLines,
                durationSec,
                aspect,
                captionWidthPct: captionWidth,
                musicPath: musicPath || undefined,
                musicVolume,
                autoDuck,
                typographyPreset,
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

    const openMusicLibrary = async () => {
        setShowMusicModal(true);
        setIsLoadingMusic(true);
        try {
            const response = await api.get('/api/media/audio-list');
            if (response.ok && response.data?.items) {
                setMusicItems(response.data.items);
            } else {
                toast.error(response.error || 'Failed to load music library');
            }
        } catch (error) {
            toast.error('Failed to load music library');
        } finally {
            setIsLoadingMusic(false);
        }
    };

    const handleSelectMusic = (item: any) => {
        setMusicPath(item.path || '');
        setShowMusicModal(false);
        toast.success('Soundtrack selected');
    };

    const handleSelectBackground = (item: any) => {
        setBackgroundItem(item);
        setBackgroundPath(item.id);
        setShowLibraryModal(false);
        toast.success('Background selected');
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
        const fileUrl = effectivePath ? toOutputUrl(effectivePath, api.baseUrl) : '';
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
                                    const url = toOutputUrl(completedRender.file, api.baseUrl);
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
                        videoUrl={toOutputUrl(completedRender.file, api.baseUrl)}
                        caption={lines.split('\n').filter(Boolean).join(' ')}
                        title={lines.split('\n').filter(Boolean)[0]}
                        filename={`biblefuel-${new Date().toISOString().slice(0, 10)}`}
                    />
                </Card>
            )}

            <Card title="Configuration">
                {!renderEnabled && (
                    <div className="mb-4 text-xs text-yellow-200 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                        Rendering is disabled because FFmpeg was not detected on the server.
                    </div>
                )}
                <div className="space-y-4">
                    <Field label="Background">
                        {backgroundItem ? (
                                    <div
                                        className={`relative bg-black rounded-xl overflow-hidden group mx-auto sm:mx-0 ${aspect === 'landscape'
                                            ? 'aspect-[16/9] max-w-md'
                                            : aspect === 'square'
                                                ? 'aspect-square max-w-xs'
                                                : 'aspect-[9/16] max-w-[220px]'
                                            }`}
                                    >
                                        <img
                                            src={getImageSrc(backgroundItem)}
                                            className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity"
                                            alt=""
                                            loading="lazy"
                                            onError={(e) => handleImageError(e, backgroundItem)}
                                        />
                                        {isVideoUrl(backgroundItem.previewUrl || backgroundItem.url) && (
                                            <video
                                                src={toMediaUrl(backgroundItem.previewUrl || backgroundItem.url)}
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
                                        <div className="absolute inset-[8%] border border-white/40 border-dashed pointer-events-none rounded-md" />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <Button onClick={() => setBackgroundItem(null)} variant="secondary" className="h-8 text-xs bg-red-500/10 text-red-400 border-red-500/20">
                                                Change
                                            </Button>
                                        </div>
                                        <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/80 text-[10px] text-white font-mono truncate">
                                            ID: {backgroundItem.id}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        <Input
                                            value={backgroundPath}
                                            onChange={(e) => setBackgroundPath(e.target.value)}
                                            placeholder="Manual path (e.g. server/outputs/xyz.mp4)"
                                            className="bg-black/20"
                                        />
                                        <Button onClick={openLibrary} variant="secondary" className="h-10 border-dashed border-white/10 text-xs">
                                            <Library size={14} className="mr-2" />
                                            Select from Library
                                        </Button>
                                    </div>
                                )}
                    </Field>

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
                            tooltip="Absolute path to the narration MP3/WAV produced in the Voice & Audio tab. Required for waveform renders; optional for video renders."
                        >
                            <Input
                                value={audioPath}
                                onChange={(e) => setAudioPath(e.target.value)}
                                placeholder="e.g. server/outputs/tts-xyz.mp3"
                                className="bg-black/20"
                            />
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
                        <Field label="Soundtrack" badge="Optional">
                            <Input
                                value={musicPath}
                                onChange={(e) => setMusicPath(e.target.value)}
                                placeholder="e.g. server/outputs/music.mp3"
                                className="bg-black/20"
                            />
                            <Button
                                onClick={openMusicLibrary}
                                variant="secondary"
                                className="mt-2 h-9 text-xs border-dashed border-white/10"
                            >
                                <Library size={14} className="mr-2" />
                                Select from Music Library
                            </Button>
                        </Field>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                            <Field label={`Music volume (${musicVolume.toFixed(2)})`}>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={musicVolume}
                                    onChange={(e) => setMusicVolume(Number(e.target.value))}
                                    className="w-full accent-primary-500"
                                />
                            </Field>
                            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer pt-7">
                                <input
                                    type="checkbox"
                                    checked={autoDuck}
                                    onChange={(e) => setAutoDuck(e.target.checked)}
                                    className="rounded border-white/10 bg-black/50 checked:bg-primary-500"
                                />
                                Auto-duck music under voice
                            </label>
                        </div>
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
                                <p className="text-[0.8125rem] text-gray-400 mt-0.5 leading-relaxed">
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
                        videoUrl={toOutputUrl(result.file, api.baseUrl)}
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
                        <p className="text-xs text-gray-400">
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
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowLibraryModal(false)} />
                    <Card className="relative w-full max-w-[min(1280px,95vw)] max-h-[88vh] overflow-hidden flex flex-col border-white/20 shadow-2xl">
                        <div className="flex items-center justify-between p-4 border-b border-white/10">
                            <h3 className="font-bold text-lg text-white">Select Background</h3>
                            <button onClick={() => setShowLibraryModal(false)} className="text-gray-500 hover:text-white">
                                <CheckCircle2 size={24} />
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                            {isLoadingLibrary ? (
                                <div className="col-span-full py-20 flex justify-center">
                                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-500" />
                                </div>
                            ) : libraryItems.length > 0 ? (
                                libraryItems.map((item) => (
                                    <div
                                        key={item.id}
                                        className="group relative aspect-[9/16] bg-black rounded-xl overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary-500 transition-all shadow-lg"
                                        onClick={() => handleSelectBackground(item)}
                                    >
                                        <img
                                            src={getImageSrc(item)}
                                            className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity"
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
                                        <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                                            <p className="text-[10px] font-mono text-white truncate">ID: {item.id}</p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="col-span-full py-20 text-center opacity-30 text-white">
                                    <Library size={48} className="mx-auto mb-4" />
                                    <p>Your library is empty.</p>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            )}

            {showScriptsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowScriptsModal(false)} />
                    <Card className="relative w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col border-white/20 shadow-2xl">
                        <div className="flex items-center justify-between p-4 border-b border-white/10">
                            <h3 className="font-bold text-lg text-white">Scripts Library</h3>
                            <button onClick={() => setShowScriptsModal(false)} className="text-gray-500 hover:text-white">
                                <CheckCircle2 size={24} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                    </Card>
                </div>
            )}

            {showMusicModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowMusicModal(false)} />
                    <Card className="relative w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col border-white/20 shadow-2xl">
                        <div className="flex items-center justify-between p-4 border-b border-white/10">
                            <h3 className="font-bold text-lg text-white">Music Library</h3>
                            <button onClick={() => setShowMusicModal(false)} className="text-gray-500 hover:text-white">
                                <CheckCircle2 size={24} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {isLoadingMusic ? (
                                <div className="py-20 flex justify-center">
                                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-500" />
                                </div>
                            ) : musicItems.length > 0 ? (
                                musicItems.map((item: any) => (
                                    <div
                                        key={item.path || item.name}
                                        className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col md:flex-row md:items-center gap-3"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs text-gray-400 uppercase tracking-wider">{item.name || 'Audio'}</p>
                                            <p className="text-xs font-mono text-white/80 truncate">{item.path}</p>
                                        </div>
                                        <audio controls src={toOutputUrl(item.path, api.baseUrl)} className="w-full md:w-56" />
                                        <Button
                                            onClick={() => handleSelectMusic(item)}
                                            className="text-xs h-8"
                                            variant="secondary"
                                        >
                                            Use
                                        </Button>
                                    </div>
                                ))
                            ) : (
                                <div className="py-20 text-center text-gray-400 text-sm">
                                    No audio files found in outputs.
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}

