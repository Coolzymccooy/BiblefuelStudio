import { useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Trash2, Sparkles, Loader2 } from 'lucide-react';
import { momentsApi } from '../../lib/momentsApi';
import { statementLimit, verseStatement } from '../../lib/momentsWizard';
import { toastError } from '../../lib/errors';
import type { MomentPatch, MomentSuggestion } from '../../lib/momentsTypes';
import type { MomentStepProps } from '../../pages/MomentsPage';
import { fieldLabelCls, inputCls, panelCls, secondaryBtnCls } from '../story/formStyles';

interface Words {
  title: string;
  statements: string[];
}

export function MomentsWordsStep({ project, meta, refresh, busy, setBusy, track }: MomentStepProps) {
  // Local state is authoritative while mounted: a refetch after a save must never overwrite what is being
  // typed. The page keys this step by projectId so opening another Moment starts from its own words.
  const [title, setTitle] = useState(project.title);
  const [drafts, setDrafts] = useState(project.statements);
  // What the server has accepted, updated the moment a save succeeds. project.* lags until the refetch lands,
  // so every list action builds from this and never from the project.
  const committedRef = useRef<Words>({ title: project.title, statements: project.statements });
  const [committed, setCommitted] = useState<Words>(committedRef.current);
  // Saves run one at a time so each builds from the result of the one before.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const [suggesting, setSuggesting] = useState(false);
  // A structural change (move, delete, add) replaces the whole list, so typing waits for it.
  const [structural, setStructural] = useState(false);
  const [verse, setVerse] = useState<MomentSuggestion['verse']>();
  const [extra, setExtra] = useState('');
  const limit = statementLimit(project.lengthSec, meta);
  const list = committed.statements;
  const overflow = Math.max(0, list.length - limit);
  const atLengthLimit = list.length >= limit;
  const locked = structural || suggesting;

  /** Saves a patch, records it as committed, then lets the caller mirror it into local state. */
  const persist = async (patch: MomentPatch, applyLocal: () => void) => {
    await momentsApi.update(project.projectId, patch);
    committedRef.current = {
      title: patch.title ?? committedRef.current.title,
      statements: patch.statements ?? committedRef.current.statements,
    };
    setCommitted(committedRef.current);
    applyLocal();
    refresh();
  };

  /**
   * Queues a save built from the latest committed words (null skips it). Held busy while it runs; a refusal is
   * toasted. Resolves true when saved.
   */
  const save = (
    build: (c: Words) => MomentPatch | null,
    applyLocal: (patch: MomentPatch) => void,
    isStructural = false,
  ): Promise<boolean> => {
    const run = chain.current.then(async () => {
      const patch = build(committedRef.current);
      if (!patch) return true;
      setBusy(true);
      if (isStructural) setStructural(true);
      try {
        await persist(patch, () => applyLocal(patch));
        return true;
      } catch (e) {
        toastError(e);
        return false;
      } finally {
        setBusy(false);
        if (isStructural) setStructural(false);
      }
    });
    chain.current = run;
    track(run);
    return run;
  };

  const saveList = (next: (c: string[]) => string[]) =>
    save((c) => ({ statements: next(c.statements) }), (p) => setDrafts(p.statements ?? []), true);

  const suggest = async () => {
    setSuggesting(true);
    setBusy(true);
    try {
      const s = await momentsApi.suggest(project.projectId);
      setVerse(s.verse);
      await persist({ title: s.title, statements: s.statements }, () => { setTitle(s.title); setDrafts(s.statements); });
    } catch (e) {
      toastError(e);
    } finally {
      setSuggesting(false);
      setBusy(false);
    }
  };

  const move = (i: number, d: number) => saveList((c) => {
    const j = i + d;
    if (j < 0 || j >= c.length) return c;
    const next = [...c];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const commitStatement = (i: number) => {
    const v = drafts[i].trim();
    const was = committedRef.current.statements[i];
    // The server refuses an empty statement, so an emptied field goes back to what it was.
    if (!v) {
      if (was !== undefined) setDrafts((cur) => cur.map((d, k) => (k === i ? was : d)));
      return;
    }
    // Only this field is touched afterwards: whatever is being typed elsewhere survives the save.
    save(
      (c) => (v === c.statements[i] ? null : { statements: c.statements.map((d, k) => (k === i ? v : d)) }),
      () => setDrafts((cur) => cur.map((d, k) => (k === i ? v : d))),
    );
  };

  const commitTitle = () => {
    const t = title.trim();
    save((c) => (t === c.title ? null : { title: t }), () => {});
  };

  const addExtra = async () => {
    const v = extra.trim();
    if (!v || locked) return;
    if (await saveList((c) => [...c, v])) setExtra('');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondaryBtnCls} disabled={busy || suggesting} onClick={suggest}>
          {suggesting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {list.length ? 'Reshuffle' : 'Suggest'}
        </button>
        <span className="text-help">The AI writes from your occasion and details. Edit anything.</span>
      </div>

      <label className={fieldLabelCls}>
        Title
        <input
          value={title}
          maxLength={meta.limits.title}
          disabled={locked}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          className={inputCls}
        />
      </label>

      <div className={panelCls}>
        <div className="field-label">Statements ({list.length}/{limit} for {project.lengthSec} s)</div>
        {overflow > 0 && (
          <p className="mt-1 text-sm text-amber-300">This length shows {limit} statements, so only the first {limit} are used.</p>
        )}
        <div className="mt-2 space-y-2">
          {drafts.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                aria-label={`Statement ${i + 1}`}
                value={s}
                maxLength={meta.limits.statement}
                disabled={locked}
                onChange={(e) => setDrafts((cur) => cur.map((d, k) => (k === i ? e.target.value : d)))}
                onBlur={() => commitStatement(i)}
                className={`${inputCls} mt-0 flex-1 ${i >= limit ? 'opacity-50' : ''}`}
              />
              <button type="button" aria-label={`Move statement ${i + 1} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
              <button type="button" aria-label={`Move statement ${i + 1} down`} disabled={busy || i === drafts.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
              <button type="button" aria-label={`Delete statement ${i + 1}`} disabled={busy} onClick={() => saveList((c) => c.filter((_, k) => k !== i))}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        {list.length < meta.limits.maxStatements && (
          <input
            aria-label="New statement"
            value={extra}
            maxLength={meta.limits.statement}
            placeholder="Add a statement and press Enter"
            disabled={locked}
            onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addExtra(); }}
            className={`${inputCls} mt-2`}
          />
        )}
      </div>

      {verse && (
        <div className={panelCls}>
          <div className="field-label">Scripture</div>
          <p className="text-sm text-bf-cream">“{verse.text}” {verse.reference}</p>
          <button
            type="button"
            className={`${secondaryBtnCls} mt-2`}
            disabled={busy || atLengthLimit || list.length >= meta.limits.maxStatements}
            onClick={() => saveList((c) => [...c, verseStatement(verse, meta.limits.statement)])}
          >
            Add {verse.reference}
          </button>
          {atLengthLimit && <p className="text-help mt-1">Already at the {limit} this length shows. Remove one or pick a longer length to add this.</p>}
        </div>
      )}
    </div>
  );
}
