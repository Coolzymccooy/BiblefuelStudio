import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { RefreshCw, RotateCcw, Mail, CheckCircle2, XCircle, User as UserIcon, Check, X, Inbox, Clock, Bug, RotateCw } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { AuthedImage } from '../components/AuthedImage';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';

interface AdminUser {
    id: string;
    email: string;
    role: string;
    provider: string;
    emailVerified: boolean;
    createdAt: string | null;
    isSuperAdmin: boolean;
    plan: string;
    usage: {
        day: string | null;
        counts: { scripts: number; tts: number; render: number; imageGen: number };
    };
}

interface AccessRequest {
    id: string;
    createdAt: string;
    name: string;
    email: string;
    org: string;
    pitch: string;
    status: 'pending' | 'approved' | 'denied';
    reviewedAt?: string;
    reviewedBy?: string;
}

interface AccessRequestCounts {
    pending: number;
    approved: number;
    denied: number;
}

interface IssueReply {
    id: string;
    at: string;
    byEmail: string;
    byUserId: string;
    isAdmin: boolean;
    body: string;
}

interface IssueRecord {
    id: string;
    createdAt: string;
    reporterEmail: string;
    reporterId: string;
    title: string;
    body: string;
    severity: 'low' | 'medium' | 'high';
    contextPath: string;
    status: 'open' | 'resolved';
    resolvedAt?: string;
    resolvedBy?: string;
    resolutionNote?: string;
    replies?: IssueReply[];
    attachments?: { filename: string; originalName: string; mimeType: string; size: number; uploadedAt: string }[];
}

interface IssueCounts {
    open: number;
    resolved: number;
}

type AdminTab = 'users' | 'access-requests' | 'issues';

const TAB_LABELS: Record<AdminTab, string> = {
    users: 'Users',
    'access-requests': 'Access Requests',
    issues: 'Issues',
};

