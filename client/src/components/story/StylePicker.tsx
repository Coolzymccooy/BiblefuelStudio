import { STORY_STYLES } from '../../lib/storyWizard';

interface StylePickerProps {
  value: string;
  onChange: (styleId: string) => void;
}

export function StylePicker({ value, onChange }: StylePickerProps) {
  return (
    <div className="grid grid-cols-2 gap-3" role="group" aria-label="Visual style">
      {STORY_STYLES.map((style) => {
        const selected = style.id === value;
        return (
          <button
            key={style.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(style.id)}
            className={`text-left rounded-xl border p-3 transition-colors ${
              selected
                ? 'border-bf-goldDeep bg-[rgba(216,184,120,0.14)] shadow-sm'
                : 'border-[rgba(216,184,120,0.22)] bg-bf-card2/60 hover:border-bf-goldDeep'
            }`}
          >
            <div className="text-sm font-semibold text-bf-cream">{style.label}</div>
            <div className="mt-0.5 text-xs text-bf-sub">{style.blurb}</div>
          </button>
        );
      })}
    </div>
  );
}
