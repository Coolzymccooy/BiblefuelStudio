import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { journalKey, loadJournal, saveJournal } from '../lib/scheduledPostJournal';
import { api } from '../lib/api';
import { uploadMedia } from '../lib/mediaUpload';
import { londonToUtc, londonWall, parseCampaign, statusLabel } from '../lib/scheduledPosts';
import type { CampaignRow, Destination, ScheduledPost, ScheduledPostInput } from '../lib/scheduledPosts';
import { Button } from './ui/Button';

interface Draft extends CampaignRow {
  included: boolean;
  key: string; ids: Record<Destination, string>; wall: string;
  file?: File; videoUrl?: string; localHash?: string; localBytes?: number;
}
const inputClass = 'w-full min-w-0 rounded-lg border border-white/10 bg-dark-900 px-3 py-2 text-sm';
function draft(row: CampaignRow): Draft {
  return { ...row, included: row.scheduledAt !== null, key: crypto.randomUUID(), ids: { youtube: crypto.randomUUID(), tiktok: crypto.randomUUID() }, wall: londonWall(row.scheduledAt) };
}

function OriginalFilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return;
    const next = URL.createObjectURL(file); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return <details><summary className="min-h-11 cursor-pointer text-sm">Preview selected original (not a proxy)</summary>
    {url && <video aria-label={`Selected original ${file.name}`} src={url} controls preload="none" className="w-full rounded-lg" />}
  </details>;
}

