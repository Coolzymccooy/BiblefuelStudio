import { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { api } from '../lib/api';
import { RefreshCw, Download, Clock, Terminal, PlayCircle, ExternalLink } from 'lucide-react';
import { loadJson, STORAGE_KEYS } from '../lib/storage';

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

export function JobsPage() {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedJob, setSelectedJob] = useState<Job | null>(null);
    const [isTriggering, setIsTriggering] = useState(false);

    const loadJobs = async (showLoading = false) => {
        if (showLoading) setIsLoading(true);
        try {
            const response = await api.get('/api/jobs');
            if (response.ok && response.data?.jobs) {
                setJobs(response.data.jobs);
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
        const fileName = filePath.split(/[\\/]/).pop() || filePath;
        window.open(`${api.baseUrl}/outputs/${fileName}`, '_blank');
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
            const audioPath = audioHistory[0]?.path || 'outputs/test.wav';
            const payload = {
                type: 'render_video',
                payload: {
                    backgroundPath: item.id,
                    audioPath,
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
                <div>
                    <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 mb-2 text-white">Background Jobs</h2>
                    <p className="text-gray-400">Track rendering and background processes.</p>
                </div>
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
                        {jobs.map((job) => (
                            <div
                                key={job.id}
                                className="bg-dark-900/40 border border-white/5 rounded-xl p-4 hover:border-white/10 hover:bg-dark-900/60 transition-all cursor-pointer group"
                                onClick={() => setSelectedJob(selectedJob?.id === job.id ? null : job)}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-2">
                                            <Badge variant={getStatusVariant(job.status)} className="uppercase text-[10px] tracking-wider font-bold">
                                                {job.status}
                                            </Badge>
                                            <span className="font-semibold text-gray-200">{job.type}</span>
                                            <span className="text-xs text-gray-500 font-mono">#{job.id.slice(0, 8)}</span>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-gray-400">
                                            <div className="flex items-center gap-1">
                                                <Clock size={12} />
                                                {new Date(job.createdAt).toLocaleString()}
                                            </div>
                                            {job.finishedAt && (
                                                <div className="text-emerald-400/80 font-medium">
                                                    Duration: {Math.round((new Date(job.finishedAt).getTime() - (job.startedAt ? new Date(job.startedAt).getTime() : new Date(job.createdAt).getTime())) / 1000)}s
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex flex-col items-end gap-2">
                                        <div className="flex items-center gap-3">
                                            {job.status === 'running' && (
                                                <div className="flex items-center gap-2">
                                                    <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                                                        <div
                                                            className="h-full bg-primary-500 shadow-[0_0_10px_rgba(var(--primary-500-rgb),0.5)] transition-all duration-500"
                                                            style={{ width: `${job.progress || 0}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-[10px] font-bold text-primary-400 font-mono">{job.progress || 0}%</span>
                                                </div>
                                            )}

                                            {job.status === 'done' && job.result?.outFile && (
                                                <div className="flex gap-2">
                                                    <Button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleOpen(job.result!.outFile!);
                                                        }}
                                                        className="text-xs px-3 py-1 bg-white/10 hover:bg-white/20 text-white border-white/10 h-auto"
                                                    >
                                                        <ExternalLink size={14} className="mr-1.5" />
                                                        Play
                                                    </Button>
                                                    <Button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDownload(job.result!.outFile!);
                                                        }}
                                                        className="text-xs px-3 py-1 bg-primary-500/10 hover:bg-primary-500/20 text-primary-400 border-primary-500/20 h-auto"
                                                    >
                                                        <Download size={14} className="mr-1.5" />
                                                        Download
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                        {job.status === 'running' && (
                                            <span className="text-[10px] text-primary-400/50 uppercase tracking-widest font-bold animate-pulse">Processing...</span>
                                        )}
                                    </div>
                                </div>

                                {selectedJob?.id === job.id && (
                                    <div className="mt-4 pt-4 border-t border-white/5 animate-in slide-in-from-top-2 duration-200">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                                            {job.payload && (
                                                <div className="space-y-2">
                                                    <span className="font-semibold text-gray-400">Payload:</span>
                                                    <pre className="bg-black/30 p-3 rounded-lg overflow-auto border border-white/5 font-mono text-gray-300 max-h-40 custom-scrollbar">
                                                        {JSON.stringify(job.payload, null, 2)}
                                                    </pre>
                                                </div>
                                            )}
                                            {(job.result || job.error) && (
                                                <div className="space-y-2">
                                                    <span className={`font-semibold ${job.error ? 'text-red-400' : 'text-emerald-400'}`}>
                                                        {job.error ? 'Error Log:' : 'Result Output:'}
                                                    </span>
                                                    <pre className={`p-3 rounded-lg overflow-auto border font-mono max-h-40 custom-scrollbar ${job.error
                                                        ? 'bg-red-500/5 border-red-500/20 text-red-300'
                                                        : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
                                                        }`}>
                                                        {job.error || JSON.stringify(job.result, null, 2)}
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
}
