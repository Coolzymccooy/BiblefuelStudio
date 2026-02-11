import { useEffect, useState, type ChangeEvent } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Textarea } from '../components/ui/Textarea';
import { Select } from '../components/ui/Select';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { Play, Library, Video, CheckCircle2, ClipboardList, AudioLines } from 'lucide-react';
import { loadJson, saveJson, STORAGE_KEYS, toOutputUrl } from '../lib/storage';

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
    }, []);

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

        setIsRendering(true);
        try {
            const endpoint = renderInBackground ? '/api/jobs/enqueue' : `/api/render/${mode}`;
            const payload = renderInBackground
                ? {
                    type: mode === 'video' ? 'render_video' : 'render_waveform',
                    payload: {
                        backgroundPath: backgroundItem?.id || backgroundPath,
                        audioPath,
                        lines: cleanLines,
                        durationSec: 20,
                        aspect,
                        captionWidthPct: captionWidth,
                        musicPath: musicPath || undefined,
                        musicVolume,
                        autoDuck,
                    },
                }
                : {
                    backgroundPath: backgroundItem?.id || backgroundPath,
                    audioPath,
                    lines: cleanLines,
                    durationSec: 20,
                    aspect,
                    captionWidthPct: captionWidth,
                    musicPath: musicPath || undefined,
                    musicVolume,
                    autoDuck,
                };

            const response = await api.post(endpoint, payload);

            if (response.ok) {
                if (renderInBackground) {
                    toast.success('Job enqueued successfully!');
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

    return (
        <div className="space-y-6 animate-fade-in">
            <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-primary-200">
                Video Renderer
            </h2>

            <Card title="Configuration">
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">
                                    Background Asset
                                </label>
                                {backgroundItem ? (
                                    <div
                                        className={`relative bg-black rounded-xl overflow-hidden group ${aspect === 'landscape'
                                            ? 'aspect-[16/9]'
                                            : aspect === 'square'
                                                ? 'aspect-square'
                                                : 'aspect-[9/16]'
                                            }`}
                                    >
                                        <img src={backgroundItem.image} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" alt="" />
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
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">
                                    Output Frame
                                </label>
                                <Select value={aspect} onChange={(e: ChangeEvent<HTMLSelectElement>) => setAspect(e.target.value as any)}>
                                    <option value="portrait">Portrait (9:16)</option>
                                    <option value="landscape">Landscape (16:9)</option>
                                    <option value="square">Square (1:1)</option>
                                </Select>
                                <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-tighter">
                                    Text auto-wrap adjusts to the selected frame
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">
                                    Caption Width ({captionWidth}%)
                                </label>
                                <input
                                    type="range"
                                    min="60"
                                    max="100"
                                    step="2"
                                    value={captionWidth}
                                    onChange={(e) => setCaptionWidth(Number(e.target.value))}
                                    className="w-full accent-primary-500"
                                />
                                <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-tighter">
                                    Lower value = more padding and tighter line wrapping
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">
                                    Audio Source (required for waveform)
                                </label>
                                <Input
                                    value={audioPath}
                                    onChange={(e) => setAudioPath(e.target.value)}
                                    placeholder="e.g. server/outputs/tts-xyz.mp3"
                                    className="bg-black/20"
                                />
                                {audioHistory.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {audioHistory.slice(0, 4).map((item) => (
                                            <button
                                                key={item.id}
                                                onClick={() => setAudioPath(item.path)}
                                                className="text-[10px] px-2 py-1 rounded-full bg-white/10 text-gray-200 hover:bg-white/20"
                                            >
                                                {item.kind}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">
                                    Soundtrack (optional)
                                </label>
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
                                <label className="block text-xs text-gray-500 mt-2">
                                    Music Volume ({musicVolume})
                                </label>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={musicVolume}
                                    onChange={(e) => setMusicVolume(Number(e.target.value))}
                                    className="w-full accent-primary-500"
                                />
                                <label className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                                    <input
                                        type="checkbox"
                                        checked={autoDuck}
                                        onChange={(e) => setAutoDuck(e.target.checked)}
                                        className="rounded border-white/10 bg-black/50 checked:bg-primary-500"
                                    />
                                    Auto-duck music under voice
                                </label>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">
                                    Overlay Text (max 6 lines)
                                </label>
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
                                <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-tighter">One line per caption slide (auto-sliced)</p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="background"
                            checked={renderInBackground}
                            onChange={(e) => setRenderInBackground(e.target.checked)}
                            className="rounded border-white/10 bg-black/50 checked:bg-primary-500"
                        />
                        <label htmlFor="background" className="text-sm text-gray-400">
                            Render in background (Jobs System)
                        </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Button
                            onClick={() => handleRender('video')}
                            isLoading={isRendering}
                            className="w-full h-12 text-md"
                        >
                            <Video size={18} className="mr-2" />
                            {renderInBackground ? 'Queue Video Render' : 'Start Instant Render'}
                        </Button>
                        <Button
                            onClick={() => handleRender('waveform')}
                            isLoading={isRendering}
                            variant="secondary"
                            className="w-full h-12 text-md"
                        >
                            <AudioLines size={18} className="mr-2" />
                            {renderInBackground ? 'Queue Waveform Render' : 'Render Waveform MP4'}
                        </Button>
                    </div>
                </div>
            </Card>

            {result && (
                <Card title="Render Result" className="border-green-500/20 bg-green-500/5">
                    <div className="space-y-4">
                        <div className="p-3 bg-black/40 rounded-lg font-mono text-xs text-green-400 break-all">
                            {result.file || JSON.stringify(result)}
                        </div>
                        <Button
                            onClick={() => {
                                const fileUrl = toOutputUrl(result.file, api.baseUrl);
                                window.open(fileUrl, '_blank');
                            }}
                            variant="secondary"
                            className="w-full"
                        >
                            <Play size={16} className="mr-2" />
                            Open Video
                        </Button>
                    </div>
                </Card>
            )}

            {showLibraryModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowLibraryModal(false)} />
                    <Card className="relative w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col border-white/20 shadow-2xl">
                        <div className="flex items-center justify-between p-4 border-b border-white/10">
                            <h3 className="font-bold text-lg text-white">Select Background</h3>
                            <button onClick={() => setShowLibraryModal(false)} className="text-gray-500 hover:text-white">
                                <CheckCircle2 size={24} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
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
                                        <img src={item.image} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" alt="" />
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
