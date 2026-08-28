import { useState, useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { api } from '../lib/api';
import { RefreshCw, Download, Clock, Terminal, PlayCircle, ExternalLink, BookOpen, Wand2, Film, AudioLines, Share2, X as XIcon, RotateCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { loadJson, STORAGE_KEYS, toOutputUrl } from '../lib/storage';
import { ShareSheet } from '../components/ShareSheet';

interface Job {
    id: string;
    type: string;
    status: 'queued' | 'running' | 'done' | 'failed';
    payload?: any;
    result?: { outFile?: string;[key: string]: any };
    error?: string;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    progress?: number;
}

interface JobIdentifier {
    primary: string;
    kind: 'series' | 'campaign' | 'render' | 'waveform' | 'other';
    kindLabel: string;
    chips: Array<{ text: string; tone: 'primary' | 'neutral' }>;
    KindIcon: ComponentType<{ size?: number; className?: string }>;
}

/**
 * The job's `type` field (e.g. `campaign_auto_post`) is the engine that ran,
 * not WHAT was rendered. This helper extracts the meaningful payload bits
 * so the Jobs list can show "John 3 — Part 1/3" instead of opaque type names.
 *
 * Order of precedence per job kind:
 *   - Series:   `payload.series.{partNumber,totalParts,reference}` + `payload.title`
 *   - Campaign: `payload.title` → script hook → niche → fallback
 *   - Render:   `payload.title` → first caption line → fallback
 */
function getJobIdentifier(job: Job): JobIdentifier {
    const p = (job.payload || {}) as Record<string, any>;
    const title = String(p.title || '').trim();

    if (p.series && typeof p.series === 'object') {
        const s = p.series as { partNumber?: number; totalParts?: number; reference?: string; chapterReference?: string };
        const partChip = `Part ${s.partNumber ?? '?'}/${s.totalParts ?? '?'}`;
        const ref = s.reference || s.chapterReference || 'Series';
        return {
            primary: title || `${ref} — ${partChip}`,
            kind: 'series',
            kindLabel: 'Series',
            chips: [
                { text: partChip, tone: 'primary' },
                { text: ref, tone: 'neutral' },
            ],
            KindIcon: BookOpen,
        };
    }

    if (job.type === 'campaign_auto_post') {
        const niche = String(p.niche || '').trim();
        const hook = String(p.prebuiltScript?.hook || '').trim();
        return {
            primary: title || hook || niche || 'Auto-generated post',
            kind: 'campaign',
            kindLabel: 'Auto-Post',
            chips: niche ? [{ text: niche, tone: 'neutral' }] : [],
            KindIcon: Wand2,
        };
    }

    if (job.type === 'render_video') {
        const firstLine = Array.isArray(p.lines) ? String(p.lines[0] || '').trim() : '';
        return {
            primary: title || firstLine || 'Manual render',
            kind: 'render',
            kindLabel: 'Manual',
            chips: p.aspect ? [{ text: String(p.aspect), tone: 'neutral' }] : [],
            KindIcon: Film,
        };
    }

    if (job.type === 'render_waveform') {
        return {
            primary: title || 'Audio waveform',
            kind: 'waveform',
            kindLabel: 'Waveform',
            chips: [],
            KindIcon: AudioLines,
        };
    }

    return {
        primary: title || job.type,
        kind: 'other',
        kindLabel: job.type,
        chips: [],
        KindIcon: Terminal,
    };
}

export function JobsPage() {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedJob, setSelectedJob] = useState<Job | null>(null);
    const [isTriggering, setIsTriggering] = useState(false);
    const [shareJob, setShareJob] = useState<Job | null>(null);
    // Per-job retry-in-flight gate. Clicking Retry posts to /:id/retry
    // which creates a new queued job; we lock the source row's button
    // while the request is in-flight so a frantic double-click doesn't
    // enqueue the same payload twice.
    const [retryingJobIds, setRetryingJobIds] = useState<Set<string>>(new Set());
    const transientEmptyCountRef = useRef(0);
    const jobsRef = useRef<Job[]>([]);

    useEffect(() => {
        jobsRef.current = jobs;
    }, [jobs]);

    const loadJobs = async (showLoading = false) => {
        if (showLoading) setIsLoading(true);
        try {
            const response = await api.get('/api/jobs');
            if (response.ok && response.data?.jobs) {
                const incoming = response.data.jobs as Job[];
                const previous = jobsRef.current;
                const hadActiveJobs = previous.some((j) => j.status === 'queued' || j.status === 'running');

                if (incoming.length === 0 && hadActiveJobs) {
                    transientEmptyCountRef.current += 1;
                    // Keep current list while active jobs exist to avoid UI drops
                    // when backend storage has a transient read issue.
                    return;
                } else {
                    transientEmptyCountRef.current = 0;
                }

                setJobs(incoming);
            }
        } catch (error) {
            console.error("Failed to refresh jobs", error);
        } finally {
            if (showLoading) setIsLoading(false);
        }
    };

    useEffect(() => {
        loadJobs(true);

        const interval = setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            loadJobs(false);
        }, 5000);

        return () => clearInterval(interval);
    }, []);

    const handleRefresh = async () => {
        await loadJobs(true);
    };

    const getStatusVariant = (status: string): 'default' | 'warning' | 'success' | 'danger' => {
        switch (status) {
            case 'done':
                return 'success';
            case 'running':
                return 'warning';
            case 'failed':
                return 'danger';
            default:
                return 'default';
        }
    };

    const handleDownload = (filePath: string) => {
        const fileName = filePath.split(/[\\/]/).pop() || filePath;
        api.download(`/outputs/${fileName}`);
    };

    const handleOpen = (filePath: string) => {
        // Media origin (bypasses Cloudflare) so iOS can actually play the
        // opened video/audio via byte-range; see api.mediaUrl.
        window.open(api.mediaUrl(filePath), '_blank');
    };

    const handleRetry = async (jobId: string) => {
        if (retryingJobIds.has(jobId)) return;
        setRetryingJobIds((prev) => {
            const next = new Set(prev);
            next.add(jobId);
            return next;
        });
        try {
            const res = await api.post(`/api/jobs/${encodeURIComponent(jobId)}/retry`);
            if (res.ok && res.data?.job?.id) {
                toast.success(`Retry queued: #${String(res.data.job.id).slice(4, 12)}`);
                await loadJobs(false);
            } else {
                toast.error(res.error || 'Failed to enqueue retry');
            }
        } catch (err) {
            toast.error('Retry request failed');
        } finally {
            setRetryingJobIds((prev) => {
                const next = new Set(prev);
                next.delete(jobId);
                return next;
            });
        }
    };

    const triggerTestJob = async () => {
        setIsTriggering(true);
        try {
            const library = await api.get('/api/library');
            const item = library.ok ? library.data?.library?.items?.[0] : null;
            if (!item?.id) {
                alert('Library is empty. Add a background first.');
                return;
            }

            const audioHistory = loadJson<any[]>(STORAGE_KEYS.audioHistory, []);
            const audioPath = audioHistory[0]?.path || '';
            const payload = {
                type: 'render_video',
                payload: {
                    backgroundPath: item.id,
                    ...(audioPath ? { audioPath } : {}),
                    lines: [
                        'Test render job',
                        'Psalm 34:18',
                        'God is near.',
                        'Auto-generated',
                    ],
                    durationSec: 20,
                },
            };

            const res = await api.post('/api/jobs/enqueue', payload);
            if (res.ok) {
                alert('Test job enqueued. Check status below.');
                await loadJobs(true);
            } else {
                alert(res.error || 'Failed to enqueue test job');
            }
        } finally {
            setIsTriggering(false);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <ScreenHeader eyebrow="Jobs" title={<>What the studio<br />is <em>making</em>.</>} subtitle="Track rendering and background processes." />

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <Button onClick={triggerTestJob} isLoading={isTriggering} variant="secondary" className="w-full sm:w-auto">
                        <PlayCircle size={16} className="mr-2" />
                        Trigger Test Job
                    </Button>
                    <Button onClick={handleRefresh} isLoading={isLoading} className="w-full sm:w-auto">
                        <RefreshCw size={16} className="mr-2" />
                        Refresh
                    </Button>
                </div>
            </div>

            <Card className="min-h-[500px]">
                {jobs.length === 0 ? (
                    <div className="text-center py-20 text-gray-500">
                        <Terminal size={48} className="mx-auto mb-4 opacity-20" />
                        <p>No jobs in the queue.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {jobs.map((job) => {
                            const ident = getJobIdentifier(job);
                            const KindIcon = ident.KindIcon;
                            return (
                            <div
                                key={job.id}
                                className="bg-dark-900/40 border border-white/5 rounded-xl p-4 hover:border-white/10 hover:bg-dark-900/60 transition-all cursor-pointer group"
                                onClick={() => setSelectedJob(selectedJob?.id === job.id ? null : job)}
                            >
                                {/* Title always gets its own full-width row so it
                                    can wrap properly on mobile. On lg+ the
                                    actions row sits beside the metadata block;
                                    on mobile actions stack underneath. */}
                                <div className="space-y-2">
                                    {/* Title */}
                                    <div className="flex items-start gap-2">
                                        <KindIcon size={16} className="text-primary-300 shrink-0 mt-0.5" />
                                        <span
                                            className="font-semibold text-gray-100 break-words flex-1 min-w-0"
                                            title={ident.primary}
                                        >
                                            {ident.primary}
                                        </span>
                                    </div>

                                    {/* Metadata block + Actions — side-by-side on lg+, stacked on mobile */}
                                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                                        <div className="flex-1 min-w-0 space-y-2">
                                            {/* Status, kind, chips */}
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <Badge variant={getStatusVariant(job.status)} className="text-[0.6875rem] font-semibold uppercase">
                                                    {job.status}
                                                </Badge>
                                                <span className="text-[0.75rem] font-medium text-content-tertiary">
                                                    {ident.kindLabel}
                                                </span>
                                                {ident.chips.map((chip, idx) => (
                                                    <span
                                                        key={`${chip.text}-${idx}`}
                                                        className={`text-[0.6875rem] px-2 py-0.5 rounded-full border ${
                                                            chip.tone === 'primary'
                                                                ? 'bg-primary-500/10 text-primary-300 border-primary-500/20'
                                                                : 'bg-white/5 text-gray-300 border-white/10'
                                                        }`}
                                                    >
                                                        {chip.text}
                                                    </span>
                                                ))}
                                                <span className="text-meta">#{job.id.slice(0, 8)}</span>
                                            </div>
                                            {/* Created + duration */}
                                            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-meta">
                                                <div className="flex items-center gap-1">
                                                    <Clock size={12} />
                                                    {new Date(job.createdAt).toLocaleString()}
                                                </div>
                                                {job.finishedAt && (
                                                    <div className="text-[#7fb5aa]/80 font-medium">
                                                        Duration: {Math.round((new Date(job.finishedAt).getTime() - (job.startedAt ? new Date(job.startedAt).getTime() : new Date(job.createdAt).getTime())) / 1000)}s
                                                    </div>
                                                )}
                                            </div>
                                            {job.status === 'failed' && job.error && (
                                                <details className="text-xs text-red-300/90 leading-snug">
                                                    <summary className="cursor-pointer hover:text-red-200 whitespace-pre-wrap break-words line-clamp-2 list-none">
                                                        {job.error.split('\n')[0]}
                                                        {job.error.includes('\n') && <span className="text-red-300/60 ml-1">(click to expand)</span>}
                                                    </summary>
                                                    <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] bg-black/30 border border-red-500/10 rounded p-2 max-h-48 overflow-y-auto">
                                                        {job.error}
                                                    </pre>
                                                </details>
                                            )}
                                        </div>

                                        {/* Actions column — full-width row on mobile, right-aligned column on lg+ */}
                                        <div className="flex flex-col lg:items-end gap-2 lg:shrink-0">
                                            {job.status === 'running' && (
                                                <div className="flex items-center gap-2">
                                                    <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                                                        <div
                                                            className="h-full bg-primary-500 shadow-[0_0_10px_rgba(var(--primary-500-rgb),0.5)] transition-all duration-500"
                                                            style={{ width: `${job.progress || 0}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-[0.75rem] font-semibold text-primary-400 font-mono tabular-nums">{job.progress || 0}%</span>
                                                </div>
                                            )}

                                            {job.status === 'done' && job.result?.outFile && (
                                                <div className="grid grid-cols-3 gap-2 w-full lg:flex lg:w-auto">
                                                    <Button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleOpen(job.result!.outFile!);
                                                        }}
                                                        className="text-xs px-3 py-1 bg-white/10 hover:bg-white/20 text-white border-white/10 h-auto justify-center"
                                                    >
                                                        <ExternalLink size={14} className="mr-1.5" />
                                                        Play
                                                    </Button>
                                                    <Button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDownload(job.result!.outFile!);
                                                        }}
                                                        className="text-xs px-3 py-1 bg-primary-500/10 hover:bg-primary-500/20 text-primary-400 border-primary-500/20 h-auto justify-center"
                                                    >
                                                        <Download size={14} className="mr-1.5" />
                                                        Download
                                                    </Button>
                                                    <Button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setShareJob(job);
                                                        }}
                                                        className="text-xs px-3 py-1 bg-[#e8f2f0]0/10 hover:bg-[#e8f2f0]0/20 text-[#8fc2b8] border-[#e8f2f0]0/20 h-auto justify-center"
                                                    >
                                                        <Share2 size={14} className="mr-1.5" />
                                                        Share
                                                    </Button>
                                                </div>
                                            )}
                                            {job.status === 'running' && (
                                                <span className="text-[0.75rem] text-primary-400/70 font-medium animate-pulse">Processing…</span>
                                            )}

                                            {(job.status === 'failed' || job.status === 'done') && (
                                                <Button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRetry(job.id);
                                                    }}
                                                    isLoading={retryingJobIds.has(job.id)}
                                                    className={`text-xs px-3 py-1 h-auto justify-center ${
                                                        job.status === 'failed'
                                                            ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/20'
                                                            : 'bg-white/5 hover:bg-white/10 text-gray-300 border-white/10'
                                                    }`}
                                                    title={job.status === 'failed' ? 'Re-enqueue this failed job' : 'Re-run this job with the same payload'}
                                                >
                                                    <RotateCw size={14} className="mr-1.5" />
                                                    {job.status === 'failed' ? 'Retry' : 'Re-run'}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {selectedJob?.id === job.id && (
                                    <div className="mt-4 pt-4 border-t border-white/5 animate-in slide-in-from-top-2 duration-200">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                                            {job.payload && (
                                                <div className="space-y-2">
                                                    <span className="font-semibold text-content-secondary">Payload:</span>
                                                    <pre className="bg-black/30 p-3 rounded-lg overflow-auto border border-white/5 font-mono text-gray-300 max-h-40 custom-scrollbar">
                                                        {JSON.stringify(job.payload, null, 2)}
                                                    </pre>
                                                </div>
                                            )}
                                            {(job.result || job.error) && (
                                                <div className="space-y-2">
                                                    <span className={`font-semibold ${job.error ? 'text-red-400' : 'text-[#7fb5aa]'}`}>
                                                        {job.error ? 'Error Log:' : 'Result Output:'}
                                                    </span>
                                                    <pre className={`p-3 rounded-lg overflow-auto border font-mono max-h-40 custom-scrollbar ${job.error
                                                        ? 'bg-red-500/5 border-red-500/20 text-red-300'
                                                        : 'bg-[#e8f2f0]0/5 border-[#e8f2f0]0/20 text-[#8fc2b8]'
                                                        }`}>
                                                        {job.error || JSON.stringify(job.result, null, 2)}
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                            );
                        })}
                    </div>
                )}
            </Card>

            {shareJob?.result?.outFile && (
                // Scroll the whole overlay (not an inner max-h box) so the share
                // buttons can never be clipped, and pad the bottom on mobile so
                // the last row clears the fixed bottom nav bar.
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShareJob(null)} />
                    <div className="relative flex min-h-full items-start sm:items-center justify-center p-4 pb-28 sm:pb-4">
                        <div className="relative w-full max-w-2xl">
                            <div className="flex items-center justify-between mb-3 px-1">
                                <h3 className="font-bold text-lg text-white">Share your video</h3>
                                <button onClick={() => setShareJob(null)} className="text-gray-400 hover:text-white p-1" aria-label="Close">
                                    <XIcon size={20} />
                                </button>
                            </div>
                            <ShareSheet
                                videoUrl={toOutputUrl(shareJob.result.outFile, api.mediaBaseUrl)}
                                caption={(() => {
                                    const p = (shareJob.payload || {}) as Record<string, any>;
                                    if (Array.isArray(p.lines)) return p.lines.filter(Boolean).join(' ');
                                    if (typeof p.caption === 'string') return p.caption;
                                    return '';
                                })()}
                                title={(() => {
                                    const p = (shareJob.payload || {}) as Record<string, any>;
                                    return String(p.title || '') || (Array.isArray(p.lines) ? String(p.lines[0] || '') : '');
                                })()}
                                filename={`biblefuel-${shareJob.id.slice(0, 8)}`}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
