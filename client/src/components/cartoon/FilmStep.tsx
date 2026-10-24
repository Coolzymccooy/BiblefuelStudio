/**
 * Step 5 of a cartoon: the film. This is where money is spent, so the price
 * is always in view before anything is ordered: the clips still to make,
 * their seconds and dollars, and what is left of this month's AI video cap.
 *
 * Ordering follows the server's answers (server/src/routes/cartoon.js):
 * BUDGET orders nothing and shows the server's sentence; OVER_BENCHMARK asks
 * a second time, naming the amount, and only then re-sends with
 * confirmOverBenchmark. Clips arrive while the page polls. Stop cancels the
 * shots not yet ordered; Retry re-orders the failed and refused shots and the
 * ones waiting on them; Re-make orders one finished shot again at its price
 * (the earlier clip stays in the library). Prices come from the server's
 * estimate, never from a rate kept in the client; a paid clip that is only
 * fetched again costs nothing and says so.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Square } from 'lucide-react';
import { cartoonApi } from '../../lib/cartoonApi';
import { isApiError } from '../../lib/apiError';
import type { CartoonErrorPayload, CartoonEstimate, CartoonMonth, CartoonProject } from '../../lib/cartoonTypes';
import { Button } from '../ui/Button';
import { money } from '../sceneScript/format';
import { FilmShotCard } from './FilmShotCard';
import { isDone, isInFlight, monthLeftUsd, priceOfShots, priceWords, rateUsdPerSec, retryShotIds, secs } from './film';

interface Props {
  project: CartoonProject;
  month: CartoonMonth | null;
  /** False when AI video is not set up on this server. */
  seedance: boolean;
  onSaved: (project: CartoonProject) => void;
  onNext: () => void;
}

/** An order the server held back as above the benchmark, waiting for a second yes. */
interface HeldOrder { only?: string[]; estimate: CartoonEstimate }

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * The price per second of clip and this month's spend, from an estimate over
 * every shot. Fetched again whenever a film run ends, so the month stays true.
 */
