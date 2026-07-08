import { useState, useEffect, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { parseFreeDevotionalDays, extractTranscript, type DevotionalDay } from '../lib/gumroadToTimeline';
import { saveJson, STORAGE_KEYS } from '../lib/storage';

interface GumroadRecord {
    id: string;
    userId?: string;
    freeTitle: string;
    paidTitle: string;
    freeMarkdown: string;
    paidMarkdown: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Read an audio file's duration (seconds) via a detached <Audio> element.
 * Resolves 0 if metadata can't be read (caller falls back to a rate estimate).
 */
function getAudioDurationSec(url: string): Promise<number> {
    return new Promise((resolve) => {
        const audio = new Audio();
        audio.preload = 'metadata';
        const finish = (v: number) => resolve(Number.isFinite(v) && v > 0 ? v : 0);
        audio.onloadedmetadata = () => finish(audio.duration);
        audio.onerror = () => finish(0);
        audio.src = url;
    });
}

export function GumroadPage() {
    const { isSuperAdmin, isLoading } = useAuth();
    const [freeTitle, setFreeTitle] = useState('7 Bible Verses for Anxiety & Fear (With Reflections & Prayers)');
    const [paidTitle, setPaidTitle] = useState('Biblefuel: 30 Days of Strength, Peace & Faith');
    const [result, setResult] = useState<{ freeMarkdown?: string; paidMarkdown?: string } | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [sendingDay, setSendingDay] = useState<number | null>(null);
    const [history, setHistory] = useState<GumroadRecord[]>([]);
    const navigate = useNavigate();

    const fetchHistory = useCallback(async () => {
        const res = await api.get('/api/gumroad/history?limit=50');
        if (res.ok && Array.isArray(res.data?.items)) setHistory(res.data.items as GumroadRecord[]);
    }, []);

    useEffect(() => { void fetchHistory(); }, [fetchHistory]);

    // Server-side gate (featureGate('gumroad')) already 403s non-super-admin
    // calls. Mirror that here so a direct URL hit doesn't show a broken page.
    if (isLoading) return <div className="text-gray-400 text-sm">Checking access…</div>;
    if (!isSuperAdmin) return <Navigate to="/app" replace />;

    const handleGenerate = async () => {
        setIsGenerating(true);
        try {
            const response = await api.post('/api/gumroad/generate', { freeTitle, paidTitle });
            if (response.ok && response.data) {
                setResult(response.data);
                toast.success('Generated Gumroad packs!');
                void fetchHistory();
            } else {
                toast.error(response.error || 'Generation failed');
            }
        } catch {
            toast.error('An error occurred');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDownloadZip = () => { api.download('/api/gumroad/download.zip'); };

    /** Narrate the given text and drop the user into the Timeline, render-ready. */
    const narrateAndSendToTimeline = async (narrationText: string, lines: string[]) => {
        if (!narrationText) { toast.error('Nothing to narrate in this day'); return; }
        const toastId = toast.loading('Narrating devotional…');
        try {
            const response = await api.post('/api/tts/synthesize-category', {
                text: narrationText,
                category: 'devotional',
                withTimestamps: true,
            });
            if (!response.ok || !response.data?.file) {
                toast.error(response.error || 'Narration failed', { id: toastId });
                return;
            }
            const file = response.data.file as string;
            const durationSec = await getAudioDurationSec(api.mediaUrl(file));
            const transcript = extractTranscript(response.data, narrationText, durationSec);

            // Clearing the Main Assembly clips is REQUIRED: Timeline reads clips[0]
            // as a render trim, so a stale clip would silently crop our narration.
            saveJson(STORAGE_KEYS.timelineClips, []);
            saveJson(STORAGE_KEYS.sclSourcePath, file);
            saveJson(STORAGE_KEYS.sclSourceKind, 'audio');
            saveJson(STORAGE_KEYS.sclTranscript, transcript);
            saveJson(STORAGE_KEYS.sclEditedLines, lines);

            toast.success('Sent to Timeline — pick a background and render', { id: toastId });
            navigate('/app/timeline');
        } catch {
            toast.error('Narration failed', { id: toastId });
        }
    };

    const sendDay = async (day: DevotionalDay) => {
        setSendingDay(day.dayNumber);
        try {
            await narrateAndSendToTimeline(day.narrationText, day.lines);
        } finally {
            setSendingDay(null);
        }
    };

    const loadPack = (rec: GumroadRecord) => {
        setFreeTitle(rec.freeTitle);
        setPaidTitle(rec.paidTitle);
        setResult({ freeMarkdown: rec.freeMarkdown, paidMarkdown: rec.paidMarkdown });
        toast.success('Loaded saved pack');
    };

    const deletePack = async (id: string) => {
        const res = await api.delete(`/api/gumroad/history/${encodeURIComponent(id)}`);
        if (res.ok) { toast.success('Deleted'); void fetchHistory(); }
        else toast.error(res.error || 'Delete failed');
    };

    const days: DevotionalDay[] = result?.freeMarkdown ? parseFreeDevotionalDays(result.freeMarkdown) : [];

    return (
        <div>
            <ScreenHeader eyebrow="Gumroad" title={<>Package the <em>work</em>.</>} className="mb-6" />

            <Card title="Configuration">
                <p className="text-sm text-gray-600 mb-4">
                    Generates Markdown you can paste into Gumroad, and a ZIP you can upload.
                </p>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Lead magnet title</label>
                        <Input value={freeTitle} onChange={(e) => setFreeTitle(e.target.value)} />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Paid product title</label>
                        <Input value={paidTitle} onChange={(e) => setPaidTitle(e.target.value)} />
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Button onClick={handleGenerate} isLoading={isGenerating} className="w-full sm:w-auto">
                            Generate
                        </Button>
                        <Button onClick={handleDownloadZip} variant="secondary" className="w-full sm:w-auto">
                            Download ZIP
                        </Button>
                    </div>
                </div>
            </Card>

            {history.length > 0 && (
                <Card title="History" className="mt-6">
                    <p className="text-xs text-gray-500 mb-3">Previously generated packs — open to revisit, or delete.</p>
                    <div className="space-y-2">
                        {history.map((h) => (
                            <div key={h.id} className="flex items-center justify-between gap-3 bg-black/20 border border-white/10 rounded-lg px-3 py-2">
                                <div className="min-w-0">
                                    <p className="text-sm text-gray-200 truncate">{h.freeTitle}</p>
                                    <p className="text-xs text-gray-500">{new Date(h.updatedAt || h.createdAt).toLocaleString()}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <Button onClick={() => loadPack(h)} className="text-xs h-8">Open</Button>
                                    <Button onClick={() => deletePack(h.id)} variant="secondary" className="text-xs h-8">Delete</Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {result && (
                <div className="mt-6 space-y-4">
                    {result.freeMarkdown && (
                        <Card title="Free product (Markdown)">
                            <pre className="bg-black/30 border border-white/10 text-gray-200 p-4 rounded overflow-auto text-sm whitespace-pre-wrap">
                                {result.freeMarkdown}
                            </pre>
                            <div className="mt-4 space-y-2">
                                <p className="text-xs text-gray-400">
                                    Send a day to the Timeline — narrates that day and opens the editor to render a captioned video.
                                </p>
                                {days.map((d) => (
                                    <div key={d.dayNumber} className="flex items-center justify-between gap-3 bg-black/20 border border-white/10 rounded-lg px-3 py-2">
                                        <span className="text-sm text-gray-200">Day {d.dayNumber} · {d.reference}</span>
                                        <Button
                                            onClick={() => sendDay(d)}
                                            isLoading={sendingDay === d.dayNumber}
                                            disabled={sendingDay !== null}
                                            className="text-xs h-8 shrink-0"
                                        >
                                            Send to Timeline
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}

                    {result.paidMarkdown && (
                        <Card title="Paid product (Markdown)">
                            <pre className="bg-black/30 border border-white/10 text-gray-200 p-4 rounded overflow-auto text-sm whitespace-pre-wrap">
                                {result.paidMarkdown}
                            </pre>
                        </Card>
                    )}
                </div>
            )}
        </div>
    );
}
