import { useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { getStoredChoice, setTheme, type ThemeChoice } from '../lib/theme';

/**
 * Light / dark / system switcher.
 *
 * "System" is offered and is the default: a church laptop that switches to
 * light in the morning should follow, without anyone being taught where this
 * setting lives.
 */
const OPTIONS: Array<{ value: ThemeChoice; label: string; Icon: typeof Sun }> = [
    { value: 'light', label: 'Light', Icon: Sun },
    { value: 'dark', label: 'Dark', Icon: Moon },
    { value: 'system', label: 'System', Icon: Monitor },
];

export function ThemeToggle() {
    const [choice, setChoice] = useState<ThemeChoice>(() => getStoredChoice());

    const pick = (value: ThemeChoice) => {
        setChoice(value);
        setTheme(value);
    };

    return (
        <div>
            <p className="text-sm font-medium text-gray-200">Appearance</p>
            <p className="text-help mt-0.5 mb-3">
                Choose a theme, or follow your device setting.
            </p>
            <div
                role="radiogroup"
                aria-label="Theme"
                className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1"
            >
                {OPTIONS.map(({ value, label, Icon }) => {
                    const active = choice === value;
                    return (
                        <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => pick(value)}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                                active
                                    ? 'bg-primary-500/20 text-primary-100'
                                    : 'text-content-secondary hover:text-white'
                            }`}
                        >
                            <Icon size={13} />
                            {label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
