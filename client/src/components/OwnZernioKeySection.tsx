import { useEffect, useId, useState } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

export interface OwnZernioKey {
    hint: string;
    accountId: string;
    username: string;
}

interface OwnAccount {
    accountId: string;
    username: string;
}

interface Props {
    ownKey: OwnZernioKey | null;
    /** Reload the card's status after a change. */
    onChange: () => Promise<void> | void;
}

const accountLabel = (a: OwnAccount) => (a.username ? `@${a.username}` : a.accountId);

/**
 * "Bring your own Zernio": the user pastes an API key from their own Zernio
 * account, and BibleFuel posts to a TikTok on it. Open to everyone, since the
 * cost is on their Zernio bill. The key is never shown again: the server
 * returns only its last 4 characters.
 */
export function OwnZernioKeySection({ ownKey, onChange }: Props) {
    const keyId = useId();
    const pickId = useId();
    const [apiKey, setApiKey] = useState('');
    const [saving, setSaving] = useState(false);
    const [accounts, setAccounts] = useState<OwnAccount[] | null>(null);
    const [choice, setChoice] = useState('');
    const [choosing, setChoosing] = useState(false);
    const [removing, setRemoving] = useState(false);

    const needsPick = Boolean(ownKey && !ownKey.accountId);

    // A key saved earlier with several TikToks on it: load them to pick from.
    useEffect(() => {
        if (!needsPick || accounts) return;
        let alive = true;
        void (async () => {
            const res = await api.get<{ accounts: OwnAccount[] }>('/api/social/tiktok/own-accounts');
            if (!alive) return;
            if (res.ok && res.data) {
                setAccounts(res.data.accounts);
                setChoice(res.data.accounts[0]?.accountId || '');
            } else {
                toast.error(res.error || 'Could not load the TikToks on your Zernio account');
            }
        })();
        return () => { alive = false; };
    }, [needsPick, accounts]);

    const saveKey = async () => {
        setSaving(true);
        try {
            const res = await api.post<{ accounts: OwnAccount[]; selected: string }>('/api/social/tiktok/own-key', { apiKey: apiKey.trim() });
            if (!res.ok || !res.data) {
                toast.error(res.error || 'Could not save your Zernio key');
                return;
            }
            setApiKey('');
            setAccounts(res.data.accounts);
            setChoice(res.data.accounts[0]?.accountId || '');
            if (res.data.selected) toast.success('TikTok connected through your Zernio account');
            else if (res.data.accounts.length === 0) toast.error('Your Zernio account has no TikTok connected yet. Connect one in Zernio, then come back.', { duration: 8000 });
            else toast.success('Key saved. Now choose which TikTok to post to.');
            await onChange();
        } finally {
            setSaving(false);
        }
    };

    const chooseAccount = async () => {
        setChoosing(true);
        try {
            const res = await api.post('/api/social/tiktok/own-account', { accountId: choice });
            if (res.ok) {
                toast.success('TikTok connected through your Zernio account');
                await onChange();
            } else {
                toast.error(res.error || 'Could not choose that TikTok');
            }
        } finally {
            setChoosing(false);
        }
    };

    const removeKey = async () => {
        if (!confirm('Remove your Zernio key from BibleFuel? Auto-publish to TikTok through it stops. Your TikTok stays connected in Zernio.')) return;
        setRemoving(true);
        try {
            const res = await api.post('/api/social/tiktok/own-key/remove');
            if (res.ok) {
                setAccounts(null);
                toast.success('Zernio key removed');
                await onChange();
            } else {
                toast.error(res.error || 'Could not remove the key');
            }
        } finally {
            setRemoving(false);
        }
    };

    if (ownKey) {
        return (
            <div className="mt-3 rounded-xl border border-white/10 p-4 space-y-3">
                <p className="text-xs text-content-secondary">
                    Using your own Zernio key ending <span className="font-mono text-white">{ownKey.hint}</span>
                    {ownKey.accountId && <> · posting to <strong className="text-white">{ownKey.username ? `@${ownKey.username}` : 'your TikTok'}</strong></>}
                </p>
                {needsPick && accounts && accounts.length > 0 && (
                    <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                        <div className="flex-1 min-w-0">
                            <label htmlFor={pickId} className="block text-xs text-content-secondary mb-1">Which TikTok should auto-publish post to?</label>
                            <Select id={pickId} value={choice} onChange={(e) => setChoice(e.target.value)}>
                                {accounts.map((a) => <option key={a.accountId} value={a.accountId}>{accountLabel(a)}</option>)}
                            </Select>
                        </div>
                        <Button className="text-xs h-9 px-4" onClick={chooseAccount} isLoading={choosing} disabled={!choice}>
                            Use this TikTok
                        </Button>
                    </div>
                )}
                {needsPick && accounts && accounts.length === 0 && (
                    <p className="text-xs text-content-secondary">
                        No TikTok is connected in your Zernio account yet. Connect one at zernio.com, then reload this page.
                    </p>
                )}
                <Button variant="secondary" className="text-xs h-9 px-3" onClick={removeKey} isLoading={removing}>
                    Remove key
                </Button>
            </div>
        );
    }

    return (
        <div className="mt-3 rounded-xl border border-white/10 p-4 space-y-2">
            <p className="text-sm font-medium text-white">Use your own Zernio account</p>
            <p className="text-xs text-content-secondary">
                Have a Zernio account with your TikTok connected? Create an API key with read-write permission in Zernio (Settings → API keys) and paste it here.
                Posts then go through your Zernio account, on your Zernio plan.
            </p>
            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                <div className="flex-1 min-w-0">
                    <label htmlFor={keyId} className="block text-xs text-content-secondary mb-1">Zernio API key</label>
                    <Input
                        id={keyId}
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="Paste your Zernio API key"
                    />
                </div>
                <Button className="text-xs h-9 px-4" onClick={saveKey} isLoading={saving} disabled={apiKey.trim().length < 16}>
                    Save key
                </Button>
            </div>
        </div>
    );
}
