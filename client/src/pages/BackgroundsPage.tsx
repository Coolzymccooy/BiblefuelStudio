import { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { Search, Download, Play, ExternalLink, Image as ImageIcon, Bookmark, Trash2, Library, Sparkles, FolderUp } from 'lucide-react';
import { useConfig } from '../lib/config';

interface PexelsVideo {
    id: string | number;
    url?: string;
    duration?: number;
    image?: string;
    previewUrl?: string;
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
    const [localFolder, setLocalFolder] = useState('');
    const [importedLocal, setImportedLocal] = useState<PexelsVideo[]>([]);

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

    const handleDownload = async (id: string | number) => {
        if (!pexelsEnabled) {
            toast.error('Pexels API is not configured');
            return;
        }
        try {
            toast.loading(`Downloading ${id}...`, { id: 'download' });
            const response = await api.post('/api/pexels/download', { id });

            if (response.ok && response.data?.file) {
                toast.success(`Downloaded to: ${response.data.file}`, { id: 'download' });
            } else {
                toast.error(response.error || 'Download failed', { id: 'download' });
            }
        } catch (error) {
            toast.error('An error occurred', { id: 'download' });
        }
    };

    const handleAnimatedDownload = async (id: string | number) => {
        if (!pixabayEnabled) {
            toast.error('Pixabay API is not configured');
            return;
        }
        try {
            toast.loading(`Downloading ${id}...`, { id: 'download-animated' });
            const response = await api.post('/api/pixabay/download', { id });
            if (response.ok && response.data?.file) {
                toast.success(`Downloaded to: ${response.data.file}`, { id: 'download-animated' });
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

    const renderGrid = (items: PexelsVideo[], isLibrary: boolean, onDownload: (id: string | number) => void) => (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {items.map((video) => (
                <div key={video.id} className="group relative bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden hover:border-primary-500/50 transition-all duration-300">
                    <div className="aspect-[9/16] bg-black relative">
                        {video.previewUrl ? (
                            <video
                                src={video.previewUrl}
                                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                                muted
                                loop
                                onMouseOver={(e) => e.currentTarget.play()}
                                onMouseOut={(e) => {
                                    e.currentTarget.pause();
                                    e.currentTarget.currentTime = 0;
                                }}
                                poster={video.image}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-900">
                                <ImageIcon className="text-gray-700" size={48} />
                            </div>
                        )}
                        <div className="absolute top-3 right-3 px-2 py-1 bg-black/60 backdrop-blur-md rounded-md text-[10px] font-bold text-white border border-white/10">
                            {video.duration}s
                        </div>
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4 gap-2">
                            <div className="flex gap-2">
                                <Button
                                    onClick={() => onDownload(video.id)}
                                    className="flex-1 h-9 text-xs font-bold"
                                >
                                    <Download size={14} className="mr-2" />
                                    Download
                                </Button>
                                {isLibrary ? (
                                    <Button
                                        onClick={() => handleRemoveFromLibrary(video.id)}
                                        variant="secondary"
                                        className="h-9 px-3 bg-red-500/10 border-red-500/20 hover:bg-red-500/20 text-red-400"
                                        title="Remove from Library"
                                    >
                                        <Trash2 size={14} />
                                    </Button>
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
                                href={video.url}
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

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-primary-200">Visual Backgrounds</h2>
                    <p className="text-gray-400 text-sm mt-1">Search or browse your saved 4K/HD portrait videos.</p>
                </div>

                <div className="flex flex-wrap bg-white/5 border border-white/10 p-1 rounded-xl">
                    <button
                        onClick={() => setActiveTab('search')}
                        disabled={!pexelsEnabled}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'search' ? 'bg-primary-500 text-white shadow-lg' : 'text-gray-400 hover:text-white'} ${!pexelsEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                        <Search size={14} />
                        Search
                    </button>
                    <button
                        onClick={() => setActiveTab('animated')}
                        disabled={!pixabayEnabled}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'animated' ? 'bg-primary-500 text-white shadow-lg' : 'text-gray-400 hover:text-white'} ${!pixabayEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                        <Sparkles size={14} />
                        Animated
                    </button>
                    <button
                        onClick={() => setActiveTab('local')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'local' ? 'bg-primary-500 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                    >
                        <FolderUp size={14} />
                        Local Packs
                    </button>
                    <button
                        onClick={() => setActiveTab('library')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'library' ? 'bg-primary-500 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                    >
                        <Library size={14} />
                        Library
                    </button>
                </div>
            </div>

            {activeTab === 'search' ? (
                <>
                    {!pexelsEnabled && (
                        <Card className="bg-yellow-500/10 border-yellow-500/20 text-yellow-200 text-xs">
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
                                <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500">Results ({videos.length})</h3>
                            </div>
                            {renderGrid(videos, false, handleDownload)}
                        </div>
                    ) : !isSearching && (
                        <div className="py-20 flex flex-col items-center justify-center opacity-30">
                            <Play size={64} className="text-gray-600 mb-4" />
                            <p className="text-gray-400">Search for portrait videos to see results.</p>
                        </div>
                    )}
                </>
            ) : activeTab === 'animated' ? (
                <>
                    {!pixabayEnabled && (
                        <Card className="bg-yellow-500/10 border-yellow-500/20 text-yellow-200 text-xs">
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
                                <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500">Animated Results ({animatedVideos.length})</h3>
                            </div>
                            {renderGrid(animatedVideos, false, handleAnimatedDownload)}
                            <div className="text-xs text-gray-500 px-2">
                                Downloads use Pixabay. Make sure `PIXABAY_API_KEY` is set in `server/.env`.
                            </div>
                        </div>
                    ) : !isSearchingAnimated && (
                        <div className="py-20 flex flex-col items-center justify-center opacity-30">
                            <Sparkles size={64} className="text-gray-600 mb-4" />
                            <p className="text-gray-400">Search for animated backgrounds to see results.</p>
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
                        <p className="text-[10px] text-gray-500 mt-2">
                            Imports .mp4/.mov/.webm/.m4v from the folder into the library and outputs.
                        </p>
                    </Card>
                    {importedLocal.length > 0 && (
                        <div className="space-y-4">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500">Imported ({importedLocal.length})</h3>
                            {renderGrid(importedLocal, true, handleDownload)}
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                        <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500">Saved Library ({libraryItems.length})</h3>
                        <Button onClick={loadLibrary} variant="secondary" className="h-8 text-[10px] uppercase tracking-tighter" disabled={isLoadingLibrary}>
                            Refresh
                        </Button>
                    </div>

                    {libraryItems.length > 0 ? (
                        renderGrid(libraryItems, true, handleDownload)
                    ) : !isLoadingLibrary && (
                        <Card className="py-20 flex flex-col items-center justify-center opacity-30 border-dashed">
                            <Library size={64} className="text-gray-600 mb-4" />
                            <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Library is empty</p>
                            <p className="text-[10px] text-gray-500 mt-2">Save videos from search to build your library.</p>
                        </Card>
                    )}
                </div>
            )}
        </div>
    );
}
