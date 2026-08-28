import { useCallback, useEffect, useState } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { Zap, CheckCircle2, Loader2, Trash2, ExternalLink, X as XIcon, Plug, Send, AlertCircle, ChevronRight } from 'lucide-react';

interface Webhook {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    lastSuccessAt?: string;
    lastFailureAt?: string;
    lastFailureMessage?: string;
    failureCount?: number;
}

interface TestResult {
    ok: boolean;
    status?: number;
    error?: string;
}

/**
 * Human relative-time formatter for delivery history ("2 days ago",
 * "just now"). Keeps the format tight; no library dependency.
 */
function timeAgo(iso: string): string {
    if (!iso) return '';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (diffSec < 60) return 'just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h ago`;
    return `${Math.floor(diffSec / 86400)} d ago`;
}

/**
 * Per-user webhook destination card (Make / Zapier / n8n / anything that
 * accepts a POST). Sits next to the YouTube card on Settings → Connections.
 *
 * The webhook URL is owned by the user — when their campaign auto-posts,
 * the server fires the URL with the rendered video URL + caption + title,
 * and Make/Zapier handles the actual cross-posting to TikTok / IG / X /
 * wherever they wired the scenario.
 *
 * Why this beats forcing native OAuth for every platform:
 *   - TikTok / IG / X all require their own developer-app onboarding +
 *     review cycles (weeks-to-months for prod approval)
 *   - Make / Zapier already solved that. The user connects once in their
 *     Make scenario, never sees an API key in Biblefuel
 *   - Same model as Buffer, Hootsuite, Later — they all rely on Make/Zapier
 *     under the hood for non-API platforms
 *
 * Guided-modal design choices for non-technical users:
 *   - Step-by-step instructions inline (no "read the docs" links)
 *   - One field to paste (the webhook URL), nothing else to copy
 *   - "Test" button after save so they get an instant ✓/✗ confirmation
 *     instead of "did it work? guess I'll find out next render"
 *   - Plain-English error messages from the server ("Webhook took longer
 *     than 10 seconds…") instead of stack traces
 */
