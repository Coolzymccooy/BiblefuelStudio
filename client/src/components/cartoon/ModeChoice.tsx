/**
 * The first choice when starting a scene script: Human (today's flow, a
 * narrated cinematic film) or Cartoon (characters who speak their own lines).
 * Two large cards, because this decides everything that follows.
 */
import { Clapperboard, Drama, type LucideIcon } from 'lucide-react';

export type SceneScriptMode = 'human' | 'cartoon';

interface Props {
  selected: SceneScriptMode | null;
  onChoose: (mode: SceneScriptMode) => void;
}

const MODES: { id: SceneScriptMode; title: string; subtitle: string; Icon: LucideIcon }[] = [
  {
    id: 'human',
    title: 'Human',
    subtitle: 'Paste a cinematic script. BibleFuel voices every line as written, films each scene\'s visual and follows your music cues.',
    Icon: Clapperboard,
  },
  {
    id: 'cartoon',
    title: 'Cartoon',
    subtitle: 'Characters speak their own lines. Up to 40 seconds.',
    Icon: Drama,
  },
];

export function ModeChoice({ selected, onChoose }: Props) {
  return (
    <div role="group" aria-label="How should this script be filmed?" className="grid gap-3 sm:grid-cols-2">
      {MODES.map(({ id, title, subtitle, Icon }) => {
        const active = selected === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => onChoose(id)}
            className={`flex flex-col items-start gap-3 rounded-card border bg-bf-card p-6 text-left transition-colors duration-150 hover:border-editor-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bf-gold ${active ? 'border-editor-accent' : 'border-editor-line'}`}
          >
            <Icon size={24} className="text-bf-gold" aria-hidden="true" />
            <span className="text-base font-semibold text-bf-cream">{title}</span>
            <span className="text-help">{subtitle}</span>
          </button>
        );
      })}
    </div>
  );
}
