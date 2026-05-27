import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Bug, X, Loader2, Inbox, Paperclip, ImagePlus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { AuthedImage } from './AuthedImage';

type Severity = 'low' | 'medium' | 'high';
type Tab = 'new' | 'mine';

interface IssueReply {
    id: string;
    at: string;
    byEmail: string;
    byUserId: string;
    isAdmin: boolean;
    body: string;
}

interface IssueAttachment {
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    uploadedAt: string;
}

interface IssueRecord {
    id: string;
    createdAt: string;
    title: string;
    body: string;
    severity: Severity;
    contextPath: string;
    status: 'open' | 'resolved';
    resolvedAt?: string;
    resolutionNote?: string;
    replies?: IssueReply[];
    attachments?: IssueAttachment[];
}

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 3;

interface StagedAttachment {
    originalName: string;
    mimeType: string;
    dataBase64: string;
    previewUrl: string;
    sizeBytes: number;
}

async function fileToStaged(file: File): Promise<StagedAttachment> {
    if (!ALLOWED_TYPES.has(file.type)) {
        throw new Error(`Unsupported file type (${file.type || 'unknown'})`);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(`${file.name} exceeds 5MB`);
    }
    const buf = await file.arrayBuffer();
    // btoa requires a binary string. Build in 32KB chunks to avoid blowing
    // the argument list on larger images.
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
    }
    const dataBase64 = btoa(binary);
    const previewUrl = URL.createObjectURL(file);
    return {
        originalName: file.name,
        mimeType: file.type,
        dataBase64,
        previewUrl,
        sizeBytes: file.size,
    };
}

/**
 * Floating "Report an issue" button visible to any signed-in user. Opens a
 * compact modal with two tabs: file a new report, and see prior reports +
 * admin replies. Reporter identity comes from the JWT, not the form.
 *
 * Mounted in Layout so it's available on every studio page. The current
 * route is auto-captured as `contextPath` to help the operator triage.
 */
