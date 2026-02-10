import { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Textarea } from '../components/ui/Textarea';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { Play, Library, Video, CheckCircle2 } from 'lucide-react';

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
    const [backgroundItem, setBackgroundItem] = useState<any>(null);

    const handleRenderVideo = async () => {
        if (!backgroundPath && !backgroundItem) {
            toast.error('Background is required');
            return;
        }

        setIsRendering(true);
        try {
            const endpoint = renderInBackground ? '/api/jobs/enqueue' : '/api/render/video';
            const payload = renderInBackground
                ? { type: 'render_video', payload: { backgroundPath: backgroundItem?.id || backgroundPath, audioPath, lines: lines.split('\n').filter(l => l.trim()), durationSec: 20 } }
                : { backgroundPath: backgroundItem?.id || backgroundPath, audioPath, lines: lines.split('\n').filter(l => l.trim()), durationSec: 20 };

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
                                    <div className="relative aspect-[9/16] bg-black rounded-xl overflow-hidden group">
                                        <img src={backgroundItem.image} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" alt="" />
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
                                    Audio Source (required for waveform)
                                </label>
                                <Input
                                    value={audioPath}
                                    onChange={(e) => setAudioPath(e.target.value)}
                                    placeholder="e.g. server/outputs/tts-xyz.mp3"
                                    className="bg-black/20"
                                />
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

                    <Button
                        onClick={handleRenderVideo}
                        isLoading={isRendering}
                        className="w-full h-12 text-md"
                    >
                        <Video size={18} className="mr-2" />
                        {renderInBackground ? 'Queue Render Job' : 'Start Instant Render'}
                    </Button>
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
                                const fileName = result.file.split(/[\\/]/).pop() || result.file;
                                window.open(`${api.baseUrl}/outputs/${fileName}`, '_blank');
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

            {/* Library Picker Modal */}
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
        </div>
    );
}
