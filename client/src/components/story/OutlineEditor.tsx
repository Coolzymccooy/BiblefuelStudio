import { useState } from 'react';
import { Loader2, Mic, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { longformApi } from '../../lib/longformApi';
import { STORY_VOICES } from '../../lib/storyScript';
import type { LongformSection, StoryProject } from '../../lib/storyTypes';

interface Props { project: StoryProject; onSaved: (p: StoryProject) => void; onNarrate: (voiceId: string) => void; busy: boolean }
import { fieldLabelCls, inputCls, panelCls, primaryBtnCls, secondaryBtnCls } from './formStyles';

// A section's `text` is the full spoken narration — scripture (if any) followed
// by the reflection. When `text` genuinely starts with that scripture, the
// verse is already shown verbatim in the blockquote above, so the edit box
// only needs the reflection portion; re-prefixing on change keeps `text`
// intact as the full narration the server expects. But `text` doesn't always
// start with the prefix (hand-edited, or an older planner run) — naively
// slicing/re-adding a prefix that was never actually there duplicates the
// scripture on the next save. `splitReflection` only claims a prefix when the
// (whitespace-normalised) text really begins with it.
function versePrefix(s: LongformSection): string {
  if (!s.verseText) return '';
  return `${s.reference ? `${s.reference}. ` : ''}${s.verseText} `;
}

function normaliseWs(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function splitReflection(s: LongformSection): { reflection: string; hasPrefix: boolean } {
  const prefix = versePrefix(s);
  if (!prefix) return { reflection: s.text, hasPrefix: false };
  const normalisedText = normaliseWs(s.text);
  const normalisedPrefix = normaliseWs(prefix);
  if (!normalisedText.startsWith(normalisedPrefix)) return { reflection: s.text, hasPrefix: false };
  return { reflection: normalisedText.slice(normalisedPrefix.length).trimStart(), hasPrefix: true };
}

export function OutlineEditor({ project, onSaved, onNarrate, busy }: Props) {
  const [sections, setSections] = useState<LongformSection[]>(project.longform?.sections ?? []);
  const [voiceId, setVoiceId] = useState(STORY_VOICES[0].id);
  const [saving, setSaving] = useState(false);
  const totalMin = Math.round(sections.reduce((n, s) => n + (s.targetSec || 0), 0) / 60);

  const update = (i: number, reflection: string) =>
    setSections((prev) => prev.map((s, j) => {
      if (j !== i) return s;
      const { hasPrefix } = splitReflection(s);
      return { ...s, text: hasPrefix ? versePrefix(s) + reflection : reflection };
    }));

  const save = async () => {
    setSaving(true);
    try { onSaved(await longformApi.saveSections(project.projectId, sections)); toast.success('Outline saved'); }
    catch (e) { toast.error((e as Error).message || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <p className="text-help">
        {sections.length} sections · about {totalMin} min.{' '}
        {project.longform?.source === 'pasted'
          ? 'Your words, exactly as written; scripture fetched verbatim. Edit anything before narration.'
          : 'Scripture is fetched verbatim; edit the reflections freely.'}
      </p>
      {sections.map((s, i) => {
        const { reflection, hasPrefix } = splitReflection(s);
        return (
          <div key={i} className={panelCls}>
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="section-title">
                {s.heading}
                {s.continuation && <span className="ml-2 text-meta font-normal">(continued)</span>}
              </h4>
              <span className="text-meta">
                {s.continuation && s.pauseBeforeMs ? `after a ${Math.round(s.pauseBeforeMs / 1000)} s pause · ` : ''}
                {s.targetSec >= 60 ? `${Math.round(s.targetSec / 60)} min` : `${s.targetSec} s`}
              </span>
            </div>
            {hasPrefix && <blockquote className="mt-2 border-l-2 border-bf-goldDeep pl-3 text-sm italic text-bf-sub">{s.reference}: {s.verseText}</blockquote>}
            <textarea value={reflection} onChange={(e) => update(i, e.target.value)} rows={4} className={inputCls} />
          </div>
        );
      })}
      <div className="flex flex-wrap items-end gap-3">
        <label className={`${fieldLabelCls} min-w-[12rem]`}>
          Voice
          <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className={inputCls}>
            {STORY_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={save} disabled={saving || busy} className={secondaryBtnCls}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save outline
        </button>
        <button type="button" onClick={() => onNarrate(voiceId)} disabled={busy} className={primaryBtnCls}>
          <Mic size={16} /> Generate narration
        </button>
      </div>
    </div>
  );
}
