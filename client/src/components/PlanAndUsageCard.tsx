import { useEffect, useState } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import { Zap, ShieldCheck, Loader2 } from 'lucide-react';

interface UsageBucket {
    used: number;
    limit: number;
    unlimited: boolean;
    remaining: number | null;
}

interface PlanState {
    plan: 'super_admin' | 'free' | 'premium' | string;
    isSuperAdmin: boolean;
    stripeConfigured: boolean;
    record: {
        plan: string;
        status: string;
        stripeCustomerId: string | null;
        stripeSubscriptionId: string | null;
        currentPeriodEnd: string | null;
    };
    usage: {
        day: string;
        plan: string;
        buckets: Record<string, UsageBucket>;
    };
}

const BUCKET_LABELS: Record<string, string> = {
    scripts: 'Scripts',
    tts: 'Voice / TTS',
    render: 'Video renders',
    imageGen: 'AI images',
};

export function PlanAndUsageCard() {
    const [state, setState] = useState<PlanState | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<'checkout' | 'portal' | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const res = await api.get('/api/billing/plan');
            if (cancelled) return;
            if (res.ok) {
                setState(res.data as PlanState);
            } else {
                toast.error(res.error || 'Could not load plan');
            }
            setLoading(false);
        };
        load();
        return () => { cancelled = true; };
    }, []);

    const startCheckout = async () => {
        setBusy('checkout');
        const res = await api.post('/api/billing/checkout', {
            successUrl: `${window.location.origin}/settings?upgrade=success`,
            cancelUrl: `${window.location.origin}/settings?upgrade=cancel`,
        });
        setBusy(null);
        if (res.ok && res.data?.url) {
            window.location.href = res.data.url as string;
            return;
        }
        if (res.error === 'PAYMENTS_NOT_CONFIGURED') {
            toast.error('Payments are not configured yet on this server.');
        } else {
            toast.error(res.error || 'Could not start checkout');
        }
    };

    const openPortal = async () => {
        setBusy('portal');
        const res = await api.post('/api/billing/portal', {
            returnUrl: `${window.location.origin}/settings`,
        });
        setBusy(null);
        if (res.ok && res.data?.url) {
            window.location.href = res.data.url as string;
            return;
        }
        toast.error(res.error || 'Could not open billing portal');
    };

    if (loading) {
        return (
            <Card>
                <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Loader2 size={16} className="animate-spin" />
                    Loading plan...
                </div>
            </Card>
        );
    }

    if (!state) return null;

    const planLabel = state.isSuperAdmin
        ? 'Super-admin'
        : state.plan === 'premium'
            ? 'Premium'
            : 'Free';

    return (
        <Card>
            <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                    <div className="flex items-center gap-2">
                        {state.isSuperAdmin ? (
                            <ShieldCheck size={18} className="text-emerald-400" />
                        ) : state.plan === 'premium' ? (
                            <Zap size={18} className="text-amber-400" />
                        ) : (
                            <Zap size={18} className="text-gray-500" />
                        )}
                        <h3 className="text-lg font-semibold text-gray-100">{planLabel} plan</h3>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                        Daily quotas reset at midnight UTC.
                    </p>
                </div>
                <div className="flex gap-2">
                    {!state.isSuperAdmin && state.plan !== 'premium' && (
                        <Button onClick={startCheckout} disabled={busy !== null}>
                            {busy === 'checkout' ? (
                                <Loader2 size={14} className="mr-2 animate-spin" />
                            ) : (
                                <Zap size={14} className="mr-2" />
                            )}
                            Upgrade
                        </Button>
                    )}
                    {!state.isSuperAdmin && state.record.stripeCustomerId && (
                        <Button variant="ghost" onClick={openPortal} disabled={busy !== null}>
                            Billing
                        </Button>
                    )}
                </div>
            </div>

            <div className="space-y-3">
                {Object.entries(state.usage?.buckets || {}).map(([key, b]) => {
                    const label = BUCKET_LABELS[key] || key;
                    const pct = b.unlimited
                        ? 100
                        : b.limit > 0 ? Math.min(100, Math.round((b.used / b.limit) * 100)) : 0;
                    const over = !b.unlimited && b.used >= b.limit;
                    return (
                        <div key={key}>
                            <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-gray-300">{label}</span>
                                <span className={over ? 'text-red-400' : 'text-gray-500'}>
                                    {b.unlimited ? 'Unlimited' : `${b.used} / ${b.limit}`}
                                </span>
                            </div>
                            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                                <div
                                    className={`h-full transition-all ${over
                                            ? 'bg-red-500/70'
                                            : b.unlimited
                                                ? 'bg-emerald-500/40'
                                                : pct > 80
                                                    ? 'bg-amber-400/70'
                                                    : 'bg-primary-400/70'
                                        }`}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>

            {!state.stripeConfigured && !state.isSuperAdmin && (
                <p className="text-xs text-gray-500 mt-4">
                    Payments are not enabled yet — upgrade button is hidden until then.
                </p>
            )}
        </Card>
    );
}
