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
                ? 'border-primary-400 bg-primary-500/10'
                : 'border-white/10 bg-white/[0.03] hover:border-white/20'
            }`}
          >
            <div className="text-sm font-semibold text-white">{style.label}</div>
            <div className="text-xs text-gray-400 mt-0.5">{style.blurb}</div>
          </button>
        );
      })}
    </div>
  );
}
