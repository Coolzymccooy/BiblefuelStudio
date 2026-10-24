import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { money } from '../sceneScript/format';
import { toastError } from '../../lib/errors';
import { isApiError } from '../../lib/apiError';
import { visualLibraryApi } from '../../lib/sceneScriptApi';
import type { LibraryClip, MonthSpend, RerollJob, RerollPrice } from '../../lib/sceneScriptTypes';

interface Props {
  clip: LibraryClip;
  onClose: () => void;
  onStarted: (job: RerollJob) => void;
}

/** Order a new clip from a library clip's prompt. The price is shown, and sent back, before anything is paid for. */
export function RerollPanel({ clip, onClose, onStarted }: Props) {
  const [prompt, setPrompt] = useState(clip.prompt || '');
  const [price, setPrice] = useState<RerollPrice | null>(null);
  const [month, setMonth] = useState<MonthSpend | null>(null);
  const [ready, setReady] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let current = true;
    visualLibraryApi.rerollPrice(clip.id)
      .then((r) => { if (current) { setPrice(r.price); setMonth(r.month); setReady(r.seedance); } })
      .catch((e) => { if (current) toastError(e); });
    return () => { current = false; };
  }, [clip.id]);

  const order = async () => {
    if (!price) return;
    setBusy(true);
    setProblem('');
    try {
      onStarted(await visualLibraryApi.reroll(clip.id, { prompt: prompt.trim(), expectUsd: price.usd }));
    } catch (e) {
      const next = isApiError(e) ? (e.payload?.price as RerollPrice | undefined) : undefined;
      if (isApiError(e) && e.code === 'PRICE_CHANGED' && next) {
        setPrice(next);
        setProblem(e.message);
      } else if (isApiError(e) && e.code) {
        setProblem(e.message);
      } else {
        toastError(e);
      }
    } finally {
      setBusy(false);
    }
  };

  const used = month ? month.spentUsd + month.reservedUsd : 0;
  return (
    <section aria-labelledby="reroll-title" className="space-y-3 rounded-card border border-editor-line bg-bf-card p-4">
      <div className="flex gap-3">
        {clip.posterUrl && <img src={clip.posterUrl} alt="" className="h-20 w-auto shrink-0 rounded object-cover" />}
        <div className="min-w-0 space-y-1">
          <h2 id="reroll-title" className="text-base font-semibold text-bf-cream">Re-roll from this prompt</h2>
          <p className="text-help">A new clip is made and kept beside this one. Edit the prompt to change what it shows.</p>
        </div>
      </div>
      <div>
        <label htmlFor="reroll-prompt" className="field-label">Prompt for the new clip</label>
        <Textarea id="reroll-prompt" rows={4} maxLength={1500} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="What the new clip should show" />
      </div>
      {price ? (
        <p className="text-sm tabular-nums text-bf-sub">
          A new {price.seconds} s clip costs about {money(price.usd)}.
          {month && <> {money(used)} of {money(month.capUsd)} used this month.</>}
        </p>
      ) : (
        <p className="text-help">Getting the price…</p>
      )}
      {!ready && <p className="text-sm text-bf-danger" role="alert">AI video is not set up on this server.</p>}
      {problem && <p className="text-sm text-bf-danger" role="alert">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!price || !ready || busy || !prompt.trim()} onClick={() => { void order(); }}>
          {price ? `Re-roll for ${money(price.usd)}` : 'Re-roll'}
        </Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </section>
  );
}