export function WebhookConnectCard() {
    const [webhooks, setWebhooks] = useState<Webhook[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [testing, setTesting] = useState<Record<string, boolean>>({});
    const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

    const loadWebhooks = useCallback(async () => {
        const res = await api.get<{ webhooks: Webhook[] }>('/api/social/webhooks');
        if (res.ok && Array.isArray(res.data?.webhooks)) setWebhooks(res.data.webhooks);
        setLoading(false);
    }, []);

    useEffect(() => {
        loadWebhooks();
    }, [loadWebhooks]);

    const handleTest = async (id: string) => {
        setTesting((s) => ({ ...s, [id]: true }));
        try {
            const res = await api.post<{ ok?: boolean; status?: number; error?: string }>(
                `/api/social/webhooks/${encodeURIComponent(id)}/test`,
            );
            // The server always returns 200 with ok:true/false in the body
            // — that lets us distinguish a "webhook unreachable" (which the
            // user can fix) from a "network error from your browser to us".
            const body = (res.data || {}) as { ok?: boolean; status?: number; error?: string };
            const result: TestResult = { ok: Boolean(body.ok), status: body.status, error: body.error };
            setTestResults((r) => ({ ...r, [id]: result }));
            if (result.ok) {
                toast.success(
                    'Test sent ✓ — confirm it appears in your Make/Zapier run history. (Webhook reachable ≠ scenario turned on.)',
                    { duration: 8000 },
                );
            } else {
                toast.error(result.error || 'Webhook test failed', { duration: 10000 });
            }
        } catch {
            setTestResults((r) => ({ ...r, [id]: { ok: false, error: 'Network error' } }));
            toast.error('Could not reach the test endpoint');
        } finally {
            setTesting((s) => ({ ...s, [id]: false }));
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Remove the webhook "${name}"? Auto-publish to this destination will stop immediately.`)) return;
        const res = await api.delete(`/api/social/webhooks/${encodeURIComponent(id)}`);
        if (res.ok) {
            toast.success('Webhook removed');
            await loadWebhooks();
        } else {
            toast.error(res.error || 'Delete failed');
        }
    };

    return (
        <>
            <Card title="TikTok + Instagram Auto-Publish" className="border-white/10">
                <p className="text-xs text-content-secondary mb-4">
                    <span className="text-gray-300">Powered by Make or Zapier</span> — connect your account once, and your rendered videos
                    auto-post to TikTok, Instagram, X, LinkedIn, anywhere your scenario is wired up.
                </p>

                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-content-secondary py-4">
                        <Loader2 size={16} className="animate-spin" /> Loading…
                    </div>
                ) : webhooks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
                        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 inline-flex">
                            <Zap size={22} className="text-amber-300" />
                        </div>
                        <p className="text-sm font-semibold text-white mt-3">Not connected yet</p>
                        <p className="text-xs text-content-secondary mt-1 mb-4 max-w-md mx-auto">
                            One connection handles TikTok + Instagram + X + LinkedIn — all at once. Takes about 5 minutes to set up, and Make &amp; Zapier both offer free tiers for testing.
                        </p>
                        <Button
                            className="text-xs h-9 px-4 bg-amber-500 hover:bg-amber-400 text-black font-semibold border-amber-500/40"
                            onClick={() => setShowAddModal(true)}
                        >
                            <Plug size={14} className="mr-1.5" /> Connect now
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {webhooks.map((w) => {
                            const result = testResults[w.id];
                            // Server-side delivery history. Most-recent action
                            // wins for the badge — if a real campaign just
                            // succeeded after a prior failure, we want the
                            // green badge, not a stale red one. Falls back to
                            // the in-memory test result when no server-side
                            // delivery has happened yet (e.g. just-added
                            // webhook before first Test click).
                            const lastSuccessTs = w.lastSuccessAt ? Date.parse(w.lastSuccessAt) : 0;
                            const lastFailureTs = w.lastFailureAt ? Date.parse(w.lastFailureAt) : 0;
                            const recentFailure = lastFailureTs > lastSuccessTs && (w.failureCount || 0) > 0;
                            const everSucceeded = lastSuccessTs > 0;
                            const showOkBadge = (result?.ok === true) || (!result && everSucceeded && !recentFailure);
                            const showFailBadge = (result && !result.ok) || (!result && recentFailure);
                            return (
                                <div
                                    key={w.id}
                                    className="rounded-xl border border-white/10 bg-white/[0.02] p-3 flex flex-col sm:flex-row sm:items-center gap-3"
                                >
                                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 flex-shrink-0">
                                        <Zap size={18} className="text-amber-300" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-semibold text-white">{w.name}</span>
                                            {showOkBadge && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#7fb5aa]/15 border border-[#7fb5aa]/30 text-[#a5cec6] text-[10px] font-semibold">
                                                    <CheckCircle2 size={10} /> Healthy
                                                </span>
                                            )}
                                            {showFailBadge && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-200 text-[10px] font-semibold">
                                                    <AlertCircle size={10} /> {recentFailure && (w.failureCount || 0) > 1 ? `${w.failureCount} failures` : 'Delivery failed'}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[10px] font-mono text-content-secondary truncate mt-0.5">{w.url}</p>
                                        {/* Delivery history line — "Last delivery: 2 h ago" /
                                            "Last failure: 1 d ago". Catches silent breakage
                                            (e.g. user deleted their Make scenario after
                                            connecting it here). */}
                                        {(everSucceeded || lastFailureTs > 0) && (
                                            <p className="text-[10px] text-content-tertiary mt-1">
                                                {everSucceeded && (
                                                    <>
                                                        Last delivery: <span className={recentFailure ? 'text-gray-400' : 'text-[#8fc2b8]/90'}>{timeAgo(w.lastSuccessAt || '')}</span>
                                                    </>
                                                )}
                                                {recentFailure && (
                                                    <>
                                                        {everSucceeded ? ' · ' : ''}
                                                        Last failure: <span className="text-rose-300/90">{timeAgo(w.lastFailureAt || '')}</span>
                                                    </>
                                                )}
                                            </p>
                                        )}
                                        {(result && !result.ok && result.error) && (
                                            <p className="text-[11px] text-rose-300 mt-1">{result.error}</p>
                                        )}
                                        {(!result && recentFailure && w.lastFailureMessage) && (
                                            <p className="text-[11px] text-rose-300 mt-1 line-clamp-2">{w.lastFailureMessage}</p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <Button
                                            variant="secondary"
                                            className="text-xs h-8 px-3"
                                            onClick={() => handleTest(w.id)}
                                            isLoading={testing[w.id]}
                                        >
                                            <Send size={12} className="mr-1" /> Test
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            className="text-xs h-8 px-2 border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                                            onClick={() => handleDelete(w.id, w.name)}
                                        >
                                            <Trash2 size={12} />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                        <Button
                            variant="secondary"
                            className="w-full mt-2 text-xs h-9 border-dashed border-white/10"
                            onClick={() => setShowAddModal(true)}
                        >
                            <Plug size={14} className="mr-1.5" /> Add another webhook
                        </Button>
                    </div>
                )}
            </Card>

            {showAddModal && (
                <AddWebhookModal
                    onClose={() => setShowAddModal(false)}
                    onSaved={async () => {
                        await loadWebhooks();
                        setShowAddModal(false);
                    }}
                />
            )}
        </>
    );
}

interface AddWebhookModalProps {
    onClose: () => void;
    onSaved: () => void;
}

function AddWebhookModal({ onClose, onSaved }: AddWebhookModalProps) {
    const [step, setStep] = useState<1 | 2>(1);
    const [name, setName] = useState('My Make Scenario');
    const [url, setUrl] = useState('');
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<TestResult | null>(null);

    const handleSave = async () => {
        if (!url.trim()) {
            toast.error('Paste your webhook URL first');
            return;
        }
        if (!/^https?:\/\//i.test(url.trim())) {
            toast.error('URL must start with http:// or https://');
            return;
        }
        setSaving(true);
        try {
            const res = await api.post<{ webhook?: { id: string } }>('/api/social/webhooks', {
                name: name.trim() || 'Webhook',
                url: url.trim(),
                enabled: true,
            });
            if (!res.ok || !res.data?.webhook?.id) {
                toast.error(res.error || 'Save failed');
                return;
            }
            // Auto-test on save so the user gets confirmation without a second click
            setTesting(true);
            const test = await api.post<{ ok: boolean; error?: string; status?: number }>(
                `/api/social/webhooks/${encodeURIComponent(res.data.webhook.id)}/test`,
            );
            setTesting(false);
            const result: TestResult = { ok: Boolean(test.data?.ok), error: test.data?.error, status: test.data?.status };
            setTestResult(result);
            if (result.ok) {
                toast.success('Saved + tested ✓');
                onSaved();
            } else {
                // Don't close — let user see the error and fix the URL
                toast.error('Saved, but the test ping failed. Fix the URL and try again.');
            }
        } catch (err) {
            toast.error('Save failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-2xl max-h-[88vh] flex flex-col rounded-xl bg-dark-900/95 backdrop-blur-xl border border-white/20 shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2">
                            <Zap size={18} className="text-amber-300" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">Connect Make / Zapier</h3>
                            <p className="text-xs text-content-secondary">Step {step} of 2</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-content-tertiary hover:text-white" aria-label="Close">
                        <XIcon size={20} />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
                    {step === 1 ? (
                        <>
                            <div>
                                <h4 className="text-sm font-semibold text-white mb-2">
                                    Don't have a Make or Zapier account yet? Pick one and sign up (both have free tiers):
                                </h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <a
                                        href="https://www.make.com/en/register"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="rounded-xl border border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 p-4 transition-colors group"
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <strong className="text-white">Make.com</strong>
                                            <ExternalLink size={14} className="text-purple-300 group-hover:translate-x-0.5 transition-transform" />
                                        </div>
                                        <p className="text-[11px] text-content-secondary">More flexible. Free tier available for testing and light usage.</p>
                                    </a>
                                    <a
                                        href="https://zapier.com/sign-up"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="rounded-xl border border-orange-500/30 bg-orange-500/5 hover:bg-orange-500/10 p-4 transition-colors group"
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <strong className="text-white">Zapier</strong>
                                            <ExternalLink size={14} className="text-orange-300 group-hover:translate-x-0.5 transition-transform" />
                                        </div>
                                        <p className="text-[11px] text-content-secondary">Simpler interface. Free tier available for testing.</p>
                                    </a>
                                </div>
                                <p className="text-[11px] text-content-tertiary mt-2">
                                    Already signed up? Skip ahead — click <strong>Next</strong> below.
                                </p>
                            </div>

                            <div className="border-t border-white/10 pt-4">
                                <h4 className="text-sm font-semibold text-white mb-3">
                                    Now build a scenario in Make (3 quick steps):
                                </h4>
                                <ol className="space-y-3 text-sm text-gray-300">
                                    <li className="flex gap-3">
                                        <span className="rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200 w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">1</span>
                                        <div className="flex-1">
                                            <strong className="text-white">Create a scenario.</strong> In Make, click <code className="text-[11px] bg-white/10 px-1.5 py-0.5 rounded">Create a new scenario</code>.
                                        </div>
                                    </li>
                                    <li className="flex gap-3">
                                        <span className="rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200 w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">2</span>
                                        <div className="flex-1">
                                            <strong className="text-white">Add a webhook trigger.</strong> Search modules for <code className="text-[11px] bg-white/10 px-1.5 py-0.5 rounded">Webhooks</code> → choose <code className="text-[11px] bg-white/10 px-1.5 py-0.5 rounded">Custom webhook</code>. Click <code className="text-[11px] bg-white/10 px-1.5 py-0.5 rounded">Add</code> to create one.
                                        </div>
                                    </li>
                                    <li className="flex gap-3">
                                        <span className="rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200 w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">3</span>
                                        <div className="flex-1">
                                            <strong className="text-white">Copy the URL.</strong> Make shows the webhook URL (looks like <code className="text-[11px] bg-white/10 px-1.5 py-0.5 rounded break-all">https://hook.eu1.make.com/abc...</code>). Copy it. Then add your next module — TikTok, Instagram, etc.
                                        </div>
                                    </li>
                                </ol>
                                <div className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/[0.05] p-3 text-[11px] text-blue-200">
                                    <strong>Tip:</strong> Once your TikTok module is added, save and turn on the scenario in Make. Without that, Make won't process the webhook payloads we send.
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="rounded-xl border border-[#7fb5aa]/20 bg-[#7fb5aa]/[0.05] p-4">
                                <p className="text-sm text-[#a5cec6] leading-relaxed">
                                    Paste the webhook URL Make / Zapier gave you. We'll save it AND fire a test ping
                                    so you can confirm it lands in your scenario's history before any real video runs through it.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-300">Friendly name</label>
                                <Input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="e.g. My TikTok scenario"
                                    className="bg-black/20"
                                />
                                <p className="text-[10px] text-content-tertiary">Shown on this page — pick anything that helps you remember which scenario this is.</p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-300">Webhook URL</label>
                                <Input
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    placeholder="https://hook.eu1.make.com/..."
                                    className="bg-black/20 font-mono text-xs"
                                />
                                <p className="text-[10px] text-content-tertiary">Starts with <code className="text-amber-200">https://hook.</code> for Make, or <code className="text-amber-200">https://hooks.zapier.com/</code> for Zapier.</p>
                            </div>

                            {testResult && !testResult.ok && (
                                <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.05] p-3 text-xs text-rose-200">
                                    <strong>Test failed:</strong> {testResult.error || 'Unknown error'}
                                    <div className="text-[11px] text-rose-300/80 mt-2">
                                        Common causes: wrong URL, scenario not turned on in Make, scenario expects different HTTP method.
                                    </div>
                                </div>
                            )}
                            {testResult?.ok && (
                                <div className="rounded-lg border border-[#7fb5aa]/30 bg-[#7fb5aa]/[0.08] p-3 text-xs text-[#a5cec6]">
                                    <strong>✓ Test ping accepted.</strong> Now open your Make / Zapier <strong>scenario run history</strong> and confirm the test event appears there. If it doesn't, your scenario isn't turned on — that's the most common gotcha.
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="flex items-center justify-between p-4 border-t border-white/10 bg-black/20 shrink-0">
                    <Button variant="secondary" className="text-xs h-9" onClick={onClose}>
                        Cancel
                    </Button>
                    {step === 1 ? (
                        <Button className="text-xs h-9" onClick={() => setStep(2)}>
                            Next <ChevronRight size={14} className="ml-1" />
                        </Button>
                    ) : (
                        <Button
                            className="text-xs h-9 bg-amber-500 hover:bg-amber-400 text-black font-semibold"
                            onClick={handleSave}
                            isLoading={saving || testing}
                            disabled={!url.trim()}
                        >
                            {testing ? 'Testing…' : saving ? 'Saving…' : 'Save & test'}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
