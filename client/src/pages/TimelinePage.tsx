import { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import {
    Play,
    Save,
    Trash2,
    Plus,
    Music,
    Settings2,
    Volume2,
    Clock,
    Waves,
    Library,
    Film,
    Download,
    X,
    CheckCircle2
} from 'lucide-react';

interface TimelineClip {
    id: string;
    path: string;
    text?: string;
    duration: number;
    startOffset: number;
}

interface LibraryItem {
    id: string;
    url: string;
    previewUrl?: string;
    image: string;
    savedAt: string;
}

export function TimelinePage() {
    const [clips, setClips] = useState<TimelineClip[]>([]);
    const [backgroundItem, setBackgroundItem] = useState<LibraryItem | null>(null);
    const [showLibraryModal, setShowLibraryModal] = useState(false);
    const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
    const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    // Global controls
    const [fadeIn, setFadeIn] = useState(0);
    const [fadeOut, setFadeOut] = useState(0);
    const [normalizeLUFS, setNormalizeLUFS] = useState(-14);
    const [deess, setDeess] = useState(true);

    const loadClipsFromCache = () => {
        const cached = localStorage.getItem('BF_TIMELINE_CLIPS');
        if (cached) {
            try {
                setClips(JSON.parse(cached));
            } catch (e) {
                console.error('Failed to parse cached clips');
            }
        }
    };

    useEffect(() => {
        loadClipsFromCache();
    }, []);

    const saveClipsToCache = (newClips: TimelineClip[]) => {
        localStorage.setItem('BF_TIMELINE_CLIPS', JSON.stringify(newClips));
    };

    const handleAddClip = () => {
        toast.error('Add Clip via Library coming soon');
    };

    const handleRemoveClip = (id: string) => {
        const newClips = clips.filter(c => c.id !== id);
        setClips(newClips);
        saveClipsToCache(newClips);
    };

    const handleRender = async () => {
        if (clips.length === 0) {
            toast.error('Timeline is empty');
            return;
        }

        const toastId = toast.loading('Rendering timeline audio...');
        try {
            const response = await api.post('/api/audio-adv/timeline', {
                clips,
                normalizeLUFS,
                fades: { inMs: fadeIn, outMs: fadeOut },
                deess: { enabled: deess, amount: 0.55 },
            });

            if (response.ok) {
                toast.success('Audio rendered successfully!', { id: toastId });
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
        if (!backgroundItem) {
            toast.error('Please select a background first');
            return;
        }

        setIsPreviewing(true);
        try {
            const response = await api.post('/api/audio-adv/timeline-preview', {
                clips,
                backgroundPath: backgroundItem.id,
                normalizeLUFS,
                fades: { inMs: fadeIn, outMs: fadeOut },
                deess: { enabled: deess, amount: 0.55 },
            });

            if (response.ok && response.data?.file) {
                toast.success('Preview generated!');
                const fileName = response.data.file.split(/[\\/]/).pop();
                setPreviewUrl(`${api.baseUrl}/outputs/${fileName}`);
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

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-primary-200">
                        Timeline Editor
                    </h2>
                    <p className="text-gray-400">Assemble and master your audio clips with precision.</p>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={() => toast.success('Saved')}>
                        <Save size={16} className="mr-2" />
                        Save Project
                    </Button>
                    <Button onClick={handleRender}>
                        <Play size={16} className="mr-2" />
                        Render Audio
                    </Button>
                </div>
            </div>

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
                                        <p className="text-xs text-gray-500">Auto-sequenced timeline</p>
                                    </div>
                                </div>
                                <Button variant="secondary" onClick={handleAddClip} className="h-9 px-4 text-xs">
                                    <Plus size={14} className="mr-2" />
                                    Add Clip
                                </Button>
                            </div>

                            {clips.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 text-center opacity-30">
                                    <Music size={48} className="mb-4" />
                                    <p className="text-sm">No clips in timeline.</p>
                                    <p className="text-xs">Add clips from the library or scripts page.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {clips.map((clip, idx) => (
                                        <div
                                            key={clip.id}
                                            className="group relative bg-white/[0.02] border border-white/5 rounded-xl p-4 hover:border-primary-500/30 hover:bg-white/[0.04] transition-all"
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-4">
                                                    <div className="h-8 w-8 rounded-lg bg-black/40 flex items-center justify-center text-xs font-bold text-gray-500">
                                                        {idx + 1}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-200 truncate max-w-[300px]">
                                                            {clip.text || clip.path.split('/').pop()}
                                                        </p>
                                                        <div className="flex items-center gap-3 mt-1">
                                                            <span className="text-[10px] text-gray-500 flex items-center gap-1 font-mono uppercase tracking-tighter">
                                                                <Clock size={10} /> {clip.duration.toFixed(2)}s
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleRemoveClip(clip.id)}
                                                    className="p-2 text-gray-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
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
                                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
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
                                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
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
                                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
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
                    {/* Video Selection */}
                    <Card title="Video Background">
                        <div className="p-2">
                            {backgroundItem ? (
                                <div className="space-y-4">
                                    <div className="aspect-[9/16] bg-black rounded-xl overflow-hidden relative group">
                                        <video
                                            src={backgroundItem.previewUrl || backgroundItem.url}
                                            autoPlay
                                            muted
                                            loop
                                            className="w-full h-full object-cover"
                                        />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                            <Button onClick={() => setBackgroundItem(null)} variant="secondary" className="bg-red-500/20 text-red-400 border-red-500/20 hover:bg-red-500/40 h-8 text-[10px]">
                                                Change
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="text-[10px] font-mono text-gray-500 break-all bg-black/20 p-2 rounded">
                                        ID: {backgroundItem.id}
                                    </div>
                                    <Button
                                        onClick={handlePreview}
                                        isLoading={isPreviewing}
                                        variant="secondary"
                                        className="w-full h-9 text-[10px] border-primary-500/20 text-primary-400"
                                    >
                                        <Film size={14} className="mr-2" />
                                        Preview with Background
                                    </Button>
                                </div>
                            ) : (
                                <div className="py-12 border-2 border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center text-center px-4">
                                    <Library size={32} className="text-gray-600 mb-3" />
                                    <p className="text-xs text-gray-500 mb-4">No background selected</p>
                                    <Button onClick={openLibrary} className="w-full h-9 text-[10px]">
                                        Open Library Picker
                                    </Button>
                                </div>
                            )}
                        </div>
                    </Card>

                    <Card title="Stats" className="opacity-50">
                        <div className="space-y-4 p-2">
                            <div className="flex justify-between text-xs">
                                <span className="text-gray-500">Total Duration</span>
                                <span className="font-mono text-primary-400">
                                    {clips.reduce((acc, c) => acc + c.duration, 0).toFixed(2)}s
                                </span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-gray-500">Clips Count</span>
                                <span className="font-mono text-primary-400">{clips.length}</span>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>

            {/* Library Picker Modal */}
            {showLibraryModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowLibraryModal(false)} />
                    <Card className="relative w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col border-white/20 shadow-2xl">
                        <div className="flex items-center justify-between p-4 border-b border-white/10">
                            <h3 className="font-bold text-lg text-white">Select Background</h3>
                            <button onClick={() => setShowLibraryModal(false)} className="text-gray-500 hover:text-white">
                                <X size={24} />
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
                                        onClick={() => {
                                            setBackgroundItem(item);
                                            setShowLibraryModal(false);
                                            toast.success('Background selected');
                                        }}
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
                                    onClick={() => window.open(previewUrl, '_blank')}
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
        </div>
    );
}
