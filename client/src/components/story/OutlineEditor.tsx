import { useState } from 'react';
import { Loader2, Mic, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { longformApi } from '../../lib/longformApi';
import { STORY_VOICES } from '../../lib/storyScript';
import type { LongformSection, StoryProject } from '../../lib/storyTypes';

interface Props { project: StoryProject; onSaved: (p: StoryProject) => void; onNarrate: (voiceId: string) => void; busy: boolean }
const inputCls = 'mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-white focus:border-primary-400 focus:outline-none';

// A section's `text` is the full spoken narration — scripture (if any) followed
// by the reflection. The scripture is already shown verbatim in the blockquote
// above, so the edit box only needs the reflection portion; re-prefixing on
// change keeps `text` intact as the full narration the server expects.
function versePrefix(s: LongformSection): string {
  if (!s.verseText) return '';
  return `${s.reference ? `${s.reference}. ` : ''}${s.verseText} `;
}

function reflectionOf(s: LongformSection): string {
  const prefix = versePrefix(s);
  return prefix && s.text.startsWith(prefix) ? s.text.slice(prefix.length) : s.text;
}

export function OutlineEditor({ project, onSaved, onNarrate, busy }: Props) {
  const [sections, setSections] = useState<LongformSection[]>(project.longform?.sections ?? []);
  const [voiceId, setVoiceId] = useState(STORY_VOICES[0].id);
  const [saving, setSaving] = useState(false);
  const totalMin = Math.round(sections.reduce((n, s) => n + (s.targetSec || 0), 0) / 60);

  const update = (i: number, reflection: string) =>
    setSections((prev) => prev.map((s, j) => (j === i ? { ...s, text: versePrefix(s) + reflection } : s)));

  const save = async () => {
    setSaving(true);
    try { onSaved(await longformApi.saveSections(project.projectId, sections)); toast.success('Outline saved'); }
    catch (e) { toast.error((e as Error).message || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">{sections.length} sections · about {totalMin} min. Scripture is fetched verbatim; edit the reflections freely.</p>
      {sections.map((s, i) => (
        <div key={i} className="rounded-xl border border-white/10 p-3">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-medium text-white">{s.heading}</h4>
            <span className="text-xs text-gray-500">{Math.round(s.targetSec / 60)} min</span>
          </div>
          {s.verseText && <blockquote className="mt-1 border-l-2 border-primary-400/60 pl-2 text-sm italic text-gray-300">{s.reference}: {s.verseText}</blockquote>}
          <textarea value={reflectionOf(s)} onChange={(e) => update(i, e.target.value)} rows={4} className={inputCls} />
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm text-gray-300">
          Voice
          <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className={inputCls}>
            {STORY_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={save} disabled={saving || busy} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-4 py-2 text-sm text-white disabled:opacity-60">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save outline
        </button>
        <button type="button" onClick={() => onNarrate(voiceId)} disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-60">
          <Mic size={16} /> Generate narration
        </button>
      </div>
    </div>
  );
}
