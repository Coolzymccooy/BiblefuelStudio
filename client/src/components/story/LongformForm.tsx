import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { longformApi, type LongformTemplateOption } from '../../lib/longformApi';
import { storyApi } from '../../lib/storyApi';
import type { StoryProject } from '../../lib/storyTypes';

interface Props { onDrafted: (project: StoryProject) => void; busy: boolean }
const inputCls = 'mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-white focus:border-primary-400 focus:outline-none';

export function LongformForm({ onDrafted, busy }: Props) {
  const [templates, setTemplates] = useState<LongformTemplateOption[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [idea, setIdea] = useState('');
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
    <div className="space-y-3">
      <label className="block text-sm text-gray-300">
        Format
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputCls}>
          <option value="">Let BibleFuel choose</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      <label className="block text-sm text-gray-300">
        What's on your heart? (a verse, a theme, a rough idea)
        <textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={4} placeholder="psalms for when I can't switch my mind off at night" className={inputCls} />
      </label>
      <button type="button" onClick={draft} disabled={!canDraft} className="inline-flex items-center gap-2 rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-60">
        {drafting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        Write the outline
      </button>
      <label className="block text-sm text-gray-300">
        Or a voice note
        <input
          type="file"
          accept="audio/*"
          className="mt-1 block w-full text-sm text-gray-400"
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
