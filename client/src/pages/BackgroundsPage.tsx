import { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { Search, Download, Play, ExternalLink, Image as ImageIcon, Bookmark, Trash2, Library, Sparkles, FolderUp, Tag, X } from 'lucide-react';
import { useConfig } from '../lib/config';

interface PexelsVideo {
    id: string | number;
    url?: string;
    duration?: number;
    image?: string;
    previewUrl?: string;
    categories?: string[];
    searchQuery?: string;
}

const CANONICAL_CATEGORIES = [
    'celebration', 'sunshine', 'faith', 'worship', 'prayer', 'sermon',
    'nature', 'abstract', 'peace', 'hope', 'sky', 'ocean', 'mountain',
    'candle', 'light', 'stars', 'urban',
];

function normalizeSrc(value?: string) {
    return String(value || '').replace(/\\/g, '/').trim();
}

function isVideoSrc(value?: string) {
    return /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(String(value || ''));
}

function deriveThumb(video: PexelsVideo) {
    const candidate = normalizeSrc(video.previewUrl || video.url);
    if (!candidate || candidate.startsWith('http://') || candidate.startsWith('https://')) return '';
    const fileName = candidate.split('/').pop() || '';
    const stem = fileName.replace(/\.[^.]+$/, '');
    if (!stem) return '';
    return `/outputs/${stem}.jpg`;
}

function PreviewCardMedia({ video }: { video: PexelsVideo }) {
    const sourceImage = normalizeSrc(video.image);
    const derivedImage = deriveThumb(video);
    const videoSrc = normalizeSrc(video.previewUrl || video.url);
    const hasVideo = Boolean(videoSrc) && isVideoSrc(videoSrc);
    const [imageSrc, setImageSrc] = useState(sourceImage || derivedImage);
    const [usedFallback, setUsedFallback] = useState(false);
    const [showVideo, setShowVideo] = useState(false);

    useEffect(() => {
        setImageSrc(sourceImage || derivedImage);
        setUsedFallback(false);
        setShowVideo(false);
    }, [video.id, sourceImage, derivedImage, video.previewUrl, video.url]);

    const handleImageError = () => {
        if (!usedFallback && derivedImage && imageSrc !== derivedImage) {
            setImageSrc(derivedImage);
            setUsedFallback(true);
            return;
        }
        setImageSrc('');
    };

    return (
        <div
            className="w-full h-full bg-black relative"
            onMouseEnter={() => {
                if (hasVideo) setShowVideo(true);
            }}
            onMouseLeave={() => setShowVideo(false)}
            onClick={() => {
                if (hasVideo) setShowVideo((v) => !v);
            }}
        >
            {imageSrc ? (
                <img
                    src={imageSrc}
                    className="w-full h-full object-cover opacity-85 group-hover:opacity-100 transition-opacity"
                    alt=""
                    loading="lazy"
                    onError={handleImageError}
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-900">
                    <ImageIcon className="text-gray-700" size={48} />
                </div>
            )}
            {hasVideo && showVideo && (
                <video
                    src={videoSrc}
                    className="absolute inset-0 w-full h-full object-cover"
                    muted
                    loop
                    playsInline
                    autoPlay
                    preload="metadata"
                    onError={() => setShowVideo(false)}
                />
            )}
        </div>
    );
}

export function BackgroundsPage() {
    const { config } = useConfig();
    const pexelsEnabled = config.features.pexels;
    const pixabayEnabled = config.features.pixabay;
    const [activeTab, setActiveTab] = useState<'search' | 'animated' | 'local' | 'library'>('search');
    const [query, setQuery] = useState('sunrise clouds');
    const [videos, setVideos] = useState<PexelsVideo[]>([]);
    const [animatedQuery, setAnimatedQuery] = useState('space nebula');
    const [animatedVideos, setAnimatedVideos] = useState<PexelsVideo[]>([]);
    const [isSearchingAnimated, setIsSearchingAnimated] = useState(false);
    const [libraryItems, setLibraryItems] = useState<PexelsVideo[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
    const [isBulkDownloadingSearch, setIsBulkDownloadingSearch] = useState(false);
    const [isBulkDownloadingAnimated, setIsBulkDownloadingAnimated] = useState(false);
    const [localFolder, setLocalFolder] = useState('');
    const [importedLocal, setImportedLocal] = useState<PexelsVideo[]>([]);
    const [categoryFilter, setCategoryFilter] = useState<string>('');
    const [editingCategoriesFor, setEditingCategoriesFor] = useState<string | number | null>(null);

    const allCategoriesInLibrary = Array.from(new Set(
        libraryItems.flatMap((it) => Array.isArray(it.categories) ? it.categories : [])
    )).sort();
    const filteredLibrary = categoryFilter
        ? libraryItems.filter((item) => (item.categories || []).includes(categoryFilter))
        : libraryItems;

    const handleUpdateCategories = async (id: string | number, categories: string[]) => {
        try {
            const res = await api.patch(`/api/library/${encodeURIComponent(String(id))}/categories`, { categories });
            if (res.ok && res.data?.item) {
                setLibraryItems((prev) => prev.map((it) => it.id === id ? { ...it, categories: res.data.item.categories } : it));
                toast.success('Categories updated');
            } else {
                toast.error(res.error || 'Failed to update categories');
            }
        } catch {
            toast.error('Failed to update categories');
        }
    };

    const handleAutoTagAll = async () => {
        try {
            const res = await api.post('/api/library/auto-tag', {});
            if (res.ok) {
                toast.success(`Auto-tagged ${res.data?.tagged || 0} items`);
                await loadLibrary();
            } else {
                toast.error(res.error || 'Auto-tag failed');
            }
        } catch {
            toast.error('Auto-tag failed');
        }
    };

    const handleSearch = async () => {
        if (!pexelsEnabled) {
            toast.error('Pexels API is not configured');
            return;
        }
        setIsSearching(true);
        try {
            const response = await api.get(`/api/pexels/search?q=${encodeURIComponent(query)}`);

            if (response.ok && response.data?.videos) {
                setVideos(response.data.videos);
                toast.success(`Found ${response.data.videos.length} videos`);
            } else {
                toast.error(response.error || 'Search failed');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsSearching(false);
        }
    };

    const handleAnimatedSearch = async () => {
        if (!pixabayEnabled) {
            toast.error('Pixabay API is not configured');
            return;
        }
        setIsSearchingAnimated(true);
        try {
            const response = await api.get(`/api/pixabay/search?q=${encodeURIComponent(animatedQuery)}`);
            if (response.ok && response.data?.videos) {
                setAnimatedVideos(response.data.videos);
                toast.success(`Found ${response.data.videos.length} animated videos`);
            } else {
                toast.error(response.error || 'Search failed');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsSearchingAnimated(false);
        }
    };

    const loadLibrary = async () => {
        setIsLoadingLibrary(true);
        try {
            const response = await api.get('/api/library');
            if (response.ok && response.data?.library?.items) {
                setLibraryItems(response.data.library.items);
            }
        } catch (error) {
            console.error('Failed to load library', error);
        } finally {
            setIsLoadingLibrary(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'library') {
            loadLibrary();
        }
    }, [activeTab]);

    const handleSaveToLibrary = async (video: PexelsVideo) => {
        try {
            const response = await api.post('/api/library/add', video);
            if (response.ok) {
                toast.success('Saved to Library!');
            } else {
                toast.error(response.error || 'Failed to save');
            }
        } catch (error) {
            toast.error('An error occurred');
        }
    };

    const handleRemoveFromLibrary = async (id: string | number) => {
        try {
            const response = await api.delete(`/api/library/${id}`);
            if (response.ok) {
                setLibraryItems(prev => prev.filter(item => item.id !== id));
                toast.success('Removed from Library');
            } else {
                toast.error(response.error || 'Failed to remove');
            }
        } catch (error) {
            toast.error('An error occurred');
        }
    };

    const handleDownload = async (video: PexelsVideo) => {
        if (!pexelsEnabled) {
            toast.error('Pexels API is not configured');
            return;
        }
        try {
            toast.loading(`Downloading ${video.id}...`, { id: 'download' });
            const response = await api.post('/api/pexels/download', {
                id: video.id,
                image: video.image,
                previewUrl: video.previewUrl,
                duration: video.duration,
                url: video.url,
                searchQuery: query, // auto-tag the new Library item with this search term
            });

            if (response.ok && response.data?.file) {
                if (response.data?.item) {
                    setLibraryItems(prev => {
                        const next = [response.data.item, ...prev.filter((x) => x.id !== response.data.item.id)];
                        return next;
                    });
                }
                toast.success(`Downloaded and saved to Library`, { id: 'download' });
            } else {
                toast.error(response.error || 'Download failed', { id: 'download' });
            }
        } catch (error) {
            toast.error('An error occurred', { id: 'download' });
        }
    };

    const handleAnimatedDownload = async (video: PexelsVideo) => {
        if (!pixabayEnabled) {
            toast.error('Pixabay API is not configured');
            return;
        }
        try {
            toast.loading(`Downloading ${video.id}...`, { id: 'download-animated' });
            const response = await api.post('/api/pixabay/download', {
                id: video.id,
                image: video.image,
                previewUrl: video.previewUrl,
                duration: video.duration,
                url: video.url,
                searchQuery: animatedQuery, // auto-tag the new Library item
            });
            if (response.ok && response.data?.file) {
                if (response.data?.item) {
                    setLibraryItems(prev => {
                        const next = [response.data.item, ...prev.filter((x) => x.id !== response.data.item.id)];
                        return next;
                    });
                }
                toast.success(`Downloaded and saved to Library`, { id: 'download-animated' });
            } else {
                toast.error(response.error || 'Download failed', { id: 'download-animated' });
            }
        } catch (error) {
            toast.error('An error occurred', { id: 'download-animated' });
        }
    };

    const handleImportLocal = async () => {
        if (!localFolder.trim()) {
            toast.error('Enter a folder path');
            return;
        }
        try {
            const response = await api.post('/api/library/import-local', { folderPath: localFolder.trim() });
            if (response.ok && response.data?.imported) {
                setImportedLocal(response.data.imported);
                toast.success(`Imported ${response.data.imported.length} files`);
            } else {
                toast.error(response.error || 'Import failed');
            }
        } catch (error) {
            toast.error('An error occurred');
        }
    };

    const handleBulkDownload = async (
        items: PexelsVideo[],
        kind: 'pexels' | 'pixabay'
    ) => {
        if (items.length === 0) {
            toast.error('No results to download');
            return;
        }
        const enabled = kind === 'pexels' ? pexelsEnabled : pixabayEnabled;
        if (!enabled) {
            toast.error(`${kind === 'pexels' ? 'Pexels' : 'Pixabay'} API is not configured`);
            return;
        }

        const endpoint = kind === 'pexels' ? '/api/pexels/download' : '/api/pixabay/download';
        const toastId = kind === 'pexels' ? 'download-all-pexels' : 'download-all-pixabay';
        if (kind === 'pexels') setIsBulkDownloadingSearch(true);
        if (kind === 'pixabay') setIsBulkDownloadingAnimated(true);

        let okCount = 0;
        let failCount = 0;
        try {
            for (let i = 0; i < items.length; i++) {
                const video = items[i];
                toast.loading(`Downloading ${i + 1}/${items.length}...`, { id: toastId });
                const response = await api.post(endpoint, {
                    id: video.id,
                    image: video.image,
                    previewUrl: video.previewUrl,
                    duration: video.duration,
                    url: video.url,
                });

                if (response.ok && response.data?.file) {
                    okCount += 1;
                    if (response.data?.item) {
                        setLibraryItems(prev => [response.data.item, ...prev.filter((x) => x.id !== response.data.item.id)]);
                    }
                } else {
                    failCount += 1;
                }
            }

            if (failCount === 0) {
                toast.success(`Downloaded ${okCount}/${items.length} and saved to Library`, { id: toastId });
            } else if (okCount > 0) {
                toast.success(`Downloaded ${okCount}/${items.length}. Failed: ${failCount}`, { id: toastId });
            } else {
                toast.error('Bulk download failed', { id: toastId });
            }
        } catch {
            toast.error('Bulk download failed', { id: toastId });
        } finally {
            if (kind === 'pexels') setIsBulkDownloadingSearch(false);
            if (kind === 'pixabay') setIsBulkDownloadingAnimated(false);
        }
    };

    const renderGrid = (items: PexelsVideo[], isLibrary: boolean, onDownload: (video: PexelsVideo) => void) => (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {items.map((video) => (
                <div key={video.id} className="group relative bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden hover:border-primary-500/50 transition-all duration-300">
                    <div className="aspect-[9/16] bg-black relative">
                        <PreviewCardMedia video={video} />
                        <div className="absolute top-3 right-3 px-2 py-1 bg-black/60 backdrop-blur-md rounded-md text-[10px] font-bold text-white border border-white/10">
                            {video.duration ?? 0}s
                        </div>
                        {isLibrary && Array.isArray(video.categories) && video.categories.length > 0 && (
                            <div className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[70%]">
                                {video.categories.slice(0, 3).map((cat) => (
                                    <span key={cat} className="text-[9px] px-1.5 py-0.5 bg-white/[0.04] text-black font-bold rounded-full backdrop-blur-sm">
                                        {cat}
                                    </span>
                                ))}
                                {video.categories.length > 3 && (
                                    <span className="text-[9px] px-1.5 py-0.5 bg-black/60 text-white rounded-full backdrop-blur-sm">
                                        +{video.categories.length - 3}
                                    </span>
                                )}
                            </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4 gap-2">
                            <div className="flex gap-2">
                                <Button
                                    onClick={() => onDownload(video)}
                                    className="flex-1 h-9 text-xs font-bold"
                                >
                                    <Download size={14} className="mr-2" />
                                    Download
                                </Button>
                                {isLibrary ? (
                                    <>
                                        <Button
                                            onClick={() => setEditingCategoriesFor(video.id)}
                                            variant="secondary"
                                            className="h-9 px-3 bg-white/[0.04] border-white/10 hover:bg-white/[0.04] text-content-secondary"
                                            title="Edit categories"
                                        >
                                            <Tag size={14} />
                                        </Button>
                                        <Button
                                            onClick={() => handleRemoveFromLibrary(video.id)}
                                            variant="secondary"
                                            className="h-9 px-3 bg-red-500/10 border-red-500/20 hover:bg-red-500/20 text-red-400"
                                            title="Remove from Library"
                                        >
                                            <Trash2 size={14} />
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        onClick={() => handleSaveToLibrary(video)}
                                        variant="secondary"
                                        className="h-9 px-3 bg-white/10 border-white/10 hover:bg-white/20"
                                        title="Save to Library"
                                    >
                                        <Bookmark size={14} />
                                    </Button>
                                )}
                            </div>
                            <a
                                href={video.url || video.previewUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="w-full h-9 flex items-center justify-center bg-white/10 hover:bg-white/20 border border-white/10 text-white rounded-lg text-xs font-bold transition-all"
                            >
                                <ExternalLink size={14} className="mr-2" />
                                View Source
                            </a>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );

    const editingItem = editingCategoriesFor != null
        ? libraryItems.find((it) => it.id === editingCategoriesFor) || null
        : null;

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <ScreenHeader eyebrow="Studio" title={<>Set the <em>scene</em>.</>} subtitle="Search or browse your saved 4K/HD portrait footage." />


                <div className="flex flex-wrap bg-white/5 border border-white/10 p-1 rounded-xl">
                    <button
                        onClick={() => setActiveTab('search')}
                        disabled={!pexelsEnabled}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'search' ? 'bg-primary-500 text-black shadow-lg' : 'text-gray-400 hover:text-black'} ${!pexelsEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                        <Search size={14} />
                        Search
                    </button>
                    <button
                        onClick={() => setActiveTab('animated')}
                        disabled={!pixabayEnabled}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'animated' ? 'bg-primary-500 text-black shadow-lg' : 'text-gray-400 hover:text-black'} ${!pixabayEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                        <Sparkles size={14} />
                        Animated
                    </button>
                    <button
                        onClick={() => setActiveTab('local')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'local' ? 'bg-primary-500 text-black shadow-lg' : 'text-gray-400 hover:text-black'}`}
                    >
                        <FolderUp size={14} />
                        Local Packs
                    </button>
                    <button
                        onClick={() => setActiveTab('library')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'library' ? 'bg-primary-500 text-black shadow-lg' : 'text-gray-400 hover:text-black'}`}
                    >
                        <Library size={14} />
                        Library
                    </button>
                </div>
            </div>

            {activeTab === 'search' ? (
                <>
                    {!pexelsEnabled && (
                        <Card className="bg-white/[0.04] border-white/10 text-content-secondary text-xs">
                            Pexels is disabled. Set `PEXELS_API_KEY` in `server/.env`.
                        </Card>
                    )}
                    <Card className="bg-white/5 border-white/10 backdrop-blur-xl">
                        <div className="flex flex-col sm:flex-row gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                                <Input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="e.g. moody bible, storm clouds, peaceful nature..."
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                    className="pl-10 bg-black/20 border-white/10"
                                />
                            </div>
                            <Button onClick={handleSearch} isLoading={isSearching} className="px-8">
                                Search
                            </Button>
                        </div>
                    </Card>

                    {videos.length > 0 ? (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between px-2">
                                <h3 className="text-caption">Results ({videos.length})</h3>
                                <Button
                                    onClick={() => handleBulkDownload(videos, 'pexels')}
                                    isLoading={isBulkDownloadingSearch}
                                    className="h-8 text-[10px] uppercase tracking-tighter"
                                >
                                    <Download size={12} className="mr-1" />
                                    Download All
                                </Button>
                            </div>
                            {renderGrid(videos, false, handleDownload)}
                        </div>
                    ) : !isSearching && (
                        <div className="py-20 flex flex-col items-center justify-center opacity-30">
                            <Play size={64} className="text-gray-600 mb-4" />
                            <p className="text-help">Search for portrait videos to see results.</p>
                        </div>
                    )}
                </>
            ) : activeTab === 'animated' ? (
                <>
                    {!pixabayEnabled && (
                        <Card className="bg-white/[0.04] border-white/10 text-content-secondary text-xs">
                            Pixabay is disabled. Set `PIXABAY_API_KEY` in `server/.env`.
                        </Card>
                    )}
                    <Card className="bg-white/5 border-white/10 backdrop-blur-xl">
                        <div className="flex flex-col sm:flex-row gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                                <Input
                                    value={animatedQuery}
                                    onChange={(e) => setAnimatedQuery(e.target.value)}
                                    placeholder="e.g. space, nebula, galaxy, abstract..."
                                    onKeyDown={(e) => e.key === 'Enter' && handleAnimatedSearch()}
                                    className="pl-10 bg-black/20 border-white/10"
                                />
                            </div>
                            <Button onClick={handleAnimatedSearch} isLoading={isSearchingAnimated} className="px-8">
                                Search
                            </Button>
                        </div>
                    </Card>

                    {animatedVideos.length > 0 ? (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between px-2">
                                <h3 className="text-caption">Animated Results ({animatedVideos.length})</h3>
                                <Button
                                    onClick={() => handleBulkDownload(animatedVideos, 'pixabay')}
                                    isLoading={isBulkDownloadingAnimated}
                                    className="h-8 text-[10px] uppercase tracking-tighter"
                                >
                                    <Download size={12} className="mr-1" />
                                    Download All
                                </Button>
                            </div>
                            {renderGrid(animatedVideos, false, handleAnimatedDownload)}
                            <div className="text-help px-2">
                                Downloads use Pixabay. Make sure `PIXABAY_API_KEY` is set in `server/.env`.
                            </div>
                        </div>
                    ) : !isSearchingAnimated && (
                        <div className="py-20 flex flex-col items-center justify-center opacity-30">
                            <Sparkles size={64} className="text-gray-600 mb-4" />
                            <p className="text-help">Search for animated backgrounds to see results.</p>
                        </div>
                    )}
                </>
            ) : activeTab === 'local' ? (
                <div className="space-y-4">
                    <Card className="bg-white/5 border-white/10 backdrop-blur-xl">
                        <div className="flex gap-2">
                            <Input
                                value={localFolder}
                                onChange={(e) => setLocalFolder(e.target.value)}
                                placeholder="e.g. C:\\videos\\studio-packs"
                                className="bg-black/20 border-white/10"
                            />
                            <Button onClick={handleImportLocal} className="px-6">
                                Import Folder
                            </Button>
                        </div>
                        <p className="text-help mt-2">
                            Imports .mp4/.mov/.webm/.m4v from the folder into the library and outputs.
                        </p>
                    </Card>
                    {importedLocal.length > 0 && (
                        <div className="space-y-4">
                            <h3 className="text-caption">Imported ({importedLocal.length})</h3>
                            {renderGrid(importedLocal, true, handleDownload)}
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-2">
                        <h3 className="text-caption">
                            Saved Library ({categoryFilter ? `${filteredLibrary.length} of ${libraryItems.length}` : libraryItems.length})
                        </h3>
                        <div className="flex items-center gap-2">
                            <Button onClick={handleAutoTagAll} variant="secondary" className="h-8 text-[10px] uppercase tracking-tighter" disabled={isLoadingLibrary || libraryItems.length === 0}>
                                <Tag size={12} className="mr-1" />
                                Auto-Tag All
                            </Button>
                            <Button onClick={loadLibrary} variant="secondary" className="h-8 text-[10px] uppercase tracking-tighter" disabled={isLoadingLibrary}>
                                Refresh
                            </Button>
                        </div>
                    </div>

                    {allCategoriesInLibrary.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 px-2">
                            <button
                                onClick={() => setCategoryFilter('')}
                                className={`text-[10px] px-2.5 py-1 rounded-full transition-all ${categoryFilter === '' ? 'bg-primary-500 text-black' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                            >
                                All
                            </button>
                            {allCategoriesInLibrary.map((cat) => (
                                <button
                                    key={cat}
                                    onClick={() => setCategoryFilter(cat === categoryFilter ? '' : cat)}
                                    className={`text-[10px] px-2.5 py-1 rounded-full transition-all ${cat === categoryFilter ? 'bg-amber-500 text-black font-bold' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    )}

                    {filteredLibrary.length > 0 ? (
                        renderGrid(filteredLibrary, true, handleDownload)
                    ) : !isLoadingLibrary && (
                        <Card className="py-20 flex flex-col items-center justify-center opacity-30 border-dashed">
                            <Library size={64} className="text-gray-600 mb-4" />
                            <p className="text-caption">
                                {libraryItems.length === 0 ? 'Library is empty' : `No items in category "${categoryFilter}"`}
                            </p>
                            <p className="text-help mt-2">
                                {libraryItems.length === 0 ? 'Save videos from search to build your library.' : 'Try a different category or clear the filter.'}
                            </p>
                        </Card>
                    )}
                </div>
            )}

            {editingItem && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setEditingCategoriesFor(null)} />
                    <Card className="relative w-full max-w-md border-white/20 shadow-2xl">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Tag size={14} className="text-content-secondary" /> Edit categories
                            </h3>
                            <button onClick={() => setEditingCategoriesFor(null)} className="text-gray-500 hover:text-white">
                                <X size={18} />
                            </button>
                        </div>
                        <p className="text-meta font-mono">ID: {editingItem.id}</p>
                        <div className="flex flex-wrap gap-1.5 mb-4">
                            {CANONICAL_CATEGORIES.map((cat) => {
                                const active = (editingItem.categories || []).includes(cat);
                                return (
                                    <button
                                        key={cat}
                                        onClick={() => {
                                            const current = editingItem.categories || [];
                                            const next = active ? current.filter((c) => c !== cat) : [...current, cat];
                                            handleUpdateCategories(editingItem.id, next);
                                        }}
                                        className={`text-[11px] px-3 py-1 rounded-full transition-all ${active
                                            ? 'bg-amber-500 text-black font-bold'
                                            : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                                    >
                                        {cat}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="text-help">
                            Tags drive the smart background picker in Auto-Publish. Scripts about peace get peace-tagged backgrounds, etc.
                        </p>
                    </Card>
                </div>
            )}
        </div>
    );
}
