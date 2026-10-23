import { useRef, useState } from 'react';
import { Pause, Pencil, Play, RefreshCw, Star, Trash2 } from 'lucide-react';
import type { LibraryClip } from '../../lib/sceneScriptTypes';
import { money } from '../sceneScript/format';

interface Props {
  clip: LibraryClip;
  activeTag: string;
  onRate: (rating: number | null) => void;
  onTags: (tags: string[]) => void;
  onTagFilter: (tag: string) => void;
  onDelete: () => void;
  onReroll: () => void;
}

const SOURCE_LABEL: Record<string, string> = { import: 'Imported', story: 'Story', 'scene-script': 'Scene script' };
const iconBtn = 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-bf-sub hover:bg-editor-hover hover:text-bf-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-bf-gold';

const parseTags = (text: string) => [...new Set(text.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
const sameTags = (a: string[], b: string[]) => a.join('\n') === b.join('\n');

/** One library clip: plays on hover or with its play button; rate, tag, filter by a tag, or delete. */
export function LibraryClipCard({ clip, activeTag, onRate, onTags, onTagFilter, onDelete, onReroll }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(clip.tags.join(', '));
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  // Set when Escape or Enter has already ended an edit, so the blur that follows does nothing.
  const closed = useRef(false);
  const rating = clip.rating || 0;
  const name = clip.prompt ? clip.prompt.slice(0, 60) : 'clip with unknown prompt';
  const meta = [
    clip.durationSec ? `${Math.round(clip.durationSec)} s` : null,
    SOURCE_LABEL[clip.source?.kind || ''] || null,
    clip.costUsd > 0 ? money(clip.costUsd) : null,
  ].filter(Boolean).join(' · ');

  const play = () => { void video.current?.play().catch(() => {}); };
  const pause = () => video.current?.pause();
  const startEdit = () => { closed.current = false; setDraft(clip.tags.join(', ')); setEditing(true); };
  const endEdit = (save: boolean) => {
    if (closed.current) return;
    closed.current = true;
    setEditing(false);
    const next = parseTags(draft);
    if (save && !sameTags(next, clip.tags)) onTags(next);
  };

  return (
    <li className="flex flex-col overflow-hidden rounded-card border border-editor-line bg-bf-card">
      <div className="relative" onMouseEnter={play} onMouseLeave={pause}>
        <video ref={video} src={clip.url} poster={clip.posterUrl || undefined} muted loop playsInline
          preload={clip.posterUrl ? 'none' : 'metadata'} aria-label={`Clip: ${name}`}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          className={`w-full bg-editor-stage object-cover ${clip.aspect === 'landscape' ? 'aspect-video' : clip.aspect === 'square' ? 'aspect-square' : 'aspect-[9/16]'}`} />
        <button type="button" onClick={playing ? pause : play} aria-label={playing ? 'Pause preview' : 'Play preview'}
          className="absolute bottom-2 left-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-[#fff] hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bf-gold">
          {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        {clip.prompt
          ? <p className="line-clamp-4 text-xs text-bf-sub">{clip.prompt}</p>
          : <p className="text-xs italic text-bf-muted">Prompt unknown</p>}
        {meta && <p className="text-xs tabular-nums text-bf-muted">{meta}</p>}
        <div className="flex flex-wrap items-center" role="group" aria-label="Stars for this clip">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={`Rate ${n} star${n === 1 ? '' : 's'}`} aria-pressed={rating === n}
              onClick={() => onRate(rating === n ? null : n)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-bf-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-bf-gold">
              <Star size={16} aria-hidden="true" fill={n <= rating ? 'currentColor' : 'none'} />
            </button>
          ))}
        </div>
        {editing ? (
          <input autoFocus aria-label="Tags for this clip" className="input text-xs" value={draft} placeholder="lamb, sunset"
            onChange={(e) => setDraft(e.target.value)} onBlur={() => endEdit(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') endEdit(true);
              if (e.key === 'Escape') endEdit(false);
            }} />
        ) : (
          <div className="flex flex-wrap gap-1">
            {clip.tags.map((t) => (
              <button key={t} type="button" onClick={() => onTagFilter(t)} aria-label={`Show clips tagged ${t}`} aria-pressed={activeTag === t}
                className={`rounded-full border px-2 py-0.5 text-xs ${activeTag === t ? 'border-bf-gold text-bf-cream' : 'border-editor-line text-bf-sub hover:text-bf-cream'}`}>
                {t}
              </button>
            ))}
          </div>
        )}
        <div className="mt-auto flex justify-end gap-1">
          <button type="button" className={iconBtn} aria-label="Re-roll from this prompt" title="Re-roll from this prompt (paid)" onClick={onReroll}>
            <RefreshCw size={15} aria-hidden="true" />
          </button>
          <button type="button" className={iconBtn} aria-label="Edit tags" title="Edit tags" onClick={startEdit}>
            <Pencil size={15} aria-hidden="true" />
          </button>
          <button type="button" className={`${iconBtn} hover:text-bf-danger`} aria-label="Delete clip" title="Delete clip" onClick={onDelete}>
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </li>
  );
}
