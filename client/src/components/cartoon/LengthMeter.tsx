/**
 * The live length and price of a cartoon script, under the editor. The script
 * is read by the server (the same parser that saves it) 600 ms after typing
 * stops, so the meter never disagrees with what Next will accept. Only the
 * newest answer is shown: a slow reply for older text is dropped.
 */
import { useEffect, useRef, useState } from 'react';
import { cartoonApi } from '../../lib/cartoonApi';
import type { CartoonCheck } from '../../lib/cartoonTypes';
import { money } from '../sceneScript/format';

export const MAX_FILM_SEC = 40;
const DEBOUNCE_MS = 600;
const QUOTE_WORDS = 6;

export type ParseResult = Awaited<ReturnType<typeof cartoonApi.parse>>;

export interface LengthState {
  status: 'empty' | 'checking' | 'ready' | 'error';
  /** The newest answer; while re-checking it is the answer for the previous text. */
  result: ParseResult | null;
  error: string | null;
}

/** The fit rule Next obeys: within 40 s, at most 8 shots, no line too long to speak in one shot. */
export function checkFits(check: CartoonCheck): boolean {
  return check.ok && !check.tooMany && check.tooLong.length === 0;
}

/** True when the current text has been read, fits, and has something to film. */
export function readyToSave(state: LengthState): boolean {
  return state.status === 'ready' && state.result !== null
    && checkFits(state.result.check) && state.result.preview.shots.length > 0;
}

/** Reads the script 600 ms after the last change; stale replies are ignored. */
export function useLengthCheck(markdown: string): LengthState {
  const [answer, setAnswer] = useState<{ text: string; result: ParseResult | null; error: string | null }>({ text: '', result: null, error: null });
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    if (!markdown.trim()) return undefined;
    const timer = setTimeout(() => {
      cartoonApi.parse(markdown).then(
        (result) => { if (mine === seq.current) setAnswer({ text: markdown, result, error: null }); },
        (e: unknown) => {
          if (mine !== seq.current) return;
          setAnswer((prev) => ({ text: markdown, result: prev.result, error: e instanceof Error ? e.message : 'Could not read the script.' }));
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [markdown]);

  // A reply landing after unmount is dropped like any other stale reply.
  useEffect(() => () => { seq.current += 1; }, []);

  if (!markdown.trim()) return { status: 'empty', result: null, error: null };
  if (answer.text !== markdown) return { status: 'checking', result: answer.result, error: null };
  if (answer.error) return { status: 'error', result: answer.result, error: answer.error };
  return { status: 'ready', result: answer.result, error: null };
}

const seconds = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function quote(line: string) {
  const words = line.trim().split(/\s+/);
  return words.length > QUOTE_WORDS ? `${words.slice(0, QUOTE_WORDS).join(' ')}…` : line.trim();
}

function Problems({ result }: { result: ParseResult }) {
  const { check, preview } = result;
  const byId = new Map(preview.shots.map((s) => [s.id, s]));
  const notes = [...preview.warnings, ...preview.source.warnings];
  return (
    <>
      {!check.ok && check.trimScene && (
        <p className="text-sm text-bf-danger">{seconds(check.overBySec)} s over: trim "{check.trimScene.place}"</p>
      )}
      {!check.ok && !check.trimScene && (
        <p className="text-sm text-bf-danger">{seconds(check.overBySec)} s over: trim a scene</p>
      )}
      {check.tooMany && (
        <p className="text-sm text-bf-danger tabular-nums">{preview.shots.length} shots. A film has at most 8, so trim a scene.</p>
      )}
      {check.tooLong.length > 0 && (
        <ul className="space-y-1" aria-label="Lines too long for one shot">
          {check.tooLong.map((t) => {
            const shot = byId.get(t.shotId);
            return (
              <li key={t.shotId} className="text-sm text-bf-danger tabular-nums">
                {shot?.speaker ? `${shot.speaker}: ` : ''}"{quote(shot?.line ?? '')}" is {t.words} words. Split it into two lines.
              </li>
            );
          })}
        </ul>
      )}
      {preview.shots.length === 0 && (
        <p className="text-help">Add a Scene: line and a spoken line to start.</p>
      )}
      {preview.source.ignored.length > 0 && (
        <ul className="space-y-1" aria-label="Lines not used">
          {preview.source.ignored.map((l) => (
            <li key={l.lineNo} className="text-sm text-bf-warn tabular-nums">Line {l.lineNo} not used: {l.reason}</li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="space-y-1">
          {notes.map((w) => <li key={w} className="text-sm text-bf-warn">{w}</li>)}
        </ul>
      )}
    </>
  );
}

/** Length out of 40 s, the price of the clips and portraits, and what to fix. */
export function LengthMeter({ state }: { state: LengthState }) {
  const { result } = state;
  if (state.status === 'empty' || !result) {
    return (
      <div aria-live="polite" className="space-y-2">
        {state.status === 'error' && <p role="alert" className="text-sm text-bf-danger">{state.error}</p>}
        {state.status === 'checking' && <p className="text-help">Checking the length…</p>}
        {state.status === 'empty' && <p className="text-help">Paste or write a script to see its length and price. A film runs up to 40 seconds.</p>}
      </div>
    );
  }
  const { check, estimate } = result;
  const over = !checkFits(check);
  const pct = Math.min(100, (check.filmSec / MAX_FILM_SEC) * 100);
  return (
    <div aria-live="polite" className={`space-y-2 transition-opacity duration-150 ${state.status === 'checking' ? 'opacity-70' : ''}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium tabular-nums text-bf-cream">{seconds(check.filmSec)} s of {MAX_FILM_SEC}</span>
        <span className="text-sm tabular-nums text-bf-sub">
          {state.status === 'checking' ? 'Checking…' : `about ${money(estimate.usd + estimate.imageUsd)}`}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-bf-input"
        role="meter" aria-label="Film length" aria-valuemin={0} aria-valuemax={MAX_FILM_SEC} aria-valuenow={check.filmSec}
        aria-valuetext={`${seconds(check.filmSec)} seconds of ${MAX_FILM_SEC}`}
      >
        <div className={`h-full transition-[width] duration-200 ${over ? 'bg-bf-danger' : 'bg-accent-fill'}`} style={{ width: `${pct}%` }} />
      </div>
      {state.status === 'error' && <p role="alert" className="text-sm text-bf-danger">{state.error}</p>}
      <Problems result={result} />
    </div>
  );
}
