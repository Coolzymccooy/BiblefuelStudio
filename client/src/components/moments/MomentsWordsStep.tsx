import { useState } from 'react';
import { ArrowUp, ArrowDown, Trash2, Sparkles, Loader2 } from 'lucide-react';
import { momentsApi } from '../../lib/momentsApi';
import { statementLimit, statementOverflow, verseStatement } from '../../lib/momentsWizard';
import { toastError } from '../../lib/errors';
import type { MomentPatch, MomentSuggestion } from '../../lib/momentsTypes';
import type { MomentStepProps } from '../../pages/MomentsPage';
import { fieldLabelCls, inputCls, panelCls, secondaryBtnCls } from '../story/formStyles';

export function MomentsWordsStep({ project, meta, refresh, busy, setBusy }: MomentStepProps) {
  // Local state is authoritative while mounted: a refetch after a save must never overwrite what is being
  // typed. It is replaced only by an explicit action (Suggest/Reshuffle, or a save that succeeded), and the
  // page keys this step by projectId so opening another Moment starts from its own words.
  const [title, setTitle] = useState(project.title);
  const [drafts, setDrafts] = useState(project.statements);
  const [suggesting, setSuggesting] = useState(false);
  const [verse, setVerse] = useState<MomentSuggestion['verse']>();
  const [extra, setExtra] = useState('');
  const limit = statementLimit(project.lengthSec, meta);
  const overflow = statementOverflow(project, meta);

  // The server copy is the truth for list changes: each action builds from project.statements.
  const list = project.statements;
  const atLengthLimit = list.length >= limit;

  /** Saves a patch and mirrors it into local state once the server has accepted it. */
  const persist = async (patch: MomentPatch) => {
    await momentsApi.update(project.projectId, patch);
    if (patch.title !== undefined) setTitle(patch.title);
    if (patch.statements) setDrafts(patch.statements);
    refresh();
  };

  /** A user edit: held busy while it saves; a refusal is toasted. Resolves true when saved. */
  const save = async (patch: MomentPatch): Promise<boolean> => {
    setBusy(true);
    try {
      await persist(patch);
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const suggest = async () => {
    setSuggesting(true);
    setBusy(true);
    try {
      const s = await momentsApi.suggest(project.projectId);
      setVerse(s.verse);
      await persist({ title: s.title, statements: s.statements });
    } catch (e) {
      toastError(e);
    } finally {
      setSuggesting(false);
      setBusy(false);
    }
  };

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    save({ statements: next });
  };

  const commitStatement = (i: number) => {
    const v = drafts[i].trim();
    // The server refuses an empty statement, so an emptied field goes back to what it was.
    if (!v) {
      setDrafts(drafts.map((d, k) => (k === i ? (list[i] ?? d) : d)));
      return;
    }
    if (v !== list[i]) save({ statements: list.map((d, k) => (k === i ? v : d)) });
  };

  const addExtra = async () => {
    const v = extra.trim();
    if (!v || busy) return;
    if (await save({ statements: [...list, v] })) setExtra('');
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
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { if (title.trim() !== project.title) save({ title: title.trim() }); }}
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
                onChange={(e) => setDrafts(drafts.map((d, k) => (k === i ? e.target.value : d)))}
                onBlur={() => commitStatement(i)}
                className={`${inputCls} mt-0 flex-1 ${i >= limit ? 'opacity-50' : ''}`}
              />
              <button type="button" aria-label={`Move statement ${i + 1} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
              <button type="button" aria-label={`Move statement ${i + 1} down`} disabled={busy || i === drafts.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
              <button type="button" aria-label={`Delete statement ${i + 1}`} disabled={busy} onClick={() => save({ statements: list.filter((_, k) => k !== i) })}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        {list.length < meta.limits.maxStatements && (
          <input
            aria-label="New statement"
            value={extra}
            maxLength={meta.limits.statement}
            placeholder="Add a statement and press Enter"
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
            onClick={() => save({ statements: [...list, verseStatement(verse, meta.limits.statement)] })}
          >
            Add {verse.reference}
          </button>
          {atLengthLimit && <p className="text-help mt-1">Already at the {limit} this length shows. Remove one or pick a longer length to add this.</p>}
        </div>
      )}
    </div>
  );
}
