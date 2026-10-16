interface SeriesAiMotionOptionProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    /** "about 2 clips · ≈ $1.51" */
    estimate: string;
}

/**
 * The "AI motion" tick beside a Series part's "Send to Story Video" (super
 * admins only): the Story project animates its scenes once the pictures are
 * ready, within the month's AI budget.
 */
export function SeriesAiMotionOption({ checked, onChange, disabled = false, estimate }: SeriesAiMotionOptionProps) {
    return (
        <span className="inline-flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
                <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.checked)}
                    className="accent-primary-500"
                />
                AI motion
            </label>
            <span className="text-help tabular-nums">{estimate}</span>
        </span>
    );
}