function usePricing(project: CartoonProject) {
  const [pricing, setPricing] = useState<{ rate: number | null; month: CartoonMonth } | null>(null);
  const ids = project.shots.map((s) => s.id);
  const signature = project.shots.map((s) => `${s.id}:${s.seconds}`).join(',');
  const filming = project.running.film;
  useEffect(() => {
    if (filming || !ids.length) return undefined;
    let live = true;
    cartoonApi.estimate(project.id, ids)
      .then((r) => { if (live) setPricing({ rate: rateUsdPerSec(r.estimate), month: r.month }); })
      // Without it the price falls back to the project's own estimate; nothing is ordered from here.
      .catch(() => {});
    return () => { live = false; };
    // `ids` is captured through `signature`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, signature, filming]);
  return pricing;
}

function EstimateLine({ estimate, left }: { estimate: CartoonEstimate; left: number | null }) {
  const refetch = estimate.refetch ?? 0;
  const parts = estimate.clips > 0 ? [plural(estimate.clips, 'clip'), `${secs(estimate.seconds)} s`, `about ${money(estimate.usd)}`] : [];
  if (refetch > 0) parts.push(`${plural(refetch, 'paid clip')} to fetch again`);
  if (estimate.clips > 0 && left !== null) parts.push(`${money(left)} left this month`);
  if (estimate.clips === 0) parts.push('no charge');
  return <p className="text-sm font-medium tabular-nums text-bf-cream">{parts.join(' · ')}</p>;
}

function HeldOrderNote({ held, busy, onYes, onNo }: { held: HeldOrder; busy: boolean; onYes: () => void; onNo: () => void }) {
  const { usd, totalUsd, benchmarkUsd } = held.estimate;
  return (
    <div role="group" aria-label="Confirm the order" className="space-y-3 rounded-lg border border-editor-line bg-bf-input p-3">
      <p className="flex items-start gap-2 text-sm tabular-nums text-bf-cream">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-bf-warn" aria-hidden="true" />
        This order costs about {money(usd)} and brings this cartoon to about {money(totalUsd)}, above the {money(benchmarkUsd)} benchmark.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onNo} disabled={busy}>Not now</Button>
        <Button onClick={onYes} isLoading={busy}>Yes, order for about {money(usd)}</Button>
      </div>
    </div>
  );
}

export function FilmStep({ project, month, seedance, onSaved, onNext }: Props) {
  const [busy, setBusy] = useState<'order' | 'stop' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [held, setHeld] = useState<HeldOrder | null>(null);
  const [stopping, setStopping] = useState(false);
  const pricing = usePricing(project);

  const { shots, estimate, running } = project;
  const filming = running.film;
  useEffect(() => { if (!filming) setStopping(false); }, [filming]);

  const rate = pricing?.rate ?? rateUsdPerSec(estimate);
  const left = monthLeftUsd(pricing?.month ?? month);
  const doneCount = shots.filter(isDone).length;
  const retryIds = retryShotIds(shots);
  const retryUsd = priceOfShots(shots.filter((s) => retryIds.includes(s.id)), rate);
  const blocked = !seedance || running.render || project.blockers.length > 0;
  const locked = blocked || filming || busy !== null || held !== null;

  const order = async (only?: string[], confirmOverBenchmark = false) => {
    setBusy('order');
    setProblem(null);
    setHeld(null);
    try {
      onSaved(await cartoonApi.film(project.id, { ...(only ? { only } : {}), ...(confirmOverBenchmark ? { confirmOverBenchmark } : {}) }));
    } catch (e) {
      const over = isApiError(e) && e.code === 'OVER_BENCHMARK' && !confirmOverBenchmark ? (e.payload as CartoonErrorPayload).estimate : undefined;
      if (over) setHeld({ only, estimate: over });
      else setProblem(e instanceof Error ? e.message : 'Could not start the film.');
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy('stop');
    setProblem(null);
    try {
      setStopping((await cartoonApi.cancelFilm(project.id)).stopping);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not stop the film.');
    } finally {
      setBusy(null);
    }
  };

  const action = (() => {
    if (filming) {
      return <Button variant="ghost" onClick={stop} isLoading={busy === 'stop'} disabled={stopping}><Square size={14} aria-hidden="true" /> Stop</Button>;
    }
    if (retryIds.length) {
      return (
        <Button
          onClick={() => order(retryIds)}
          isLoading={busy === 'order'}
          disabled={locked}
          aria-label={`Retry ${plural(retryIds.length, 'shot')}${retryUsd !== null ? `, ${priceWords(retryUsd)}` : ''}`}
        >
          Retry {plural(retryIds.length, 'shot')}
          {retryUsd !== null && <span className="tabular-nums">{priceWords(retryUsd)}</span>}
        </Button>
      );
    }
    if (estimate.clips > 0) {
      return <Button onClick={() => order()} isLoading={busy === 'order'} disabled={locked}>Make the film</Button>;
    }
    return null;
  })();

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-card border border-editor-line bg-bf-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            {estimate.clips > 0 || (estimate.refetch ?? 0) > 0
              ? <EstimateLine estimate={estimate} left={left} />
              : <p className="text-sm font-medium text-bf-cream">Every shot has a clip.</p>}
            <p className="text-help tabular-nums">
              {doneCount} of {plural(shots.length, 'shot')} done{estimate.spentUsd > 0 ? ` · this cartoon so far ${money(estimate.spentUsd)}` : ''}
            </p>
          </div>
          {action}
        </div>
        {estimate.overBenchmark && estimate.clips > 0 && !filming && (
          <p className="flex items-start gap-2 text-xs tabular-nums text-bf-warn">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            About {money(estimate.totalUsd)} in all, above the {money(estimate.benchmarkUsd)} benchmark per cartoon.
          </p>
        )}
        {!seedance && <p className="text-sm text-bf-danger">AI video is not set up on this server.</p>}
        {running.render && <p className="text-help">Wait for the render to finish before ordering clips.</p>}
        {project.blockers.length > 0 && (
          <ul className="space-y-1">{project.blockers.map((b) => <li key={b} className="text-sm text-bf-danger">{b}</li>)}</ul>
        )}
        {filming && (
          <p className="text-help" aria-live="polite">
            {stopping
              ? 'Stopping. Shots not yet ordered are skipped; clips already ordered still arrive.'
              : `Making the film. ${shots.filter((s) => isInFlight(s.clip)).length} on the way; clips appear here as they arrive.`}
          </p>
        )}
        {held && <HeldOrderNote held={held} busy={busy === 'order'} onYes={() => order(held.only, true)} onNo={() => setHeld(null)} />}
        {problem && <p role="alert" className="text-sm text-bf-danger">{problem}</p>}
      </div>

      <p className="text-help">Re-making a shot never deletes the clip you paid for. It stays in your visual library.</p>
      <ol aria-label="Shots" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shots.map((shot, index) => (
          <FilmShotCard
            key={shot.id}
            shot={shot}
            index={index}
            remakeUsd={priceOfShots([shot], rate)}
            disabled={locked}
            onRemake={(id) => { void order([id]); }}
          />
        ))}
      </ol>

      {shots.length > 0 && doneCount === shots.length && (
        <div className="flex justify-end border-t border-editor-line pt-4">
          <Button onClick={onNext} disabled={filming}>Next <ArrowRight size={16} aria-hidden="true" /></Button>
        </div>
      )}
    </div>
  );
}