/** Finite, explicit one-off queue. Never writes recurring automation or webhooks. */
export function ScheduledVideosPanel() {
  const owner = useAuth(s => s.userId);
  const loading = useAuth(s => s.isLoading);
  if (!owner || loading) return <p role="status">Checking account before loading scheduled videos.</p>;
  return <OwnerScheduledVideosPanel key={owner} owner={owner} />;
}
function OwnerScheduledVideosPanel({ owner }: { owner: string }) {
  const [rows, setRows] = useState<Draft[]>([]);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [locked, setLocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [recoverable, setRecoverable] = useState(false);
  const mounted = useRef(true);
  const assertOwner = () => {
    if (!mounted.current || useAuth.getState().userId !== owner || useAuth.getState().isLoading) throw new Error('Account changed. This request was stopped.');
  };
  const pending = useRef<ScheduledPostInput[] | null>(null);
  const inFlight = useRef(false);
  const read = async () => {
    assertOwner();
    const result = await api.get<{ posts: ScheduledPost[] }>('/api/social/scheduled-posts');
    if (!result.ok || !Array.isArray(result.data?.posts)) throw new Error(result.error || 'Could not read scheduled videos.');
    assertOwner();
    setPosts(result.data.posts);
    return result.data.posts;
  };
  const reconcile = async (saved: ScheduledPost[], cancelMismatch = false) => {
    assertOwner();
    const payload = pending.current;
    if (!payload) return false;
    const exact = (p: ScheduledPostInput, s: ScheduledPost) => Object.entries(p).every(([key, value]) => s[key as keyof ScheduledPostInput] === value);
    const matched = payload.map(p => saved.find(s => s.clientId === p.clientId));
    if (matched.some((s, i) => s && (!exact(payload[i], s) || (s.status !== 'cancelled' && (s.mediaSha256 !== payload[i].expectedSha256 || s.bytes !== payload[i].expectedBytes))))) {
      // Mount/refresh/retry readback never performs a mutating request.
      if (!cancelMismatch) throw new Error('Critical: queue original does not match. Keep this saved submission and review or cancel associated queued posts. Do not repost.');
      // Only cancel our exact immutable request after unexpected POST success, never a conflicting record.
      for (let i = 0; i < matched.length; i++) {
        const s = matched[i];
        if (s?.status === 'queued' && exact(payload[i], s)) {
          assertOwner();
          const cancelled = await api.post(`/api/social/scheduled-posts/${encodeURIComponent(s.id)}/cancel`, {});
          assertOwner();
          if (!cancelled.ok) throw new Error('Critical: queue original does not match. Cancellation failed; operator review required. Do not repost.');
        }
      }
      await read();
      throw new Error('Critical: queue original does not match. Matching queued records were sent for cancellation; refresh to verify. Do not repost.');
    }
    if (!matched.every(Boolean)) return false;
    // Removal is also fail closed: a failed removal retains the locked request.
    localStorage.removeItem(journalKey(owner));
    if (localStorage.getItem(journalKey(owner)) !== null) throw new Error('Could not clear confirmed submission. Refresh before starting another campaign.');
    pending.current = null; setLocked(false); setRows(current => current.filter(r => !payload.some(p => r.ids[p.destination] === p.clientId))); setReviewed(false); setRecoverable(false);
    setNotice(matched.some(s => s?.status === 'cancelled') ? 'Submission reconciled, including confirmed cancellations. No new posts were sent.' : 'Scheduled posts confirmed in queue. Publication is not yet confirmed.');
    return true;
  };
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const journal = loadJournal(owner);
        if (journal) {
          pending.current = journal.payload; setRows(journal.rows); setLocked(true); setReviewed(true); setRecoverable(true);
          setNotice('Saved submission recovered. Checking the queue; nothing is sent automatically.');
        }
        const saved = await read();
        await reconcile(saved); assertOwner(); setReady(true);
      } catch (e) { if (mounted.current) setError(String((e as Error).message || e)); }
    })();
    return () => { mounted.current = false; };
  }, [owner]);
  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try { assertOwner(); await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed. Your draft is retained.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const update = (key: string, patch: Partial<Draft>) => {
    if (locked || !ready) return;
    setRows(current => current.map(r => r.key === key ? { ...r, ...patch } : r)); setReviewed(false);
  };
  const selectFiles = (files: File[]) => {
    if (locked || !ready || !files.length) return;
    if (files.some(f => !/\.mp4$/i.test(f.name)) || new Set(files.map(f => f.name)).size !== files.length) { setError('Select MP4 files with unique, exact filenames.'); return; }
    if (rows.length) {
      if (files.some(f => !rows.some(r => r.filename === f.name))) { setError('A selected filename does not exactly match this draft. No files were attached.'); return; }
      setRows(current => current.map(r => { const file = files.find(f => f.name === r.filename); return file ? { ...r, file, videoUrl: undefined, localHash: undefined, localBytes: undefined } : r; }));
    } else {
      if (files.length > 20) { setError('Choose at most 20 files.'); return; }
      setRows(files.map(file => ({ ...draft({ filename: file.name, title: file.name.replace(/\.mp4$/i, ''), caption: file.name.replace(/\.mp4$/i, ''), scheduledAt: null, timezone: 'Europe/London', destinations: ['youtube'] }), included: true, file })));
    }
    setError(''); setReviewed(false);
  };
  const upload = () => run(async () => {
    if (locked || !ready) return;
    for (const row of rows) {
      if (!row.included) continue;
      if (row.videoUrl) continue;
      if (!row.file || row.file.name !== row.filename) throw new Error(`Attach the exact file: ${row.filename}`);
      if (row.file.size > 200 * 1024 * 1024) throw new Error('Scheduled videos must be at most 200 MB each.');
      if (row.bytes !== undefined && row.bytes !== row.file.size) throw new Error(`File size does not match the manifest: ${row.filename}`);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await row.file.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
      if (row.sha256 && row.sha256.toLowerCase() !== hash) throw new Error(`SHA-256 does not match the manifest: ${row.filename}`);
      assertOwner();
      const result = await uploadMedia(row.file, row.filename, 'source-video');
      assertOwner();
      if (!result.file || result.file === result.proxyPath || /\/proxy(?:\/|[-_.])/i.test(result.file)) throw new Error('Upload did not return an original video. Nothing was scheduled.');
      setRows(current => current.map(r => r.key === row.key ? { ...r, videoUrl: result.file, localHash: hash, localBytes: row.file!.size } : r));
    }
    setNotice('Original videos uploaded. Review times, destinations and public visibility before scheduling.');
  });
  const schedule = () => run(async () => {
    if (!ready) throw new Error('Refresh the queue before submitting.');
    if (!reviewed) throw new Error('Review and confirm the public posts first.');
    let payload = pending.current;
    if (!payload) {
      if (!rows.length) throw new Error('Add finished MP4 files first.');
      payload = rows.flatMap(row => {
        if (!row.included) return [];
        if (!row.videoUrl || !row.localHash || !row.localBytes || !row.title.trim() || row.title.length > 100 || !row.caption.trim() || row.caption.length > 2200 || !row.destinations.length) throw new Error('Upload every original, choose destinations, and supply a title (1–100 characters) and caption (1–2200 characters).');
        const scheduledAt = londonToUtc(row.wall);
        return row.destinations.map(destination => ({ clientId: row.ids[destination], title: row.title, caption: row.caption, videoUrl: row.videoUrl!, scheduledAt, timezone: 'Europe/London', destination, expectedSha256: row.localHash!, expectedBytes: row.localBytes!, privacyStatus: destination === 'youtube' ? 'public' as const : 'PUBLIC_TO_EVERYONE' as const }));
      });
      if (!payload.length || payload.length > 20) throw new Error('Select 1–20 destination posts per batch. Split this draft before scheduling.');
      assertOwner();
      // Must be durable and read back BEFORE the first mutating request.
      if (loadJournal(owner)) throw new Error('An unresolved saved submission already exists. Reload to reconcile it first.');
      pending.current = payload; setLocked(true); setRecoverable(true);
      saveJournal({ version: 1, owner, reviewed: true, rows, payload });
    }
    // A retry always reads independently first. A failed read cannot send anything.
    if (locked && await reconcile(await read())) return;
    assertOwner();
    // Re-verify durable identity even after an earlier storage write failed or another tab changed it.
    const durable = loadJournal(owner);
    if (!durable || durable.payload.length !== payload.length || !payload.every((p, i) => Object.entries(p).every(([k, v]) => durable.payload[i][k as keyof ScheduledPostInput] === v))) throw new Error('Saved request changed or is unavailable. Reload to reconcile before retrying.');
    const response = await api.post<{ posts: ScheduledPost[] }>('/api/social/scheduled-posts', { posts: payload });
    assertOwner();
    if (!response.ok) throw new Error(`${response.error || 'Save outcome unconfirmed.'} Draft retained; retry uses the same IDs and unchanged request. Refresh the queue before retrying.`);
    if (!await reconcile(await read(), true)) throw new Error('Save not fully confirmed by queue readback. Draft retained; refresh or retry with the same IDs.');
  });
  const count = rows.reduce((n, r) => n + (r.included ? r.destinations.length : 0), 0);
  return <section aria-labelledby="scheduled-videos-heading" className="min-w-0 space-y-4 rounded-xl border border-white/10 p-3 sm:p-4 [&_button]:min-h-[44px]">
    <div><h3 id="scheduled-videos-heading" className="text-lg font-semibold">Scheduled videos</h3>
      <p className="text-help">One-off posts of finished MP4s, separate from recurring automation. Nothing is scheduled until you confirm. All times: Europe/London. Public visibility is explicit for this queue only.</p>
      <p className="text-help">Story exports are not automatically your approved final edits. Select the exact finished files.</p></div>
    {error && <p role="alert" className="text-sm text-red-400 break-words">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm">Finished MP4 files<input aria-label="Finished MP4 files" className={`${inputClass} mt-1`} type="file" accept="video/mp4,.mp4" multiple disabled={busy || locked || !ready} onChange={e => { selectFiles(Array.from(e.target.files || [])); e.target.value = ''; }} /></label>
      <label className="min-w-0 text-sm">Import campaign draft (JSON)<input aria-label="Import campaign draft (JSON)" className={`${inputClass} mt-1`} type="file" accept="application/json,.json" disabled={busy || locked || !ready} onChange={e => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (file && ready && !locked) void run(async () => { const imported = parseCampaign(JSON.parse(await file.text())); assertOwner(); if (loadJournal(owner)) throw new Error('Reload to reconcile your saved submission first.'); setRows(imported.map(draft)); setReviewed(false); setNotice('Draft imported only. Attach matching files; pending times remain blank.'); });
      }} /></label>
    </div>
    {rows.map((row, index) => <fieldset disabled={busy || locked || !ready} key={row.key} className="min-w-0 space-y-3 rounded-lg border border-white/10 p-3">
      <legend className="max-w-full break-all px-1 text-sm font-semibold">{index + 1}. {row.filename}</legend>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input aria-label={`Include video ${index + 1} in batch`} type="checkbox" checked={row.included} onChange={e => update(row.key, { included: e.target.checked })} />Include in this batch</label>
      <label className="block text-sm">Title<input aria-label={`Title ${index + 1}`} className={inputClass} value={row.title} onChange={e => update(row.key, { title: e.target.value })} /></label>
      <label className="block text-sm">Caption<textarea aria-label={`Caption ${index + 1}`} className={inputClass} value={row.caption} onChange={e => update(row.key, { caption: e.target.value })} /></label>
      <label className="block min-w-0 text-sm">Date and time — Europe/London<input aria-label={`London date and time ${index + 1}`} type="datetime-local" style={{ minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }} className={inputClass} value={row.wall} onChange={e => update(row.key, { wall: e.target.value })} /></label>
      {!row.wall && <p className="text-help">Time pending — this video cannot be scheduled yet.</p>}
      <div className="flex flex-wrap gap-4">{(['youtube', 'tiktok'] as const).map(d => <label key={d} className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={row.destinations.includes(d)} onChange={e => update(row.key, { destinations: e.target.checked ? [...row.destinations, d] : row.destinations.filter(v => v !== d) })} />{d === 'youtube' ? 'YouTube — Public' : 'TikTok — Public to everyone'}</label>)}</div>
      <p className="text-help break-all">{row.videoUrl ? `Original uploaded: ${row.videoUrl} · SHA-256 ${row.localHash}` : row.file ? 'File attached — not uploaded or scheduled.' : 'Waiting for the exact local file.'}</p>
      {row.file && <OriginalFilePreview file={row.file} />}
    </fieldset>)}
    {rows.length > 0 && <div className="space-y-3">
      <p className="text-sm">Review: {rows.filter(r => r.included).length} included videos → {count} public destination posts. Excluded drafts stay pending. Limit 20 posts per batch. No automatic retry or recurring jobs.</p>
      {locked && <p className="text-help">Request locked after submission to preserve retry identity. Refresh to check the queue; retry never creates new IDs.</p>}
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy || locked || !ready} onChange={e => setReviewed(e.target.checked)} />I reviewed the exact originals, captions, future London times and public destinations.</label>
      <div className="flex flex-wrap gap-3"><Button variant="secondary" disabled={busy || locked || !ready} onClick={() => void upload()}>Upload originals</Button>
        <Button disabled={busy || !ready || !reviewed || !count || count > 20} onClick={() => void schedule()}>{locked ? 'Retry same request' : `Schedule ${count} posts`}</Button>
        <Button variant="secondary" disabled={busy || locked || !ready} onClick={() => { setRows([]); setReviewed(false); }}>Clear draft</Button></div>
    </div>}
    {recoverable && <Button variant="secondary" disabled={busy} onClick={() => void run(async () => {
      const saved = await read();
      const payload = pending.current;
      if (!payload || payload.some(p => saved.some(s => s.clientId === p.clientId && s.status !== 'cancelled'))) throw new Error('Cannot clear: associated posts exist and are not all cancelled. Reconcile or cancel them first.');
      if (!window.confirm('Queue readback confirms no active posts for this saved request. Clear this saved submission?')) return;
      assertOwner(); localStorage.removeItem(journalKey(owner));
      if (localStorage.getItem(journalKey(owner)) !== null) throw new Error('Could not clear saved submission.');
      pending.current = null; setLocked(false); setRecoverable(false); setReviewed(false); setReady(true);
      setNotice('Saved submission cleared after queue reconciliation. Draft metadata retained; attach files again if needed.');
    })}>Clear reconciled submission</Button>}
    <div className="flex items-center justify-between gap-3"><h4 className="font-semibold">Queue and receipts</h4><Button variant="secondary" disabled={busy} onClick={() => void run(async () => { const journal = loadJournal(owner); if (journal && !pending.current) throw new Error('Reload to recover your saved submission.'); await reconcile(await read()); setReady(true); })}>Refresh queue</Button></div>
    {!posts.length && <p className="text-help">No scheduled videos loaded.</p>}
    <ul className="space-y-3">{posts.map(post => <li key={post.id} className="min-w-0 rounded-lg border border-white/10 p-3 text-sm break-words">
      <p className="font-semibold">{post.title} · {post.destination}</p>
      <p>{statusLabel[post.status] || `Unknown status: ${post.status}`}</p>
      <p>{post.scheduledAt} · {post.timezone} · Requested visibility: {post.privacyStatus}</p>
      <p className="break-all">Original: {post.videoUrl}</p>
      <p className="text-help break-all">{post.mediaSha256 ? `Server SHA-256: ${post.mediaSha256}` : 'Server media identity not available'}{post.bytes ? ` · ${post.bytes} bytes` : ''}</p>
      {post.error && <p className="text-red-400">{post.error}</p>}
      {post.receipt != null && <details><summary className="min-h-11 cursor-pointer">Provider receipt</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(post.receipt, null, 2)}</pre></details>}
      {post.status === 'queued' && <Button variant="secondary" disabled={busy} onClick={() => void run(async () => {
        const result = await api.post(`/api/social/scheduled-posts/${encodeURIComponent(post.id)}/cancel`, {});
        if (!result.ok) throw new Error(result.error || 'Cancellation failed.');
        const fresh = await read();
        if (fresh.find(p => p.id === post.id)?.status !== 'cancelled') throw new Error('Cancellation not confirmed by readback.');
        setNotice('Cancellation confirmed.');
      })}>Cancel queued post</Button>}
    </li>)}</ul>
  </section>;
}
