import { useState } from 'react';
import { Wand2, ArrowDownToLine } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

/**
 * The Script QUICK job, docked in the Timeline editor.
 *
 * Same generator and fields as the Scripts page (count / CTA style / length /
 * type), but the output lands HERE: "Add to Captions lane" turns the script
 * into caption clips on this timeline - no page navigation. Props-driven: the
 * page owns generation and the landing.
 */

export interface QuickScript {
  title: string;
  hook: string;
  verse: string;
  reference: string;
  reflection: string;
  cta: string;
}

export interface ScriptQuickConfig {
  count: number;
  ctaStyle: string;
  lengthSeconds: number;
  scriptType: string;
}

export interface ScriptQuickPanelProps {
  isGenerating: boolean;
  scripts: QuickScript[];
  onGenerate: (cfg: ScriptQuickConfig) => void;
  onAddToCaptions: (script: QuickScript) => void;
}

export function ScriptQuickPanel({
  isGenerating,
  scripts,
  onGenerate,
  onAddToCaptions,
}: ScriptQuickPanelProps) {
  const [count, setCount] = useState(1);
  const [ctaStyle, setCtaStyle] = useState('save');
  const [lengthSeconds, setLengthSeconds] = useState(20);
  const [scriptType, setScriptType] = useState('peace');

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-editor-dim">
        Topic in, a scroll-stopping script out — landing straight on this timeline.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 text-[10px] font-semibold text-editor-dim">
          Count
          <Input
            type="number"
            min={1}
            max={5}
            value={count}
            onChange={(e) => setCount(Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
            className="mt-1 bg-black/20"
          />
        </label>
        <label className="min-w-0 text-[10px] font-semibold text-editor-dim">
          CTA Style
          <Select value={ctaStyle} onChange={(e) => setCtaStyle(e.target.value)} className="mt-1">
            <option value="save">save</option>
            <option value="follow">follow</option>
            <option value="share">share</option>
            <option value="comment">comment</option>
          </Select>
        </label>
        <label className="min-w-0 text-[10px] font-semibold text-editor-dim">
          Length (seconds)
          <Input
            type="number"
            min={8}
            max={60}
            value={lengthSeconds}
            onChange={(e) => setLengthSeconds(Math.min(60, Math.max(8, Number(e.target.value) || 20)))}
            className="mt-1 bg-black/20"
          />
        </label>
        <label className="min-w-0 text-[10px] font-semibold text-editor-dim">
          Script type
          <Select value={scriptType} onChange={(e) => setScriptType(e.target.value)} className="mt-1">
            <option value="peace">Peace / storm</option>
            <option value="strength">Strength / battles</option>
            <option value="anxiety">Anxiety / fear</option>
            <option value="identity">Identity in Christ</option>
            <option value="prayer">Prayer / waiting</option>
            <option value="gratitude">Gratitude / mercy</option>
            <option value="forgiveness">Forgiveness / grace</option>
            <option value="purpose">Purpose / calling</option>
            <option value="healing">Healing / grief</option>
          </Select>
        </label>
      </div>

      <Button
        onClick={() => onGenerate({ count, ctaStyle, lengthSeconds, scriptType })}
        isLoading={isGenerating}
        className="h-9 w-full text-xs"
      >
        <Wand2 size={14} className="mr-1.5" />
        Generate
      </Button>

      {scripts.length === 0 ? (
        <p className="text-[11px] text-editor-faint">
          No scripts yet. Generate one, or write on the Scripts page — the library is shared.
        </p>
      ) : (
        <div className="space-y-2">
          {scripts.slice(0, 3).map((script, idx) => (
            <div
              key={`${script.title}-${idx}`}
              className="rounded-xl border border-editor-line bg-white/[0.02] p-3"
            >
              <p className="break-words text-xs font-bold text-editor-text">
                {idx + 1}. {script.title}
              </p>
              <div className="mt-2 space-y-1.5">
                {([['Hook', script.hook], ['Verse', script.verse], ['Reflection', script.reflection], ['CTA', script.cta]] as const)
                  .filter(([, text]) => Boolean(text))
                  .map(([part, text]) => (
                    <div key={part} className="min-w-0">
                      <span className="text-[8.5px] font-bold uppercase tracking-[.1em] text-editor-accent/80">{part}</span>
                      {/* break-words, never truncate: a clipped verse is a
                          dropped feature by the operator's standard. */}
                      <p className="break-words text-[11px] leading-snug text-editor-dim">{text}</p>
                    </div>
                  ))}
              </div>
              <Button
                variant="secondary"
                onClick={() => onAddToCaptions(script)}
                className="mt-2.5 h-9 w-full border-editor-line text-xs text-editor-accent"
              >
                <ArrowDownToLine size={14} className="mr-1.5" />
                Add to Captions lane
              </Button>
            </div>
          ))}
          <p className="text-[10px] leading-relaxed text-editor-faint">
            Adding turns each line into a caption clip, timed across the cut — editable like any other clip. To voice it, open the Voice tool: Use Latest Script reads this same library.
          </p>
        </div>
      )}
    </div>
  );
}
