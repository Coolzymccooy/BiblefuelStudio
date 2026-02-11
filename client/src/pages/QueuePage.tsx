import { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { Trash2, RefreshCcw, Download, Archive, Trash, Mic, CheckCircle2, Video, Library, Layers } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface QueueItem {
    id: string;
    title: string;
    hook: string;
    verse: string;
    reference: string;
    reflection: string;
    cta: string;
    createdAt?: string;
}

export function QueuePage() {
    const navigate = useNavigate();
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [showBatchModal, setShowBatchModal] = useState(false);
    const [backgroundItem, setBackgroundItem] = useState<any>(null);
    const [showLibraryModal, setShowLibraryModal] = useState(false);
    const [libraryItems, setLibraryItems] = useState<any[]>([]);
    const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
    const [isBatchProcessing, setIsBatchProcessing] = useState(false);

    const loadQueue = async () => {
        setIsLoading(true);
        try {
            const response = await api.get('/api/queue');
            if (response.ok && response.data?.items) {
                setQueue(response.data.items);
            } else {
                toast.error(response.error || 'Failed to load queue');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadQueue();
    }, []);

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this script?')) return;
        try {
            const res = await api.delete(`/api/queue/${id}`);
            if (res.ok) {
                setQueue(prev => prev.filter(item => item.id !== id));
                toast.success('Script deleted');
            } else {
                toast.error(res.error || 'Delete failed');
            }
        } catch (err) {
            toast.error('Failed to delete item');
        }
    };

    const handleSendToVoice = (item: QueueItem) => {
        const fullText = `${item.hook}\n\n${item.verse} (${item.reference})\n\n${item.reflection}\n\n${item.cta}`;
        localStorage.setItem('bf_tts_text', fullText);
        toast.success('Script sent to Voice page!');
        navigate('/voice-audio');
    };

    const handleClearAll = async () => {
        if (!confirm('This will wipe your entire queue. Are you absolutely sure?')) return;
        setIsClearing(true);
        try {
            const res = await api.post('/api/queue/clear', {});
            if (res.ok) {
                setQueue([]);
                toast.success('Queue cleared');
            }
        } catch (err) {
            toast.error('Failed to clear queue');
        } finally {
            setIsClearing(false);
        }
    };

    const handleExportCSV = () => {
        api.download('/api/queue/export.csv');
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === queue.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(queue.map(item => item.id)));
        }
    };

    const toggleSelect = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
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

    const handleBatchRender = async () => {
        if (!backgroundItem) {
            toast.error('Please select a background first');
            return;
        }

        setIsBatchProcessing(true);
        let successCount = 0;
        const selectedItems = queue.filter(item => selectedIds.has(item.id));

        for (const item of selectedItems) {
            try {
                const lines = [item.title, item.hook, item.verse, item.reference, item.reflection, item.cta].slice(0, 6);
                const res = await api.post('/api/jobs/enqueue', {
                    type: 'render_video',
                    payload: {
                        backgroundPath: backgroundItem.id, // Assuming backend handles ID or absolute path
                        lines,
                        durationSec: 20
                    }
                });
                if (res.ok) successCount++;
            } catch (err) {
                console.error('Batch error', err);
            }
        }

        toast.success(`Enqueued ${successCount} render jobs!`);
        setIsBatchProcessing(false);
        setShowBatchModal(false);
        setSelectedIds(new Set());
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-primary-200">Content Queue</h2>
                    <p className="text-gray-400 text-sm mt-1">Manage and export your generated scripts batch.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    {selectedIds.size > 0 && (
                        <div className="flex items-center gap-2 bg-primary-500/10 border border-primary-500/20 px-3 py-1 rounded-full animate-in fade-in zoom-in duration-300">
                            <span className="text-[10px] font-bold text-primary-400 uppercase tracking-widest">{selectedIds.size} Selected</span>
                            <div className="w-px h-3 bg-white/10 mx-1" />
                            <button
                                onClick={() => setShowBatchModal(true)}
                                className="text-[10px] font-bold text-white hover:text-primary-300 uppercase underline decoration-primary-500/50"
                            >
                                Batch Render
                            </button>
                        </div>
                    )}
                    <Button onClick={loadQueue} variant="secondary" className="bg-white/5 border-white/10 h-9 w-full sm:w-auto" disabled={isLoading}>
                        <RefreshCcw size={16} className={isLoading ? 'animate-spin' : ''} />
                    </Button>
                    <Button
                        onClick={handleClearAll}
                        variant="secondary"
                        className="text-red-400 hover:text-red-300 bg-red-500/5 border-red-500/10 h-9 w-full sm:w-auto"
                        disabled={queue.length === 0 || isClearing}
                        isLoading={isClearing}
                    >
                        <Trash size={16} className="mr-2" />
                        Clear All
                    </Button>
                    <Button onClick={handleExportCSV} disabled={queue.length === 0} className="h-9 w-full sm:w-auto">
                        <Download size={16} className="mr-2" />
                        Export CSV
                    </Button>
                </div>
            </div>

            <Card>
                {queue.length === 0 ? (
                    <div className="py-12 flex flex-col items-center justify-center text-center opacity-50">
                        <Archive size={48} className="text-gray-600 mb-4" />
                        <p className="text-gray-400">Queue is empty.</p>
                        <p className="text-xs text-gray-500 mt-1">Scripts you generate will appear here.</p>
                    </div>
                ) : (
                    <div>
                        <div className="sm:hidden space-y-3">
                            {queue.slice(0, 50).map((item) => (
                                <div key={item.id} className={`p-4 rounded-xl border border-white/10 bg-white/[0.02] ${selectedIds.has(item.id) ? 'ring-1 ring-primary-500/30' : ''}`}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex-1">
                                            <div className="font-semibold text-white">{item.title}</div>
                                            <div className="text-xs text-gray-400 mt-1 line-clamp-2 italic">"{item.hook}"</div>
                                            <div className="text-[10px] text-indigo-300 mt-2">{item.verse} - {item.reference}</div>
                                            <div className="text-[10px] text-primary-400 mt-2 uppercase tracking-widest">{item.cta}</div>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(item.id)}
                                            onChange={() => toggleSelect(item.id)}
                                            className="mt-1 rounded border-white/10 bg-black/50 checked:bg-primary-500"
                                        />
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <Button onClick={() => handleSendToVoice(item)} variant="secondary" className="text-xs h-8">
                                            <Mic size={14} className="mr-2" />
                                            Voice
                                        </Button>
                                        <Button onClick={() => handleDelete(item.id)} variant="secondary" className="text-xs h-8 text-red-400">
                                            <Trash2 size={14} className="mr-2" />
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="hidden sm:block overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-white/5 text-gray-400 uppercase text-[10px] tracking-widest font-bold">
                                    <th className="py-3 px-4 w-10">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.size === queue.length && queue.length > 0}
                                            onChange={toggleSelectAll}
                                            className="rounded border-white/10 bg-black/50 checked:bg-primary-500"
                                        />
                                    </th>
                                    <th className="text-left py-3 px-4">Script Details</th>
                                    <th className="text-left py-3 px-4">Hook & CTA</th>
                                    <th className="text-left py-3 px-4">Verse</th>
                                    <th className="text-right py-3 px-4">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {queue.slice(0, 50).map((item) => (
                                    <tr key={item.id} className={`group hover:bg-white/[0.02] transition-colors ${selectedIds.has(item.id) ? 'bg-primary-500/5' : ''}`}>
                                        <td className="py-4 px-4 w-10">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(item.id)}
                                                onChange={() => toggleSelect(item.id)}
                                                className="rounded border-white/10 bg-black/50 checked:bg-primary-500"
                                            />
                                        </td>
                                        <td className="py-4 px-4 align-top max-w-xs">
                                            <div className="font-semibold text-white group-hover:text-primary-300 transition-colors line-clamp-1">{item.title}</div>
                                            {item.createdAt && (
                                                <div className="text-[10px] text-gray-500 mt-1 font-mono">{new Date(item.createdAt).toLocaleDateString()}</div>
                                            )}
                                        </td>
                                        <td className="py-4 px-4 align-top text-xs text-gray-400 w-1/3">
                                            <div className="line-clamp-2 text-gray-300 italic mb-2">"{item.hook}"</div>
                                            <div className="text-[10px] text-primary-400/70 font-semibold bg-primary-500/5 inline-block px-1.5 py-0.5 rounded border border-primary-500/10 uppercase tracking-tighter">{item.cta}</div>
                                        </td>
                                        <td className="py-4 px-4 align-top text-xs text-gray-400 w-1/4">
                                            <div className="line-clamp-2 text-gray-400">{item.verse}</div>
                                            <span className="text-indigo-400/80 font-medium text-[10px] block mt-1">{item.reference}</span>
                                        </td>
                                        <td className="py-4 px-4 align-top text-right">
                                            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => handleSendToVoice(item)}
                                                    className="p-2 text-gray-500 hover:text-primary-400 hover:bg-primary-500/10 rounded-lg transition-all"
                                                    title="Send to Voice generation"
                                                >
                                                    <Mic size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(item.id)}
                                                    className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                                                    title="Remove item"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        </div>
                        <div className="px-4 py-3 border-t border-white/5 bg-white/[0.01]">
                            <p className="text-[10px] text-gray-600 uppercase tracking-widest font-medium">Showing {Math.min(queue.length, 50)} items - Auto-persisted to database</p>
                        </div>
                    </div>
                )}
            </Card>

            {/* Batch Render Modal */}
            {showBatchModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowBatchModal(false)} />
                    <Card className="relative w-full max-w-md border-white/20 shadow-2xl p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-3 bg-primary-500/20 rounded-xl">
                                <Layers size={24} className="text-primary-400" />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg text-white">Batch Rendering</h3>
                                <p className="text-xs text-gray-500">{selectedIds.size} scripts selected for processing.</p>
                            </div>
                        </div>

                        <div className="space-y-4 mb-8">
                            <label className="block text-[10px] uppercase tracking-widest font-bold text-gray-500">Global Background</label>
                            {backgroundItem ? (
                                <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
                                    <img src={backgroundItem.image} className="w-12 h-12 rounded object-cover" alt="" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-bold text-white truncate">Background Selected</div>
                                        <div className="text-[10px] text-gray-500 font-mono truncate">{backgroundItem.id}</div>
                                    </div>
                                    <button onClick={() => setBackgroundItem(null)} className="text-gray-500 hover:text-white">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ) : (
                                <Button onClick={openLibrary} variant="secondary" className="w-full border-dashed border-white/10 h-12 text-xs">
                                    <Library size={16} className="mr-2" />
                                    Select from Library
                                </Button>
                            )}
                        </div>

                        <div className="flex gap-2">
                            <Button
                                onClick={handleBatchRender}
                                isLoading={isBatchProcessing}
                                disabled={!backgroundItem}
                                className="flex-1"
                            >
                                <Video size={16} className="mr-2" />
                                Start Batch Render
                            </Button>
                            <Button onClick={() => setShowBatchModal(false)} variant="secondary">
                                Cancel
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            {/* Library Picker Modal (Reused) */}
            {showLibraryModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowLibraryModal(false)} />
                    <Card className="relative w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col border-white/20 shadow-2xl">
                        <div className="flex items-center justify-between p-4 border-b border-white/10">
                            <h3 className="font-bold text-lg text-white">Select Batch Background</h3>
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
                                        onClick={() => {
                                            setBackgroundItem(item);
                                            setShowLibraryModal(false);
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
        </div>
    );
}
