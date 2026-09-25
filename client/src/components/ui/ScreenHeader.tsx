import { type ReactNode } from 'react';

interface ScreenHeaderProps {
    /** Gold uppercase marker above the title (e.g. "Create", "Studio"). */
    eyebrow?: string;
    /** Serif display title. Use <em> for the italic gold accent word. */
    title: ReactNode;
    /** Optional muted line under the title. */
    subtitle?: ReactNode;
    /** Optional trailing content (bell, avatar, action). */
    right?: ReactNode;
    className?: string;
}

/**
 * The shared screen header from the mobile redesign: a gold eyebrow, a Cormorant
 * Garamond serif title, and an optional subtitle. Every in-app screen opens with
 * this so the app reads as one editorial system.
 */
export function ScreenHeader({ eyebrow, title, subtitle, right, className = '' }: ScreenHeaderProps) {
    return (
        <div className={`flex items-start justify-between gap-3 ${className}`}>
            <div className="min-w-0">
                {eyebrow && <div className="bf-eyebrow">{eyebrow}</div>}
                <h1 className="font-displaySerif text-[28px] leading-[1.08] font-semibold text-bf-cream mt-1.5 [&_em]:italic [&_em]:font-medium [&_em]:text-bf-gold">
                    {title}
                </h1>
                {subtitle && <p className="text-help mt-2 max-w-[46ch]">{subtitle}</p>}
            </div>
            {right && <div className="shrink-0">{right}</div>}
        </div>
    );
}
