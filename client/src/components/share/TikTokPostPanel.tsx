/**
 * Post one finished video to the user's own TikTok, now. It uses the TikTok
 * that Settings connects (TikTokConnectCard: through Zernio, the server's
 * account for the owner, else the user's own) and the existing
 * POST /api/social/post route with destination "tiktok", which posts through
 * Zernio only and never fires a Make or Zapier webhook. With no TikTok
 * connected it points to Settings rather than starting a second connect flow.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Music2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';

interface Props {
  videoUrl: string;
  caption: string;
  title: string;
}

interface TikTokStatus {
  connected: boolean;
  username: string;
}

interface PostAnswer {
  results?: Array<{ destination: string; ok: boolean; error?: string; draft?: boolean }>;
}

type Outcome = { ok: true; draft: boolean } | { ok: false; error: string };

const SETTINGS_PATH = '/app/settings';

function useTikTokStatus(): TikTokStatus | 'failed' | null {
  const [status, setStatus] = useState<TikTokStatus | 'failed' | null>(null);
  useEffect(() => {
    let live = true;
    api.get<TikTokStatus>('/api/social/tiktok/status')
      .then((res) => { if (live) setStatus(res.ok && res.data ? res.data : 'failed'); })
      .catch(() => { if (live) setStatus('failed'); });
    return () => { live = false; };
  }, []);
  return status;
}

function OutcomeLine({ outcome }: { outcome: Outcome }) {
  if (!outcome.ok) return <p role="alert" className="text-sm text-bf-danger">{outcome.error}</p>;
  return (
    <p role="status" className="inline-flex items-center gap-1 text-sm text-bf-sub">
      <Check size={14} aria-hidden="true" />
      {outcome.draft
        ? 'Sent to your TikTok inbox as a draft, because TikTok was busy. Open the TikTok app to post it.'
        : 'Posted to TikTok.'}
    </p>
  );
}

export function TikTokPostPanel({ videoUrl, caption, title }: Props) {
  const status = useTikTokStatus();
  const [posting, setPosting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // State updates land after the next render; the ref stops a second click before then.
  const inFlight = useRef(false);

  const post = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPosting(true);
    setOutcome(null);
    try {
      const res = await api.post<PostAnswer>('/api/social/post', { destination: 'tiktok', videoUrl, caption, title });
      const tiktok = res.data?.results?.find((r) => r.destination === 'tiktok');
      setOutcome(res.ok && tiktok?.ok
        ? { ok: true, draft: tiktok.draft === true }
        : { ok: false, error: res.error || tiktok?.error || 'Could not post to TikTok.' });
    } catch {
      setOutcome({ ok: false, error: 'Could not post to TikTok.' });
    } finally {
      inFlight.current = false;
      setPosting(false);
    }
  };

  const connected = status !== null && status !== 'failed' && status.connected;
  const posted = outcome?.ok === true;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-bf-cream">TikTok</h3>
      {status === null && <p className="text-help">Checking your TikTok connection…</p>}
      {status === 'failed' && <p className="text-help">Your TikTok connection could not be checked. Refresh the page to try again.</p>}
      {status !== null && status !== 'failed' && !status.connected && (
        <p className="text-help">
          No TikTok is connected yet. <a href={SETTINGS_PATH} className="underline hover:text-bf-cream">Connect TikTok in Settings</a>, then come back to post this film.
        </p>
      )}
      {connected && (
        <>
          <p className="text-help">
            Posts the film with the caption above to {status.username ? `@${status.username}` : 'your TikTok'}, straight away.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => { void post(); }} isLoading={posting} disabled={posting || posted}>
              {!posting && <Music2 size={16} aria-hidden="true" />} Post to TikTok
            </Button>
            {outcome && <OutcomeLine outcome={outcome} />}
          </div>
        </>
      )}
    </div>
  );
}
