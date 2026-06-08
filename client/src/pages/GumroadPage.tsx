import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { parseFreeDevotional, extractTranscript } from '../lib/gumroadToTimeline';
import { saveJson, STORAGE_KEYS } from '../lib/storage';

/**
 * Read an audio file's duration (seconds) by loading its metadata in a detached
 * <Audio> element. Resolves 0 if the metadata can't be read, in which case the
 * caller falls back to a rate-based estimate.
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
    const [isSending, setIsSending] = useState(false);
    const navigate = useNavigate();

    // Server-side gate (featureGate('gumroad')) already 403s non-super-admin
    // calls. Mirror that here so a direct URL hit doesn't show a broken page.
    if (isLoading) return <div className="text-gray-400 text-sm">Checking access…</div>;
    if (!isSuperAdmin) return <Navigate to="/app" replace />;

    const handleGenerate = async () => {
        setIsGenerating(true);
        try {
            const response = await api.post('/api/gumroad/generate', {
                freeTitle,
                paidTitle,
            });

            if (response.ok && response.data) {
                setResult(response.data);
                toast.success('Generated Gumroad packs!');
            } else {
                toast.error(response.error || 'Generation failed');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDownloadZip = () => {
        api.download('/api/gumroad/download.zip');
    };

    const sendToTimeline = async () => {
        if (!result?.freeMarkdown) return;
        const { narrationText, lines } = parseFreeDevotional(result.freeMarkdown);
        if (!narrationText) {
            toast.error('Nothing to narrate in the free devotional');
            return;
        }
        setIsSending(true);
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

            // Seed the Timeline (Sermon Clip Studio) state. Clearing the Main
            // Assembly clips is REQUIRED: Timeline reads clips[0] as a render
            // trim, so a stale clip would silently crop our narration.
            saveJson(STORAGE_KEYS.timelineClips, []);
            saveJson(STORAGE_KEYS.sclSourcePath, file);
            saveJson(STORAGE_KEYS.sclSourceKind, 'audio');
            saveJson(STORAGE_KEYS.sclTranscript, transcript);
            saveJson(STORAGE_KEYS.sclEditedLines, lines);

            toast.success('Sent to Timeline — pick a background and render', { id: toastId });
            navigate('/app/timeline');
        } catch {
            toast.error('Narration failed', { id: toastId });
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Gumroad Pack Builder</h2>

            <Card title="Configuration">
                <p className="text-sm text-gray-600 mb-4">
                    Generates Markdown you can paste into Gumroad, and a ZIP you can upload.
                </p>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Lead magnet title
                        </label>
                        <Input
                            value={freeTitle}
                            onChange={(e) => setFreeTitle(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Paid product title
                        </label>
                        <Input
                            value={paidTitle}
                            onChange={(e) => setPaidTitle(e.target.value)}
                        />
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

            {result && (
                <div className="mt-6 space-y-4">
                    {result.freeMarkdown && (
                        <Card title="Free product (Markdown)">
                            <pre className="bg-black/30 border border-white/10 text-gray-200 p-4 rounded overflow-auto text-sm whitespace-pre-wrap">
                                {result.freeMarkdown}
                            </pre>
                            <div className="mt-3">
                                <Button
                                    onClick={sendToTimeline}
                                    isLoading={isSending}
                                    className="w-full sm:w-auto"
                                >
                                    Send to Timeline
                                </Button>
                                <p className="text-xs text-gray-500 mt-2">
                                    Narrates this devotional and opens the Timeline editor — pick a
                                    background and render a captioned video.
                                </p>
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
