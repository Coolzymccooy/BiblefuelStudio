import { useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { confirmRetime } from '../../lib/lyricRetime';
import type { LyricLine, LyricProject, LyricSection } from '../../lib/lyricVideoTypes';
import { fieldLabelCls, inputCls, panelCls, primaryBtnCls, secondaryBtnCls } from '../story/formStyles';
import { messageOf } from './messageOf';

interface Props { project: LyricProject; onChange: (p: LyricProject) => void; onNext?: () => void }

const lineCls = (line: LyricLine) =>
  line.kind === 'response' ? 'pl-6 text-bf-gold' : line.kind === 'soft' ? 'italic text-content-secondary' : 'text-bf-cream';

function ParsedSection({ section, lines }: { section: LyricSection; lines: LyricLine[] }) {
  return (
    <div>
      <p className="bf-eyebrow">{section.label}</p>
      <ul className="mt-1 space-y-0.5 text-sm">
        {lines.map((l) => <li key={l.id} className={lineCls(l)}>{l.text}</li>)}
      </ul>
    </div>
  );
}

/** Step 2: paste the lyrics, see how they were understood, then start timing them. */
export function LyricsStep({ project, onChange, onNext }: Props) {
  const [text, setText] = useState(project.sheet.raw);
  const [busy, setBusy] = useState<'reading' | 'timing' | null>(null);
  const { sections, lines } = project;
  const skipped = project.sheet.skipped ?? [];
  // Timing uses what was last read, so edits made since then must be read again first.
  const edited = text.trim() !== project.sheet.raw.trim();
  const canTime = Boolean(project.song) && lines.length > 0 && !edited && busy === null;

  const read = async () => {
    setBusy('reading');
    try {
      onChange(await lyricVideoApi.setSheet(project.projectId, text));
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  const timedBefore = project.timing.status === 'done';

  const time = async () => {
    if (timedBefore && !confirmRetime()) return;
    setBusy('timing');
    try {
      onChange(await lyricVideoApi.align(project.projectId));
      onNext?.();
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="lyric-sheet" className={fieldLabelCls}>Lyrics</label>
        <textarea
          id="lyric-sheet"
          rows={16}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Paste your lyrics, one line per line.\nPut a name in square brackets to start a section, like [CHORUS].'}
          className={`${inputCls} font-mono text-sm`}
        />
      </div>

      {/* Reading the same lyrics again would change nothing. */}
      <button type="button" className={secondaryBtnCls} disabled={busy !== null || !text.trim() || !edited} onClick={read}>
        {busy === 'reading' && <Loader2 size={16} className="animate-spin" />} Read lyrics
      </button>

      {lines.length > 0 && (
        <div className={`${panelCls} space-y-3`}>
          {sections.map((s) => (
            <ParsedSection key={s.id} section={s} lines={lines.filter((l) => l.sectionId === s.id)} />
          ))}
          {skipped.length > 0 && (
            <div className="text-xs text-content-secondary">
              <p>These look like notes, not lyrics.</p>
              <ul className="mt-1 space-y-0.5">
                {skipped.map((s, i) => <li key={`${i}-${s}`}>Skipped: {s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {edited && lines.length > 0 && (
        <p className="text-xs text-content-secondary">You changed the lyrics. Read the lyrics again to use your changes.</p>
      )}
      {!project.song && <p className="text-xs text-content-secondary">Upload the song first, then you can time the lyrics.</p>}

      <button type="button" className={primaryBtnCls} disabled={!canTime} onClick={time}>
        {busy === 'timing' && <Loader2 size={16} className="animate-spin" />} {timedBefore ? 'Time the lyrics again' : 'Time the lyrics'}
      </button>
    </div>
  );
}
