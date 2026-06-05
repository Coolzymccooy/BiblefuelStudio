import type { ReactNode } from 'react';
import { InfoTooltip } from './InfoTooltip';

interface FieldProps {
    label?: string;
    htmlFor?: string;
    /** Short inline helper text shown under the control. Use sparingly. */
    hint?: ReactNode;
    /** Description shown in an (i) icon tooltip next to the label. Preferred over `hint` for descriptive text. */
    tooltip?: ReactNode;
    badge?: ReactNode;
    children: ReactNode;
    className?: string;
}

/**
 * Form field primitive: label (optional info tooltip) + control + optional
 * helper text.
 *
 * Prefer `tooltip` over `hint` for descriptive help — tooltips reveal on
 * hover/focus/tap, keeping the form scannable. Reserve `hint` for short
 * dynamic context the user must see at a glance (e.g. live computed
 * warnings, format hints). Both can be used together but rarely should.
 */
export function Field({ label, htmlFor, hint, tooltip, badge, children, className = '' }: FieldProps) {
    return (
        <div className={className}>
            {(label || badge) && (
                <div className="flex items-center justify-between mb-1.5 gap-2">
                    {label && (
                        <label htmlFor={htmlFor} className="field-label !mb-0 inline-flex items-center gap-1.5">
                            <span>{label}</span>
                            {tooltip && <InfoTooltip content={tooltip} />}
                        </label>
                    )}
                    {badge && <div className="text-[0.6875rem] text-content-tertiary shrink-0">{badge}</div>}
                </div>
            )}
            {children}
            {hint && <p className="field-help">{hint}</p>}
        </div>
    );
}
