import { useCallback, useEffect, useRef, useState } from 'react';
import { History, Search, X } from 'lucide-react';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { segmentCls, segmentedCls } from '../components/story/formStyles';
import { ImportClips } from '../components/sceneScript/ImportClips';
import { LibraryClipCard } from '../components/visualLibrary/LibraryClipCard';
import { RerollPanel } from '../components/visualLibrary/RerollPanel';
import { RerollJobs } from '../components/visualLibrary/RerollJobs';
import { useRerolls } from '../components/visualLibrary/useRerolls';
import { useAuth } from '../hooks/useAuth';
import { toastError } from '../lib/errors';
import { isApiError } from '../lib/apiError';
import { visualLibraryApi } from '../lib/sceneScriptApi';
import type { LibraryClip, LibraryLead } from '../lib/sceneScriptTypes';

const ASPECTS: { value: string; label: string }[] = [
  { value: '', label: 'All' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }, { value: 'square', label: 'Square' },
];
const PAGE_LIMIT = 200;
const shortLead = (lead: string) => (lead.length > 60 ? `${lead.slice(0, 57)}…` : lead);

function useLibrary() {
  const [q, setQ] = useState('');
  const [aspect, setAspect] = useState('');
  const [lead, setLead] = useState('');
  const [tag, setTag] = useState('');
  const [rating, setRating] = useState(0);
  const [clips, setClips] = useState<LibraryClip[] | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    // An answer to an older search must not replace a newer one.
    let current = true;
    const t = setTimeout(() => {
      visualLibraryApi.search(q, aspect || undefined, { lead: lead || undefined, tag: tag || undefined, rating: rating || undefined, limit: PAGE_LIMIT })
        .then((found) => { if (current) setClips(found); })
        .catch((e) => { if (current) { toastError(e); setClips([]); } });
    }, 250);
    return () => { current = false; clearTimeout(t); };
  }, [q, aspect, lead, tag, rating, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  return { q, setQ, aspect, setAspect, lead, setLead, tag, setTag, rating, setRating, clips, setClips, refresh };
}

/** Clips that came in without a poster get one, a batch at a time, refreshing as they arrive. */
function usePosters(clips: LibraryClip[] | null, refresh: () => void) {
  const running = useRef(false);
  const [wanted, setWanted] = useState(1);
  const tried = useRef(0);

  useEffect(() => {
    if (!clips || running.current || tried.current === wanted || !clips.some((c) => !c.posterUrl && !c.posterFailed)) return;
    tried.current = wanted;
    running.current = true;
    void (async () => {
      try {
        for (;;) {
          const r = await visualLibraryApi.makePosters();
          if (r.made) refresh();
          if (!r.remaining || !(r.made + r.failed)) break;
        }
      } catch (e) {
        toastError(e);
      } finally {
        running.current = false;
      }
    })();
  }, [clips, refresh, wanted]);

  return useCallback(() => setWanted((n) => n + 1), []);
}