export function AdminPage() {
    const { isSuperAdmin, isLoading } = useAuth();
    const [tab, setTab] = useState<AdminTab>('users');
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [requests, setRequests] = useState<AccessRequest[]>([]);
    const [requestCounts, setRequestCounts] = useState<AccessRequestCounts>({ pending: 0, approved: 0, denied: 0 });
    const [issues, setIssues] = useState<IssueRecord[]>([]);
    const [issueCounts, setIssueCounts] = useState<IssueCounts>({ open: 0, resolved: 0 });
    const [loading, setLoading] = useState(false);
    const [resettingId, setResettingId] = useState<string | null>(null);
    const [decidingId, setDecidingId] = useState<string | null>(null);
    const [issueBusyId, setIssueBusyId] = useState<string | null>(null);
    const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
    const [replyingId, setReplyingId] = useState<string | null>(null);
    const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});

    const loadUsers = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get<{ users: AdminUser[] }>('/api/admin/users');
            if (res.ok && res.data?.users) {
                setUsers(res.data.users);
            } else {
                toast.error(res.error || 'Failed to load users');
            }
        } finally {
            setLoading(false);
        }
    }, []);

    const loadRequests = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get<{ requests: AccessRequest[]; counts: AccessRequestCounts }>(
                '/api/admin/access-requests',
            );
            if (res.ok && res.data) {
                setRequests(res.data.requests || []);
                setRequestCounts(res.data.counts || { pending: 0, approved: 0, denied: 0 });
            } else {
                toast.error(res.error || 'Failed to load access requests');
            }
        } finally {
            setLoading(false);
        }
    }, []);

    const loadIssues = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get<{ issues: IssueRecord[]; counts: IssueCounts }>('/api/admin/issues');
            if (res.ok && res.data) {
                setIssues(res.data.issues || []);
                setIssueCounts(res.data.counts || { open: 0, resolved: 0 });
            } else {
                toast.error(res.error || 'Failed to load issues');
            }
        } finally {
            setLoading(false);
        }
    }, []);

    const refresh = useCallback(() => {
        if (tab === 'users') return loadUsers();
        if (tab === 'access-requests') return loadRequests();
        return loadIssues();
    }, [tab, loadUsers, loadRequests, loadIssues]);

    useEffect(() => {
        if (!isSuperAdmin) return;
        refresh();
    }, [isSuperAdmin, refresh]);

    if (isLoading) {
        return <div className="text-content-secondary text-sm">Checking access…</div>;
    }
    if (!isSuperAdmin) {
        return <Navigate to="/app" replace />;
    }

    const resetQuotas = async (user: AdminUser) => {
        setResettingId(user.id);
        try {
            const res = await api.post<{ usage: AdminUser['usage'] }>(`/api/admin/users/${user.id}/reset-quotas`);
            if (res.ok && res.data?.usage) {
                toast.success(`Quotas reset for ${user.email}`);
                setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, usage: res.data!.usage } : u)));
            } else {
                toast.error(res.error || 'Reset failed');
            }
        } finally {
            setResettingId(null);
        }
    };

    const sendReply = async (issue: IssueRecord) => {
        const body = (replyDraft[issue.id] || '').trim();
        if (!body) return;
        setReplyingId(issue.id);
        try {
            const res = await api.post<{ issue: IssueRecord; reply: IssueReply }>(`/api/issues/${issue.id}/reply`, { body });
            if (res.ok && res.data?.issue) {
                toast.success('Reply sent');
                setIssues((prev) => prev.map((i) => (i.id === issue.id ? res.data!.issue : i)));
                setReplyDraft((prev) => ({ ...prev, [issue.id]: '' }));
                setExpandedThreads((prev) => ({ ...prev, [issue.id]: true }));
            } else {
                toast.error(res.error || 'Reply failed');
            }
        } finally {
            setReplyingId(null);
        }
    };

    const toggleIssue = async (issue: IssueRecord) => {
        const action = issue.status === 'open' ? 'resolve' : 'reopen';
        setIssueBusyId(issue.id);
        try {
            const res = await api.post<{ issue: IssueRecord }>(`/api/admin/issues/${issue.id}/${action}`);
            if (res.ok && res.data?.issue) {
                toast.success(action === 'resolve' ? 'Issue resolved' : 'Issue reopened');
                setIssues((prev) => prev.map((i) => (i.id === issue.id ? res.data!.issue : i)));
                setIssueCounts((prev) => {
                    if (action === 'resolve') {
                        return { open: Math.max(0, prev.open - 1), resolved: prev.resolved + 1 };
                    }
                    return { open: prev.open + 1, resolved: Math.max(0, prev.resolved - 1) };
                });
            } else {
                toast.error(res.error || `${action} failed`);
            }
        } finally {
            setIssueBusyId(null);
        }
    };

    const decide = async (req: AccessRequest, action: 'approve' | 'deny') => {
        setDecidingId(req.id);
        try {
            const res = await api.post<{ request: AccessRequest }>(`/api/admin/access-requests/${req.id}/${action}`);
            if (res.ok && res.data?.request) {
                toast.success(action === 'approve' ? `${req.email} can now sign up` : `${req.email} denied`);
                setRequests((prev) => prev.map((r) => (r.id === req.id ? res.data!.request : r)));
                setRequestCounts((prev) => {
                    const next = { ...prev };
                    if (req.status === 'pending') next.pending = Math.max(0, next.pending - 1);
                    if (req.status === 'approved') next.approved = Math.max(0, next.approved - 1);
                    if (req.status === 'denied') next.denied = Math.max(0, next.denied - 1);
                    next[action === 'approve' ? 'approved' : 'denied'] += 1;
                    return next;
                });
            } else {
                toast.error(res.error || `${action} failed`);
            }
        } finally {
            setDecidingId(null);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <div className="bf-eyebrow">Admin</div>
                    <h2 className="font-displaySerif text-[28px] leading-[1.08] font-semibold text-bf-cream mt-1.5">Behind the <em className="italic font-medium text-bf-gold">curtain</em>.</h2>
                    <p className="text-help mt-2">Operator-only controls. Visible to super-admin accounts only.</p>
                </div>
                <Button onClick={refresh} isLoading={loading} variant="secondary">
                    <RefreshCw size={16} className="mr-2" />
                    Refresh
                </Button>
            </div>

            <div className="flex gap-2">
                {(Object.keys(TAB_LABELS) as AdminTab[]).map((t) => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => setTab(t)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                            tab === t
                                ? 'bg-primary-500/20 text-primary-200 border border-primary-500/30'
                                : 'bg-white/5 text-content-secondary border border-white/5 hover:text-gray-200'
                        }`}
                    >
                        {TAB_LABELS[t]}
                        {t === 'access-requests' && requestCounts.pending > 0 && (
                            <span className="bg-amber-500/20 text-amber-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                {requestCounts.pending}
                            </span>
                        )}
                        {t === 'issues' && issueCounts.open > 0 && (
                            <span className="bg-red-500/20 text-red-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                {issueCounts.open}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {tab === 'access-requests' && (
                <Card>
                    <div className="flex items-center gap-3 mb-4 text-xs">
                        <span className="flex items-center gap-1.5 text-amber-300">
                            <Clock size={12} /> {requestCounts.pending} pending
                        </span>
                        <span className="flex items-center gap-1.5 text-[#8fc2b8]">
                            <CheckCircle2 size={12} /> {requestCounts.approved} approved
                        </span>
                        <span className="flex items-center gap-1.5 text-red-300">
                            <XCircle size={12} /> {requestCounts.denied} denied
                        </span>
                    </div>
                    {requests.length === 0 ? (
                        <div className="text-center py-16 text-content-tertiary">
                            <Inbox size={36} className="mx-auto mb-3 opacity-30" />
                            <p>{loading ? 'Loading requests…' : 'No access requests yet.'}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {requests.map((r) => {
                                const isPending = r.status === 'pending';
                                const isBusy = decidingId === r.id;
                                return (
                                    <div
                                        key={r.id}
                                        className="bg-dark-900/40 border border-white/5 rounded-xl p-4 hover:border-white/10 transition-colors"
                                    >
                                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                                    <span className="font-semibold text-gray-100">{r.name}</span>
                                                    <span className="text-content-secondary text-sm break-all">&lt;{r.email}&gt;</span>
                                                    {r.status === 'pending' && (
                                                        <Badge variant="warning" className="text-[10px]">PENDING</Badge>
                                                    )}
                                                    {r.status === 'approved' && (
                                                        <Badge variant="success" className="text-[10px]">APPROVED</Badge>
                                                    )}
                                                    {r.status === 'denied' && (
                                                        <Badge variant="danger" className="text-[10px]">DENIED</Badge>
                                                    )}
                                                </div>
                                                <div className="text-xs text-content-tertiary mb-2">
                                                    {r.org} · submitted {new Date(r.createdAt).toLocaleString()}
                                                    {r.reviewedAt && (
                                                        <span> · reviewed {new Date(r.reviewedAt).toLocaleString()} by {r.reviewedBy}</span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-gray-300 whitespace-pre-wrap break-words">{r.pitch}</p>
                                            </div>
                                            <div className="flex flex-row sm:flex-col gap-2 shrink-0">
                                                <Button
                                                    onClick={() => decide(r, 'approve')}
                                                    isLoading={isBusy}
                                                    disabled={!isPending && r.status === 'approved'}
                                                    className="text-xs py-1.5 px-3 bg-[#7fb5aa]/10 hover:bg-[#7fb5aa]/20 text-[#8fc2b8] border-[#7fb5aa]/20"
                                                    title={r.status === 'approved' ? 'Already approved' : `Approve ${r.email} for signup`}
                                                >
                                                    <Check size={13} className="mr-1.5" />
                                                    Approve
                                                </Button>
                                                <Button
                                                    onClick={() => decide(r, 'deny')}
                                                    isLoading={isBusy}
                                                    disabled={!isPending && r.status === 'denied'}
                                                    variant="secondary"
                                                    className="text-xs py-1.5 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-300 border-red-500/20"
                                                    title={r.status === 'denied' ? 'Already denied' : `Deny ${r.email}`}
                                                >
                                                    <X size={13} className="mr-1.5" />
                                                    Deny
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Card>
            )}

            {tab === 'issues' && (
                <Card>
                    <div className="flex items-center gap-3 mb-4 text-xs">
                        <span className="flex items-center gap-1.5 text-red-300">
                            <Bug size={12} /> {issueCounts.open} open
                        </span>
                        <span className="flex items-center gap-1.5 text-[#8fc2b8]">
                            <CheckCircle2 size={12} /> {issueCounts.resolved} resolved
                        </span>
                    </div>
                    {issues.length === 0 ? (
                        <div className="text-center py-16 text-content-tertiary">
                            <Bug size={36} className="mx-auto mb-3 opacity-30" />
                            <p>{loading ? 'Loading issues…' : 'No issues reported yet.'}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {issues.map((issue) => {
                                const sevColor =
                                    issue.severity === 'high' ? 'bg-red-500/20 text-red-300 border-red-500/30'
                                    : issue.severity === 'medium' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                    : 'bg-[#7fb5aa]/20 text-[#8fc2b8] border-[#7fb5aa]/30';
                                const isOpen = issue.status === 'open';
                                return (
                                    <div
                                        key={issue.id}
                                        className="bg-dark-900/40 border border-white/5 rounded-xl p-4 hover:border-white/10 transition-colors"
                                    >
                                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                                    <span className={`text-[10px] uppercase px-2 py-0.5 rounded border font-bold tracking-wider ${sevColor}`}>
                                                        {issue.severity}
                                                    </span>
                                                    <span className="font-semibold text-gray-100 break-all">{issue.title}</span>
                                                    {isOpen ? (
                                                        <Badge variant="danger" className="text-[10px]">OPEN</Badge>
                                                    ) : (
                                                        <Badge variant="success" className="text-[10px]">RESOLVED</Badge>
                                                    )}
                                                </div>
                                                <div className="text-xs text-content-tertiary mb-2 flex flex-wrap gap-x-3 gap-y-1">
                                                    <span>{issue.reporterEmail || '(no email)'}</span>
                                                    {issue.contextPath && (
                                                        <span className="font-mono">on {issue.contextPath}</span>
                                                    )}
                                                    <span>{new Date(issue.createdAt).toLocaleString()}</span>
                                                    {issue.resolvedAt && (
                                                        <span className="text-[#7fb5aa]/80">
                                                            resolved {new Date(issue.resolvedAt).toLocaleString()} by {issue.resolvedBy}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-gray-300 whitespace-pre-wrap break-words">{issue.body}</p>
                                                {(issue.attachments?.length || 0) > 0 && (
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {issue.attachments!.map((a) => (
                                                            <AuthedImage
                                                                key={a.filename}
                                                                src={`/api/issues/attachments/${a.filename}`}
                                                                alt={a.originalName}
                                                                className="h-20 w-20 object-cover rounded border border-white/10"
                                                            />
                                                        ))}
                                                    </div>
                                                )}
                                                {issue.resolutionNote && (
                                                    <div className="mt-2 text-xs text-[#7fb5aa]/80 italic">
                                                        Note: {issue.resolutionNote}
                                                    </div>
                                                )}
                                                {(issue.replies?.length || 0) > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpandedThreads((prev) => ({ ...prev, [issue.id]: !prev[issue.id] }))}
                                                        className="mt-3 text-xs text-primary-300 hover:text-primary-200 underline"
                                                    >
                                                        {expandedThreads[issue.id]
                                                            ? `Hide ${issue.replies!.length} repl${issue.replies!.length === 1 ? 'y' : 'ies'}`
                                                            : `Show ${issue.replies!.length} repl${issue.replies!.length === 1 ? 'y' : 'ies'}`}
                                                    </button>
                                                )}
                                                {expandedThreads[issue.id] && (issue.replies?.length || 0) > 0 && (
                                                    <div className="mt-3 space-y-2 border-l-2 border-white/5 pl-3">
                                                        {issue.replies!.map((r) => (
                                                            <div key={r.id} className={`p-2 rounded ${r.isAdmin ? 'bg-primary-500/10 border border-primary-500/20' : 'bg-white/5'}`}>
                                                                <div className="text-[0.75rem] text-content-tertiary mb-1 flex items-center gap-2">
                                                                    <span className={r.isAdmin ? 'text-primary-300 font-semibold' : ''}>{r.byEmail || '(unknown)'}</span>
                                                                    {r.isAdmin && <span className="text-[0.625rem] font-medium bg-primary-500/20 text-primary-300 px-1.5 py-0.5 rounded">Admin</span>}
                                                                    <span>{new Date(r.at).toLocaleString()}</span>
                                                                </div>
                                                                <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{r.body}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                <div className="mt-3 flex gap-2">
                                                    <textarea
                                                        value={replyDraft[issue.id] || ''}
                                                        onChange={(e) => setReplyDraft((prev) => ({ ...prev, [issue.id]: e.target.value }))}
                                                        placeholder="Reply to reporter…"
                                                        rows={2}
                                                        className="flex-1 bg-dark-900/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-primary-500/50"
                                                    />
                                                    <Button
                                                        onClick={() => sendReply(issue)}
                                                        isLoading={replyingId === issue.id}
                                                        disabled={!((replyDraft[issue.id] || '').trim())}
                                                        variant="secondary"
                                                        className="text-xs py-1.5 px-3 self-end"
                                                    >
                                                        Reply
                                                    </Button>
                                                </div>
                                            </div>
                                            <div className="flex shrink-0">
                                                <Button
                                                    onClick={() => toggleIssue(issue)}
                                                    isLoading={issueBusyId === issue.id}
                                                    variant="secondary"
                                                    className={`text-xs py-1.5 px-3 ${
                                                        isOpen
                                                            ? 'bg-[#7fb5aa]/10 hover:bg-[#7fb5aa]/20 text-[#8fc2b8] border-[#7fb5aa]/20'
                                                            : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/20'
                                                    }`}
                                                    title={isOpen ? 'Mark this issue resolved' : 'Reopen this issue'}
                                                >
                                                    {isOpen ? (
                                                        <>
                                                            <Check size={13} className="mr-1.5" />
                                                            Resolve
                                                        </>
                                                    ) : (
                                                        <>
                                                            <RotateCw size={13} className="mr-1.5" />
                                                            Reopen
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Card>
            )}

            {tab === 'users' && (
                <Card>
                    {users.length === 0 ? (
                        <div className="text-center py-16 text-content-tertiary">
                            <UserIcon size={36} className="mx-auto mb-3 opacity-30" />
                            <p>{loading ? 'Loading users…' : 'No users found.'}</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[0.75rem] font-medium text-content-secondary border-b border-white/[0.06]">
                                        <th className="py-3 px-2 font-semibold">User</th>
                                        <th className="py-3 px-2 font-semibold">Plan</th>
                                        <th className="py-3 px-2 font-semibold">Today&apos;s usage (scripts / tts / renders / images)</th>
                                        <th className="py-3 px-2 font-semibold text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map((u) => (
                                        <tr key={u.id} className="border-b border-white/5 last:border-b-0 hover:bg-white/[0.02]">
                                            <td className="py-3 px-2">
                                                <div className="flex items-center gap-2 text-gray-100">
                                                    <Mail size={14} className="text-gray-500 shrink-0" />
                                                    <span className="font-medium break-all">{u.email}</span>
                                                    {u.isSuperAdmin && <Badge variant="warning" className="text-[10px]">SUPER</Badge>}
                                                </div>
                                                <div className="flex items-center gap-3 mt-1 text-[0.75rem] text-content-tertiary">
                                                    {u.emailVerified ? (
                                                        <span className="flex items-center gap-1 text-[#7fb5aa]/80">
                                                            <CheckCircle2 size={11} /> verified
                                                        </span>
                                                    ) : (
                                                        <span className="flex items-center gap-1 text-amber-400/80">
                                                            <XCircle size={11} /> unverified
                                                        </span>
                                                    )}
                                                    <span>{u.provider}</span>
                                                    <span className="font-mono opacity-60">#{u.id.slice(0, 14)}</span>
                                                </div>
                                            </td>
                                            <td className="py-3 px-2">
                                                <Badge variant={u.plan === 'premium' || u.plan === 'super_admin' ? 'success' : 'default'}>
                                                    {u.plan}
                                                </Badge>
                                            </td>
                                            <td className="py-3 px-2 font-mono text-gray-300">
                                                <span className="text-primary-300">{u.usage.counts.scripts}</span>
                                                <span className="text-content-tertiary"> / </span>
                                                <span className="text-primary-300">{u.usage.counts.tts}</span>
                                                <span className="text-content-tertiary"> / </span>
                                                <span className="text-primary-300">{u.usage.counts.render}</span>
                                                <span className="text-content-tertiary"> / </span>
                                                <span className="text-primary-300">{u.usage.counts.imageGen}</span>
                                                {u.usage.day && (
                                                    <span className="text-[0.6875rem] text-content-tertiary ml-2">({u.usage.day})</span>
                                                )}
                                            </td>
                                            <td className="py-3 px-2 text-right">
                                                <Button
                                                    onClick={() => resetQuotas(u)}
                                                    isLoading={resettingId === u.id}
                                                    disabled={u.isSuperAdmin}
                                                    variant="secondary"
                                                    className="text-xs py-1.5 px-3"
                                                    title={u.isSuperAdmin ? 'Super-admin has no per-user quotas' : `Reset today's quotas for ${u.email}`}
                                                >
                                                    <RotateCcw size={13} className="mr-1.5" />
                                                    Reset quotas
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
            )}
        </div>
    );
}
