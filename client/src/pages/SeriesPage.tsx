/**
 * Series Mode — turn one Bible chapter into a sequenced set of micro-videos.
 *
 * Flow:
 *  1. User enters chapter reference + part count + translation
 *  2. Click "Preview" → server returns the verse partition + captions
 *  3. Review segments inline; if happy, click "Generate" → enqueues one
 *     campaign_auto_post job per segment. Jobs render + publish sequentially
 *     through the existing pipeline.
 *  4. "Your series" list at the bottom shows past series with job ids.
 */

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Play, Hash, ListOrdered, BookOpen, RefreshCw, Image as ImageIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { BibleVerseLookup } from '../components/BibleVerseLookup';
import {
    bibleApi,
    seriesApi,
    type TranslationsResponse,
    type SeriesPlan,
    type SeriesRecord,
} from '../lib/bibleApi';

const PART_COUNT_OPTIONS = [3, 4, 5, 6, 7, 8, 10, 12];

export function SeriesPage() {
    const navigate = useNavigate();
    const [reference, setReference] = useState('John 3');
    const [parts, setParts] = useState(5);
    const [translation, setTranslation] = useState('kjv');
    const [destination, setDestination] = useState<'webhook' | 'buffer' | 'youtube'>('webhook');
    const [titlePrefix, setTitlePrefix] = useState('');
    const [niche, setNiche] = useState('');
    const [tone, setTone] = useState('');
    const [aspect, setAspect] = useState<'portrait' | 'square' | 'landscape'>('portrait');
    const [durationSec, setDurationSec] = useState(22);
    const [useGenImage, setUseGenImage] = useState(false);

    const [catalog, setCatalog] = useState<TranslationsResponse | null>(null);
    const [plan, setPlan] = useState<SeriesPlan | null>(null);
    const [history, setHistory] = useState<SeriesRecord[]>([]);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    useEffect(() => {
        bibleApi.listTranslations().then(setCatalog).catch(() => setCatalog(null));
        seriesApi.list(20).then(({ series }) => setHistory(series)).catch(() => setHistory([]));
    }, []);

    const sortedTranslations = useMemo(() => {
        if (!catalog?.translations) return [];
        return [...catalog.translations].sort((a, b) => {
            if (a.requiresApiKey === b.requiresApiKey) return a.code.localeCompare(b.code);
            return a.requiresApiKey ? 1 : -1;
        });
    }, [catalog]);

    const handlePreview = async () => {
        if (!reference.trim()) {
            toast.error('Enter a chapter reference, e.g. "John 3"');
            return;
        }
        setIsPreviewLoading(true);
        try {
            const result = await seriesApi.preview({
                reference: reference.trim(),
                parts,
                translation,
            });
            setPlan(result.plan);
            toast.success(`Previewing ${result.plan.totalParts} segments`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Preview failed');
            setPlan(null);
        } finally {
            setIsPreviewLoading(false);
        }
    };

    const handleGenerate = async () => {
        if (!plan) {
            toast.error('Preview a series first');
            return;
        }
        setIsGenerating(true);
        try {
            const result = await seriesApi.generate({
                reference: reference.trim(),
                parts,
                translation,
                destination,
                titlePrefix: titlePrefix.trim() || undefined,
                niche: niche.trim() || undefined,
                tone: tone.trim() || undefined,
                aspect,
                durationSec,
                useGenImage,
            });
            toast.success(`Series queued — ${result.jobIds.length} videos`);
            if (result.imageGen?.requested && Array.isArray(result.imageGen.results)) {
                const failed = result.imageGen.results.filter((r) => !r.ok);
                if (failed.length === 0) {
                    toast.success(`AI artwork: ${result.imageGen.results.length} images generated`);
                } else {
                    toast(
                        `AI artwork: ${result.imageGen.results.length - failed.length}/${result.imageGen.results.length} generated; ${failed.length} fell back to Pexels`,
                        { icon: '⚠️' },
                    );
                }
            }
            setHistory((prev) => [result.series, ...prev]);
            setTimeout(() => navigate('/app/jobs'), 1200);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Generate failed');
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="space-y-6">
            <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-white">Series Mode</h1>
                    <p className="text-sm text-gray-400">
                        Turn one Bible chapter into a sequenced set of short-form videos with continuity hooks
                        and YouVersion deep links.
                    </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <ListOrdered size={14} />
                    Each part is one auto-publish job.
                </div>
            </header>

            <Card title="Build a series" icon={Sparkles}>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                    <label className="lg:col-span-2 flex flex-col gap-1.5">
                        <span className="text-xs uppercase tracking-wider text-gray-400">Chapter reference</span>
                        <Input
                            value={reference}
                            onChange={(e) => setReference(e.target.value)}
                            placeholder='e.g. "John 3", "Romans 8", "Psalms 23"'
                        />
                    </label>
                    <label className="flex flex-col gap-1.5">
                        <span className="text-xs uppercase tracking-wider text-gray-400">Parts</span>
                        <Select value={parts} onChange={(e) => setParts(Number(e.target.value))}>
                            {PART_COUNT_OPTIONS.map((n) => (
                                <option key={n} value={n}>
                                    {n} videos
                                </option>
                            ))}
                        </Select>
                    </label>
                    <label className="flex flex-col gap-1.5">
                        <span className="text-xs uppercase tracking-wider text-gray-400">Translation</span>
                        <Select value={translation} onChange={(e) => setTranslation(e.target.value)}>
                            {sortedTranslations.length === 0 ? (
                                <option value="kjv">KJV — King James</option>
                            ) : (
                                sortedTranslations.map((t) => (
                                    <option key={t.code} value={t.code}>
                                        {t.code.toUpperCase()} — {t.label}
                                        {t.requiresApiKey && !catalog?.apiBibleConfigured ? ' (key required)' : ''}
                                    </option>
                                ))
                            )}
                        </Select>
                    </label>
                </div>

                <details className="mt-4 group">
                    <summary className="cursor-pointer text-sm text-gray-400 hover:text-gray-200 select-none">
                        Publish &amp; render options
                    </summary>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
                        <label className="flex flex-col gap-1.5">
                            <span className="text-xs uppercase tracking-wider text-gray-400">Destination</span>
                            <Select value={destination} onChange={(e) => setDestination(e.target.value as 'webhook' | 'buffer' | 'youtube')}>
                                <option value="webhook">Make webhook (default funnel)</option>
                                <option value="buffer">Buffer</option>
                                <option value="youtube">YouTube direct</option>
                            </Select>
                        </label>
                        <label className="flex flex-col gap-1.5">
                            <span className="text-xs uppercase tracking-wider text-gray-400">Aspect</span>
                            <Select value={aspect} onChange={(e) => setAspect(e.target.value as 'portrait' | 'square' | 'landscape')}>
                                <option value="portrait">Portrait (9:16)</option>
                                <option value="square">Square (1:1)</option>
                                <option value="landscape">Landscape (16:9)</option>
                            </Select>
                        </label>
                        <label className="flex flex-col gap-1.5">
                            <span className="text-xs uppercase tracking-wider text-gray-400">Duration (sec)</span>
                            <Input
                                type="number"
                                min={8}
                                max={60}
                                value={durationSec}
                                onChange={(e) => setDurationSec(Math.min(60, Math.max(8, Number(e.target.value) || 22)))}
                            />
                        </label>
                        <label className="flex flex-col gap-1.5 lg:col-span-2">
                            <span className="text-xs uppercase tracking-wider text-gray-400">Title prefix (optional)</span>
                            <Input
                                value={titlePrefix}
                                onChange={(e) => setTitlePrefix(e.target.value)}
                                placeholder="e.g. 'John 3 Deep Dive'"
                            />
                        </label>
                        <label className="flex flex-col gap-1.5">
                            <span className="text-xs uppercase tracking-wider text-gray-400">Tone (optional)</span>
                            <Input
                                value={tone}
                                onChange={(e) => setTone(e.target.value)}
                                placeholder="warm, encouraging"
                            />
                        </label>
                        <label className="flex flex-col gap-1.5 lg:col-span-3">
                            <span className="text-xs uppercase tracking-wider text-gray-400">Niche (optional)</span>
                            <Input
                                value={niche}
                                onChange={(e) => setNiche(e.target.value)}
                                placeholder="Christian / Bible encouragement"
                            />
                        </label>

                        <label className="lg:col-span-3 flex items-start gap-3 rounded-lg border border-white/5 bg-dark-900/40 p-3 cursor-pointer hover:bg-dark-900/60 transition-colors">
                            <input
                                type="checkbox"
                                checked={useGenImage}
                                onChange={(e) => setUseGenImage(e.target.checked)}
                                className="mt-1 accent-primary-500"
                            />
                            <div className="flex-1">
                                <div className="flex items-center gap-2 text-sm text-gray-200">
                                    <ImageIcon size={14} className="text-primary-400" />
                                    Add AI-generated artwork (free)
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                    Generates one painterly Bible landscape per part using Cloudflare Workers AI
                                    (free tier) with Google Imagen as fallback. Same visual style across every part
                                    of the series. No biblical figures are depicted — landscapes and symbolic
                                    imagery only. Adds ~5–15s per part during generate.
                                </p>
                            </div>
                        </label>
                    </div>
                </details>

                <div className="flex flex-col sm:flex-row gap-2 mt-4">
                    <Button onClick={handlePreview} isLoading={isPreviewLoading} variant="secondary">
                        Preview segments
                    </Button>
                    <Button onClick={handleGenerate} isLoading={isGenerating} disabled={!plan}>
                        <Play size={16} />
                        Generate {plan ? `${plan.totalParts} videos` : 'series'}
                    </Button>
                </div>
            </Card>

            {plan && (
                <Card title={`Preview — ${plan.chapterReference}`} icon={Hash}>
                    <div className="text-xs uppercase tracking-wider text-gray-500 mb-3">
                        {plan.totalParts} parts · {plan.translation.toUpperCase()}
                    </div>
                    <ol className="space-y-4">
                        {plan.segments.map((seg) => (
                            <li
                                key={seg.partNumber}
                                className="rounded-xl border border-white/5 bg-dark-900/40 p-4"
                            >
                                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                                    <div className="font-semibold text-primary-200">
                                        Part {seg.partNumber} of {seg.totalParts}
                                    </div>
                                    <div className="text-xs text-gray-400">{seg.reference}</div>
                                </div>
                                {seg.hook && (
                                    <p className="text-sm text-gray-300 italic mb-2">&ldquo;{seg.hook}&rdquo;</p>
                                )}
                                <pre className="whitespace-pre-wrap text-xs text-gray-300 leading-relaxed bg-black/30 rounded-lg p-3 max-h-44 overflow-y-auto">
                                    {seg.caption}
                                </pre>
                                <a
                                    href={seg.youVersionUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 mt-2"
                                >
                                    Verify on YouVersion ↗
                                </a>
                            </li>
                        ))}
                    </ol>
                </Card>
            )}

            <BibleVerseLookup />

            <Card title="Recent series" icon={RefreshCw}>
                {history.length === 0 ? (
                    <p className="text-sm text-gray-500">No series generated yet.</p>
                ) : (
                    <ul className="space-y-2">
                        {history.map((row) => (
                            <li
                                key={row.seriesId}
                                className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-dark-900/40 px-3 py-2 text-sm"
                            >
                                <div>
                                    <div className="text-gray-200">
                                        {row.chapterReference}
                                        <span className="text-gray-500 ml-2">
                                            · {row.totalParts} parts · {row.translation.toUpperCase()}
                                        </span>
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {new Date(row.createdAt).toLocaleString()} · {row.jobIds.length} jobs
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => navigate('/app/jobs')}
                                    className="text-xs text-primary-400 hover:text-primary-300"
                                >
                                    View jobs →
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            <div className="text-xs text-gray-500 flex items-center gap-1.5">
                <BookOpen size={12} />
                Verse text is fetched from api.bible (copyrighted) or bible-api.com (public domain) and cached.
            </div>
        </div>
    );
}
