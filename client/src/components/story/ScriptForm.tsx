import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { STORY_SCRIPT_TEMPLATES, STORY_VOICES } from '../../lib/storyScript';
import { cleanSpeakableText } from '../../lib/speakableScript';
import { fieldLabelCls, inputCls, primaryBtnCls, secondaryBtnCls } from './formStyles';

interface ScriptFormProps {
  onGenerate: (idea: string, templateId: string, voiceId: string) => void;
  busy: boolean;
}

export function ScriptForm({ onGenerate, busy }: ScriptFormProps) {
  const [idea, setIdea] = useState('');
  const [templateId, setTemplateId] = useState(STORY_SCRIPT_TEMPLATES[0].id);
  const [voiceId, setVoiceId] = useState(STORY_VOICES[0].id);
  const canGenerate = cleanSpeakableText(idea).length > 0 && !busy;
  const formatIdea = () => setIdea(cleanSpeakableText(idea));

  return (
    <div className="space-y-3">
      <label className={fieldLabelCls}>
        Template
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className={inputCls}
        >
          {STORY_SCRIPT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>

      <label className={fieldLabelCls}>
        Your idea (rough is fine)
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          rows={4}
          placeholder="trusting god when life is hard and dark, hope comes in the morning"
          className={inputCls}
        />
      </label>

      <label className={fieldLabelCls}>
        Voice
        <select
          value={voiceId}
          onChange={(e) => setVoiceId(e.target.value)}
          className={inputCls}
        >
          {STORY_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </label>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={!idea.trim() || busy}
          onClick={formatIdea}
          className={`${secondaryBtnCls} w-full sm:w-auto`}
        >
          Format for Voiceover
        </button>
        <button
          type="button"
          disabled={!canGenerate}
          onClick={() => { const next = cleanSpeakableText(idea); setIdea(next); onGenerate(next, templateId, voiceId); }}
          className={`${primaryBtnCls} w-full sm:flex-1`}
        >
          {busy ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
          {busy ? 'Generating voiceover…' : 'Generate voiceover'}
        </button>
      </div>
    </div>
  );
}
