import { useEffect, useState } from 'react';
import { Loader2, Sparkles, Mic, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { longformApi, type LongformTemplateOption } from '../../lib/longformApi';
import { storyApi } from '../../lib/storyApi';
import type { StoryProject } from '../../lib/storyTypes';
import { fieldLabelCls, inputCls, primaryBtnCls, dropZoneCls, segmentedCls, segmentCls, panelCls } from './formStyles';

/**
 * How a pasted script is read — mirrors server/src/lib/longform/scriptParser.js.
 * Shown beside the box so the operator never has to guess what gets spoken.
 */
const SCRIPT_RULES: Array<[string, string]> = [
  ['## Heading  or  ---', 'starts a section; the heading becomes a YouTube chapter and is not spoken'],
  ['Psalm 4:8  (on its own line)', 'fetched verbatim and read as “Psalm four, verse eight …” — never paraphrased'],
  ['[pause]  or  [pause 8]', 'silence (template default, or 8 s — [pause 0] for none); same chapter continues'],
  ['a blank line, then another', 'a breath in the same chapter, like [pause]'],
  ['BE STILL  (all caps, first line of a section)', 'read as that section’s heading — a chapter title, not spoken'],
  ['(soft music)  [breathe]  *slowly*', 'notes to you on their own line — dropped, never spoken'],
  ['**bold**  - bullets  #tags  emoji  links', 'stripped; the words stay'],
];

interface Props { onDrafted: (project: StoryProject) => void; busy: boolean }

export function LongformForm({ onDrafted, busy }: Props) {
  const [templates, setTemplates] = useState<LongformTemplateOption[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [idea, setIdea] = useState('');
  const [script, setScript] = useState('');
  const [source, setSource] = useState<'idea' | 'script'>('idea');
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    longformApi.listTemplates().then((list) => {
      if (cancelled) return;
      setTemplates(list);
      setTemplateId((prev) => prev || list[0]?.id || '');
    }).catch((e) => toast.error((e as Error).message));
    return () => { cancelled = true; };
  }, []);

  const canDraft = idea.trim().length >= 3 && !busy && !drafting;
  const canParse = script.trim().length >= 3 && !busy && !drafting;

  const finish = ({ project, suggestion }: Awaited<ReturnType<typeof longformApi.draft>>) => {
    if (suggestion) toast.success(`Chose ${suggestion.templateId}: ${suggestion.reason}`);
    else toast.success('Outline written — review it before narration');
    onDrafted(project);
  };

  const draft = async () => {
    if (!canDraft) return;
    setDrafting(true);
    try {
      finish(await longformApi.draft({ idea: idea.trim(), templateId }));
    } catch (e) {
      toast.error((e as Error).message || 'Could not write the outline');
    } finally {
      setDrafting(false);
    }
  };

  // The operator's own words: parsed on the server (no LLM), scripture
  // fetched verbatim, then shown as sections to review before narration.
  const parseScript = async () => {
    if (!canParse) return;
    setDrafting(true);
    try {
      finish(await longformApi.draft({ script: script.trim(), templateId }));
    } catch (e) {
      toast.error((e as Error).message || 'Could not read the script');
    } finally {
      setDrafting(false);
    }
  };

  const draftFromVoiceNote = async (file: File) => {
    setDrafting(true);
    try {
      const audioPath = await storyApi.uploadAudio(file, file.name);
      finish(await longformApi.draft({ audioPath, templateId }));
    } catch (e) {
      toast.error((e as Error).message || 'Could not use the voice note');
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="space-y-4">
      <label className={fieldLabelCls}>
        Format
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputCls}>
          <option value="">Let BibleFuel choose</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      <div className={segmentedCls} role="tablist" aria-label="Where the words come from">
        <button type="button" role="tab" aria-selected={source === 'idea'} onClick={() => setSource('idea')} className={segmentCls(source === 'idea')}>
          Describe an idea
        </button>
        <button type="button" role="tab" aria-selected={source === 'script'} onClick={() => setSource('script')} className={segmentCls(source === 'script')}>
          Paste my script
        </button>
      </div>

      {source === 'idea' ? (
        <>
          <label className={fieldLabelCls}>
            What's on your heart? (a verse, a theme, a rough idea)
            <textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={4} placeholder="psalms for when I can't switch my mind off at night" className={inputCls} />
          </label>
          <button type="button" onClick={draft} disabled={!canDraft} className={`${primaryBtnCls} w-full sm:w-auto`}>
            {drafting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Write the outline
          </button>
        </>
      ) : (
        <>
          <label className={fieldLabelCls}>
            Your script
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={12}
              placeholder={'# Psalms for a Restless Mind\n\n## Welcome\nSettle in. You are safe here.\n\n## Psalm 4\nPsalm 4:8\n[pause 8]\nRead that again slowly…'}
              className={`${inputCls} font-mono text-[0.875rem] leading-relaxed`}
              spellCheck={false}
            />
          </label>
          <div className={panelCls}>
            <div className="bf-eyebrow mb-2">How it is read</div>
            <dl className="space-y-1.5">
              {SCRIPT_RULES.map(([pattern, meaning]) => (
                <div key={pattern} className="grid grid-cols-1 gap-0.5 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-3">
                  <dt className="font-mono text-[0.8125rem] text-bf-goldDeep">{pattern}</dt>
                  <dd className="text-help">{meaning}</dd>
                </div>
              ))}
            </dl>
            <p className="field-help">Your words are used exactly as written — nothing is rewritten. You review every section before any narration runs.</p>
          </div>
          <button type="button" onClick={parseScript} disabled={!canParse} className={`${primaryBtnCls} w-full sm:w-auto`}>
            {drafting ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
            Preview sections
          </button>
        </>
      )}
      <label className={fieldLabelCls}>
        Or a voice note
        <span className={`${dropZoneCls} mt-1.5 py-4 font-normal`}>
          <Mic size={15} /> Record or pick an audio note — BibleFuel transcribes it into the idea
        </span>
        <input
          type="file"
          accept="audio/*"
          className="sr-only"
          disabled={busy || drafting}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) draftFromVoiceNote(f);
          }}
        />
      </label>
    </div>
  );
}
