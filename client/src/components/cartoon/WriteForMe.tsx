/**
 * "Write it for me": BibleFuel drafts a script from a verse or a theme. The
 * draft only fills the editor; nothing is saved, and from then on the text is
 * the admin's own and is spoken exactly as they leave it. Drafting takes up to
 * a minute, so the panel says so rather than looking stuck.
 */
import { useEffect, useState } from 'react';
import { cartoonApi } from '../../lib/cartoonApi';
import type { CartoonStyle } from '../../lib/cartoonTypes';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';

interface Props {
  /** The editor's text, so a draft never silently replaces the admin's work. */
  current: string;
  onDraft: (markdown: string) => void;
}

export function WriteForMe({ current, onDraft }: Props) {
  const [verse, setVerse] = useState('');
  const [theme, setTheme] = useState('');
  const [cast, setCast] = useState('');
  const [styles, setStyles] = useState<CartoonStyle[]>([]);
  const [style, setStyle] = useState('');
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The style is optional: if the list cannot load, the writer picks the default.
  useEffect(() => {
    cartoonApi.styles().then((r) => { setStyles(r.styles); setStyle(r.defaultStyle); }).catch(() => setStyles([]));
  }, []);

  const write = async () => {
    if (current.trim() && !window.confirm('Replace the script in the editor with a new draft?')) return;
    setWriting(true);
    setError(null);
    try {
      const draft = await cartoonApi.write({ verse: verse.trim(), theme: theme.trim(), cast: cast.trim(), style });
      onDraft(draft.markdown);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not write the script.');
    } finally {
      setWriting(false);
    }
  };

  return (
    <aside aria-labelledby="cartoon-write-heading" className="space-y-4 rounded-card border border-editor-line bg-bf-card p-4">
      <div>
        <h2 id="cartoon-write-heading" className="text-sm font-semibold text-bf-cream">Write it for me</h2>
        <p className="text-help">Give a verse, a theme or both. The draft opens in the editor for you to change.</p>
      </div>
      <Field label="Verse" htmlFor="cartoon-write-verse">
        <Input id="cartoon-write-verse" value={verse} onChange={(e) => setVerse(e.target.value)} placeholder="Luke 15:4" disabled={writing} maxLength={80} />
      </Field>
      <Field label="Theme" htmlFor="cartoon-write-theme">
        <Input id="cartoon-write-theme" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Never giving up on someone" disabled={writing} maxLength={400} />
      </Field>
      <Field label="Cast (optional)" htmlFor="cartoon-write-cast">
        <Textarea id="cartoon-write-cast" value={cast} onChange={(e) => setCast(e.target.value)} rows={3} placeholder="Eli, a shepherd boy, and Pip, his lamb" disabled={writing} maxLength={1500} />
      </Field>
      {styles.length > 0 && (
        <Field label="Style" htmlFor="cartoon-write-style">
          <Select id="cartoon-write-style" value={style} onChange={(e) => setStyle(e.target.value)} disabled={writing}>
            {styles.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </Field>
      )}
      <Button variant="secondary" className="w-full" onClick={write} isLoading={writing} disabled={!verse.trim() && !theme.trim()}>
        {writing ? 'Writing…' : 'Write the draft'}
      </Button>
      {writing && (
        <p role="status" className="text-help">Writing a script that fits 40 seconds. This can take up to a minute.</p>
      )}
      {error && <p role="alert" className="text-sm text-bf-danger">{error}</p>}
    </aside>
  );
}