/** Every clip paid for or imported: find, rate, tag and tidy them. Reusing one in a video costs nothing. */
function LibraryBrowser() {
  const lib = useLibrary();
  const { clips, setClips, refresh, lead, setLead } = lib;
  const [leads, setLeads] = useState<LibraryLead[] | null>(null);
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [rerolling, setRerolling] = useState<LibraryClip | null>(null);
  const makePostersAgain = usePosters(clips, refresh);

  const loadLeads = useCallback(() => {
    visualLibraryApi.leads()
      .then((list) => {
        setLeads(list);
        // A lead whose last clip went is no longer offered, so stop filtering by it.
        setLead((was) => (list.some((l) => l.lead === was) ? was : ''));
      })
      .catch(() => setLeads([]));
  }, [setLead]);
  useEffect(loadLeads, [loadLeads]);

  const changed = useCallback(() => { refresh(); loadLeads(); }, [refresh, loadLeads]);
  const rerolls = useRerolls(changed);
  const replace = (next: LibraryClip) => setClips((list) => list && list.map((c) => (c.id === next.id ? next : c)));
  const save = (id: string, patch: { tags?: string[]; rating?: number | null }) => {
    visualLibraryApi.update(id, patch).then(replace).catch(toastError);
  };
  const remove = async (clip: LibraryClip) => {
    if (!window.confirm('Delete this clip from your library? This cannot be undone.')) return;
    try {
      await visualLibraryApi.remove(clip.id);
    } catch (e) {
      if (!(isApiError(e) && e.code === 'IN_USE')) { toastError(e); return; }
      if (!window.confirm(`${e.message} Delete it anyway? Those shots will need another clip before they render.`)) return;
      try { await visualLibraryApi.remove(clip.id, true); } catch (err) { toastError(err); return; }
    }
    setClips((list) => list && list.filter((c) => c.id !== clip.id));
    loadLeads();
  };
  const addStoryClips = async () => {
    setAdding(true);
    let added = 0;
    try {
      for (;;) {
        const r = await visualLibraryApi.backfillStory();
        added += r.added;
        if (!r.remaining || !r.added) break;
      }
    } catch (e) {
      toastError(e);
    } finally {
      setAdding(false);
      setNote(added ? `Added ${added} older Story clip${added === 1 ? '' : 's'}.` : 'Every Story clip is already in your library.');
      if (added) { changed(); makePostersAgain(); }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bf-muted" aria-hidden="true" />
          <Input aria-label="Search clips" placeholder="Search prompts and tags" value={lib.q} onChange={(e) => lib.setQ(e.target.value)} className="pl-9" />
        </div>
        <div className={segmentedCls} role="group" aria-label="Shape">
          {ASPECTS.map((a) => (
            <button key={a.label} type="button" aria-pressed={lib.aspect === a.value} onClick={() => lib.setAspect(a.value)} className={segmentCls(lib.aspect === a.value)}>{a.label}</button>
          ))}
        </div>
        <div className="w-full sm:w-56">
          <label htmlFor="lib-lead" className="field-label">Lead character</label>
          <Select id="lib-lead" value={lead} onChange={(e) => setLead(e.target.value)}>
            <option value="">Anyone</option>
            {(leads || []).map((l) => <option key={l.lead} value={l.lead}>{shortLead(l.lead)} ({l.clips})</option>)}
          </Select>
        </div>
        <div className="w-full sm:w-44">
          <label htmlFor="lib-rating" className="field-label">Rating</label>
          <Select id="lib-rating" value={String(lib.rating)} onChange={(e) => lib.setRating(Number(e.target.value))}>
            <option value="0">Any rating</option>
            <option value="3">3 stars and up</option>
            <option value="4">4 stars and up</option>
            <option value="5">5 stars</option>
          </Select>
        </div>
      </div>
      {lib.tag && (
        <button type="button" onClick={() => lib.setTag('')} aria-label={`Tagged ${lib.tag}, clear this filter`}
          className="inline-flex items-center gap-1 rounded-full border border-bf-gold px-3 py-1 text-xs text-bf-cream">
          Tagged {lib.tag} <X size={12} aria-hidden="true" />
        </button>
      )}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1"><ImportClips onImported={changed} /></div>
        <Button variant="secondary" disabled={adding} onClick={() => { void addStoryClips(); }}>
          <History size={16} aria-hidden="true" /> {adding ? 'Adding older Story clips…' : 'Add older Story clips'}
        </Button>
      </div>
      {note && <p className="text-help" role="status">{note}</p>}
      {rerolling && (
        <RerollPanel key={rerolling.id} clip={rerolling} onClose={() => setRerolling(null)}
          onStarted={(job) => { rerolls.started(job); setRerolling(null); }} />
      )}
      <RerollJobs jobs={rerolls.jobs} checkedAt={rerolls.checkedAt}
        onRefetch={(job) => { visualLibraryApi.refetchReroll(job.id).then(rerolls.started).catch(toastError); }} />
      {clips === null ? (
        <p className="text-help">Loading your clips…</p>
      ) : clips.length === 0 ? (
        <p className="text-help">No clips match. Clear a filter, import clips, or make some in Scene script or Story.</p>
      ) : (
        <>
          {clips.length >= PAGE_LIMIT && <p className="text-help">Showing the first {PAGE_LIMIT} matches. Search or filter to find the others.</p>}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {clips.map((c) => (
              <LibraryClipCard key={c.id} clip={c} activeTag={lib.tag}
                onRate={(rating) => save(c.id, { rating })}
                onTags={(tags) => save(c.id, { tags })}
                onTagFilter={(t) => lib.setTag(t === lib.tag ? '' : t)}
                onDelete={() => { void remove(c); }}
                onReroll={() => { setRerolling(c); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function VisualLibraryPage() {
  const isSuperAdmin = useAuth((s) => s.isSuperAdmin);
  if (!isSuperAdmin) return <p className="text-help">The visual library is available to super admins only for now.</p>;
  return (
    <div className="space-y-6">
      <ScreenHeader eyebrow="Studio" title={<>Visual <em>library</em></>}
        subtitle="Every clip you have paid for or imported. Reusing one in a video costs nothing." />
      <LibraryBrowser />
    </div>
  );
}