export function ReportIssueWidget() {
    const { token } = useAuth();
    const location = useLocation();
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<Tab>('new');
    const [submitting, setSubmitting] = useState(false);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [severity, setSeverity] = useState<Severity>('medium');

    const [mineLoading, setMineLoading] = useState(false);
    const [mine, setMine] = useState<IssueRecord[]>([]);
    const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
    const [replyingId, setReplyingId] = useState<string | null>(null);
    const [staged, setStaged] = useState<StagedAttachment[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadMine = useCallback(async () => {
        setMineLoading(true);
        try {
            const res = await api.get<{ issues: IssueRecord[] }>('/api/issues/mine');
            if (res.ok && res.data?.issues) {
                setMine(res.data.issues);
            } else if (res.error) {
                toast.error(res.error);
            }
        } finally {
            setMineLoading(false);
        }
    }, []);

    // Refresh "My reports" each time that tab is shown so admin replies
    // posted while the modal was closed show up the moment the user looks.
    useEffect(() => {
        if (open && tab === 'mine') loadMine();
    }, [open, tab, loadMine]);

    // Reset form when modal closes so the next open starts fresh. Revoke
    // the object URLs we created for previews so they don't leak.
    useEffect(() => {
        if (!open) {
            setTitle('');
            setBody('');
            setSeverity('medium');
            setTab('new');
            staged.forEach((s) => URL.revokeObjectURL(s.previewUrl));
            setStaged([]);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    if (!token) return null;

    const handleFilesPicked = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const remaining = MAX_ATTACHMENTS - staged.length;
        if (remaining <= 0) {
            toast.error(`At most ${MAX_ATTACHMENTS} images per report`);
            return;
        }
        const picks = Array.from(files).slice(0, remaining);
        const accepted: StagedAttachment[] = [];
        for (const f of picks) {
            try {
                accepted.push(await fileToStaged(f));
            } catch (e) {
                toast.error((e as Error).message);
            }
        }
        if (accepted.length) setStaged((prev) => [...prev, ...accepted]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const removeStaged = (idx: number) => {
        setStaged((prev) => {
            const next = [...prev];
            const [removed] = next.splice(idx, 1);
            if (removed) URL.revokeObjectURL(removed.previewUrl);
            return next;
        });
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const t = title.trim();
        const b = body.trim();
        if (t.length < 3) {
            toast.error('Add a short title (3+ characters)');
            return;
        }
        if (b.length < 3) {
            toast.error('Add a description (3+ characters)');
            return;
        }
        setSubmitting(true);
        try {
            const res = await api.post<{ issue: { id: string } }>('/api/issues', {
                title: t,
                body: b,
                severity,
                contextPath: location.pathname || '',
                attachments: staged.length
                    ? staged.map((s) => ({ originalName: s.originalName, mimeType: s.mimeType, dataBase64: s.dataBase64 }))
                    : undefined,
            });
            if (res.ok && res.data?.issue) {
                toast.success(`Thanks — reported #${res.data.issue.id.slice(0, 8)}`);
                setOpen(false);
            } else {
                toast.error(res.error || 'Could not submit the report');
            }
        } catch {
            toast.error('Network error');
        } finally {
            setSubmitting(false);
        }
    };

    const sendReply = async (issue: IssueRecord) => {
        const draft = (replyDraft[issue.id] || '').trim();
        if (!draft) return;
        setReplyingId(issue.id);
        try {
            const res = await api.post<{ issue: IssueRecord }>(`/api/issues/${issue.id}/reply`, { body: draft });
            if (res.ok && res.data?.issue) {
                toast.success('Reply sent');
                setMine((prev) => prev.map((i) => (i.id === issue.id ? res.data!.issue : i)));
                setReplyDraft((prev) => ({ ...prev, [issue.id]: '' }));
            } else {
                toast.error(res.error || 'Reply failed');
            }
        } finally {
            setReplyingId(null);
        }
    };

    const sevPill = (s: Severity) => {
        if (s === 'high') return 'bg-red-500/20 text-red-300 border-red-500/30';
        if (s === 'medium') return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                title="Report an issue"
                aria-label="Report an issue"
                className="fixed bottom-20 right-4 lg:bottom-6 lg:right-6 z-30 w-12 h-12 rounded-full bg-amber-500/90 hover:bg-amber-500 text-dark-950 shadow-lg shadow-amber-500/30 flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
            >
                <Bug size={20} strokeWidth={2.5} />
            </button>

            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                        onClick={() => !submitting && setOpen(false)}
                    />
                    <div className="relative w-full max-w-lg bg-dark-900 border border-white/10 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Bug size={18} className="text-amber-400" />
                                    Issues
                                </h3>
                                <p className="text-xs text-gray-400 mt-1">
                                    Report a problem or follow up on a previous report.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => !submitting && setOpen(false)}
                                className="p-1 text-gray-400 hover:text-white"
                                aria-label="Close"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex gap-2 mb-4 border-b border-white/5">
                            <button
                                type="button"
                                onClick={() => setTab('new')}
                                className={`pb-2 px-1 text-sm font-medium transition-colors ${
                                    tab === 'new'
                                        ? 'text-amber-300 border-b-2 border-amber-500'
                                        : 'text-gray-500 hover:text-gray-300'
                                }`}
                            >
                                New report
                            </button>
                            <button
                                type="button"
                                onClick={() => setTab('mine')}
                                className={`pb-2 px-1 text-sm font-medium transition-colors flex items-center gap-1.5 ${
                                    tab === 'mine'
                                        ? 'text-amber-300 border-b-2 border-amber-500'
                                        : 'text-gray-500 hover:text-gray-300'
                                }`}
                            >
                                My reports
                                {mine.length > 0 && (
                                    <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full">{mine.length}</span>
                                )}
                            </button>
                        </div>

                        {tab === 'new' && (
                            <form onSubmit={submit}>
                                <p className="text-xs text-gray-500 mb-3">
                                    Page <span className="font-mono">{location.pathname}</span> is attached automatically.
                                </p>
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-400 mb-1">Title</label>
                                        <input
                                            type="text"
                                            value={title}
                                            onChange={(e) => setTitle(e.target.value)}
                                            maxLength={140}
                                            placeholder="One-line summary"
                                            className="w-full bg-dark-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-amber-500/50 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-400 mb-1">What happened?</label>
                                        <textarea
                                            value={body}
                                            onChange={(e) => setBody(e.target.value)}
                                            maxLength={4000}
                                            rows={5}
                                            placeholder="Steps to reproduce, what you expected, what happened instead."
                                            className="w-full bg-dark-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-amber-500/50 focus:outline-none resize-y"
                                        />
                                        <div className="text-[10px] text-gray-600 mt-1 text-right">{body.length} / 4000</div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-400 mb-1">Severity</label>
                                        <div className="flex gap-2">
                                            {(['low', 'medium', 'high'] as Severity[]).map((s) => (
                                                <button
                                                    key={s}
                                                    type="button"
                                                    onClick={() => setSeverity(s)}
                                                    className={`flex-1 py-2 rounded-lg text-xs font-medium capitalize transition-colors ${
                                                        severity === s
                                                            ? sevPill(s) + ' border'
                                                            : 'bg-white/5 text-gray-400 border border-white/5 hover:text-gray-200'
                                                    }`}
                                                >
                                                    {s}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-400 mb-1 flex items-center gap-1.5">
                                            <Paperclip size={11} />
                                            Screenshots (optional, up to {MAX_ATTACHMENTS})
                                        </label>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/png,image/jpeg,image/gif,image/webp"
                                            multiple
                                            onChange={(e) => handleFilesPicked(e.target.files)}
                                            className="hidden"
                                            id="bf-issue-files"
                                        />
                                        <div className="flex flex-wrap gap-2">
                                            {staged.map((s, idx) => (
                                                <div key={idx} className="relative group">
                                                    <img src={s.previewUrl} alt={s.originalName} className="h-16 w-16 object-cover rounded border border-white/10" />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeStaged(idx)}
                                                        className="absolute -top-1.5 -right-1.5 bg-red-500 hover:bg-red-400 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                                                        aria-label={`Remove ${s.originalName}`}
                                                    >
                                                        <X size={10} />
                                                    </button>
                                                </div>
                                            ))}
                                            {staged.length < MAX_ATTACHMENTS && (
                                                <label
                                                    htmlFor="bf-issue-files"
                                                    className="h-16 w-16 rounded border border-dashed border-white/15 hover:border-amber-500/50 text-gray-500 hover:text-amber-300 flex items-center justify-center cursor-pointer transition-colors"
                                                    title="Add a screenshot (PNG/JPEG/GIF/WEBP, max 5MB)"
                                                >
                                                    <ImagePlus size={20} />
                                                </label>
                                            )}
                                        </div>
                                        {staged.length > 0 && (
                                            <p className="text-[10px] text-gray-600 mt-1">
                                                {staged.length} attached · {(staged.reduce((acc, s) => acc + s.sizeBytes, 0) / 1024).toFixed(0)} KB total
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="flex justify-end gap-2 mt-6">
                                    <button
                                        type="button"
                                        onClick={() => !submitting && setOpen(false)}
                                        disabled={submitting}
                                        className="px-4 py-2 text-sm text-gray-400 hover:text-white disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={submitting}
                                        className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 hover:bg-amber-400 text-dark-950 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                    >
                                        {submitting && <Loader2 size={14} className="animate-spin" />}
                                        Send report
                                    </button>
                                </div>
                            </form>
                        )}

                        {tab === 'mine' && (
                            <div>
                                {mineLoading ? (
                                    <div className="text-center py-10 text-gray-500 text-sm flex items-center justify-center gap-2">
                                        <Loader2 size={14} className="animate-spin" />
                                        Loading your reports…
                                    </div>
                                ) : mine.length === 0 ? (
                                    <div className="text-center py-10 text-gray-500">
                                        <Inbox size={28} className="mx-auto mb-2 opacity-30" />
                                        <p className="text-sm">You haven&apos;t reported anything yet.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {mine.map((issue) => (
                                            <div key={issue.id} className="bg-dark-950/60 border border-white/5 rounded-xl p-3">
                                                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                                    <span className={`text-[10px] uppercase px-2 py-0.5 rounded border font-bold tracking-wider ${sevPill(issue.severity)}`}>
                                                        {issue.severity}
                                                    </span>
                                                    <span className="font-semibold text-gray-100 text-sm break-all">{issue.title}</span>
                                                    {issue.status === 'resolved'
                                                        ? <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded">RESOLVED</span>
                                                        : <span className="text-[10px] bg-red-500/20 text-red-300 border border-red-500/30 px-1.5 py-0.5 rounded">OPEN</span>}
                                                </div>
                                                <div className="text-[10px] text-gray-500 mb-2">
                                                    {new Date(issue.createdAt).toLocaleString()}
                                                    {issue.contextPath && <span className="font-mono"> · {issue.contextPath}</span>}
                                                </div>
                                                <p className="text-xs text-gray-300 whitespace-pre-wrap break-words">{issue.body}</p>

                                                {(issue.attachments?.length || 0) > 0 && (
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {issue.attachments!.map((a) => (
                                                            <AuthedImage
                                                                key={a.filename}
                                                                src={`/api/issues/attachments/${a.filename}`}
                                                                alt={a.originalName}
                                                                className="h-16 w-16 object-cover rounded border border-white/10"
                                                            />
                                                        ))}
                                                    </div>
                                                )}

                                                {issue.resolutionNote && (
                                                    <div className="mt-2 text-xs text-emerald-400/80 italic">Note: {issue.resolutionNote}</div>
                                                )}

                                                {(issue.replies?.length || 0) > 0 && (
                                                    <div className="mt-2 space-y-1.5 border-l-2 border-white/5 pl-2">
                                                        {issue.replies!.map((r) => (
                                                            <div key={r.id} className={`p-2 rounded ${r.isAdmin ? 'bg-primary-500/10 border border-primary-500/20' : 'bg-white/5'}`}>
                                                                <div className="text-[10px] text-gray-500 mb-1 flex items-center gap-1.5 flex-wrap">
                                                                    <span className={r.isAdmin ? 'text-primary-300 font-semibold' : ''}>{r.isAdmin ? 'Operator' : 'You'}</span>
                                                                    <span>·</span>
                                                                    <span>{new Date(r.at).toLocaleString()}</span>
                                                                </div>
                                                                <p className="text-xs text-gray-200 whitespace-pre-wrap break-words">{r.body}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                <div className="mt-2 flex gap-2">
                                                    <textarea
                                                        value={replyDraft[issue.id] || ''}
                                                        onChange={(e) => setReplyDraft((prev) => ({ ...prev, [issue.id]: e.target.value }))}
                                                        placeholder={issue.status === 'resolved' ? 'Add a follow-up note…' : 'Reply or add more detail…'}
                                                        rows={2}
                                                        className="flex-1 bg-dark-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500/50 resize-y"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => sendReply(issue)}
                                                        disabled={!(replyDraft[issue.id] || '').trim() || replyingId === issue.id}
                                                        className="self-end px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500 hover:bg-amber-400 text-dark-950 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                                    >
                                                        {replyingId === issue.id && <Loader2 size={12} className="animate-spin" />}
                                                        Reply
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
