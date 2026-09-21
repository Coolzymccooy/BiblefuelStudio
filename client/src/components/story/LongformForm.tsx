import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { longformApi, type LongformTemplateOption } from '../../lib/longformApi';
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

  const canDraft = idea.trim().length >= 3 && Boolean(templateId) && !busy && !drafting;

  const draft = async () => {
    if (!canDraft) return;
    setDrafting(true);
    try {
      const project = await longformApi.draft({ idea: idea.trim(), templateId });
      toast.success('Outline written — review it before narration');
      onDrafted(project);
    } catch (e) {
      toast.error((e as Error).message || 'Could not write the outline');
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm text-gray-300">
        Format
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputCls}>
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
    </div>
  );
}
