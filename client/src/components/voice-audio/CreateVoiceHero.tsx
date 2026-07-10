import { useState, type ReactNode } from 'react';
import { Wand2, Clipboard, Mic } from 'lucide-react';
import { Textarea } from '../ui/Textarea';
import { Button } from '../ui/Button';

interface CreateVoiceHeroProps {
  ttsText: string;
  onTtsTextChange: (v: string) => void;
  onUseLatestScript: () => void;
  onFormatForVoice: () => void;
  onInsertTemplate: () => void;
  providerControls: ReactNode;
  recordUploadPanel: ReactNode;
}

export function CreateVoiceHero({
  ttsText, onTtsTextChange, onUseLatestScript, onFormatForVoice, onInsertTemplate,
  providerControls, recordUploadPanel,
}: CreateVoiceHeroProps) {
  const [showRecord, setShowRecord] = useState(false);
  return (
    <section className="rounded-bf border border-[rgba(216,184,120,0.28)] bg-bf-card p-4 sm:p-5">
      <h2 className="font-serif text-xl text-bf-cream">Create a voice</h2>
      <p className="text-help mt-0.5">Paste a hook, verse, reflection or prayer — then generate, or record your own.</p>

      <div className="mt-4">
        <Textarea
          value={ttsText}
          onChange={(e) => onTtsTextChange(e.target.value)}
          placeholder="Paste hook + verse + reflection"
          className="min-h-[160px]"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button onClick={onUseLatestScript} variant="secondary" className="text-xs h-8"><Wand2 size={14} className="mr-2" />Use Latest Script</Button>
          <Button onClick={onFormatForVoice} variant="secondary" className="text-xs h-8">Format for Voice</Button>
          <Button onClick={onInsertTemplate} variant="secondary" className="text-xs h-8"><Clipboard size={14} className="mr-2" />Insert Template</Button>
        </div>
      </div>

      <div className="mt-4">{providerControls}</div>

      <button
        type="button"
        onClick={() => setShowRecord((v) => !v)}
        className="mt-4 inline-flex items-center gap-1.5 text-xs text-bf-goldDeep hover:text-bf-gold"
        aria-expanded={showRecord}
      >
        <Mic size={13} /> or record / upload
      </button>
      {showRecord && <div className="mt-3">{recordUploadPanel}</div>}
    </section>
  );
}
