import { useState, type ReactNode, type ElementType } from 'react';
import { ChevronDown } from 'lucide-react';
import { InfoTooltip } from './InfoTooltip';

interface CardProps {
    title?: string;
    children: ReactNode;
    className?: string;
    icon?: ElementType;
    /** When true the card header becomes a toggle and children hide when collapsed. */
    collapsible?: boolean;
    /** Initial open state when collapsible. Defaults to true. */
    defaultOpen?: boolean;
    /** Renders an (i) icon next to the title that reveals helper text on hover/tap. */
    tooltip?: ReactNode;
    /** Optional secondary content at the right of the header (badges, etc). */
    headerExtra?: ReactNode;
}

export function Card({
    title,
    children,
    className = '',
    icon: Icon,
    collapsible = false,
    defaultOpen = true,
    tooltip,
    headerExtra,
}: CardProps) {
    const [open, setOpen] = useState(defaultOpen);
    const showHeader = !!(title || Icon || tooltip || headerExtra);
    const isOpen = collapsible ? open : true;

    const headerInner = (
        <>
            <div className="flex items-center gap-2 min-w-0 flex-1">
                {Icon && <Icon size={20} className="text-primary-400 shrink-0" />}
                {title && <h3 className="text-lg font-semibold text-white truncate">{title}</h3>}
                {tooltip && (
                    <span className="inline-flex items-center" onClick={(e) => e.stopPropagation()}>
                        <InfoTooltip content={tooltip} width="lg" />
                    </span>
                )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {headerExtra}
                {collapsible && (
                    <ChevronDown
                        size={18}
                        className={`text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    />
                )}
            </div>
        </>
    );

    return (
        <div className={`card ${className}`}>
            <div className="card-glow" />
            {showHeader && (
                collapsible ? (
                    <button
                        type="button"
                        onClick={() => setOpen((v) => !v)}
                        aria-expanded={isOpen}
                        className={`w-full flex items-center gap-2 text-left -mx-5 sm:-mx-6 px-5 sm:px-6 py-1 -mt-1 hover:bg-white/[0.02] rounded-t-xl transition-colors ${isOpen ? 'mb-4 border-b border-white/10 pb-3' : 'pb-1'}`}
                    >
                        {headerInner}
                    </button>
                ) : (
                    <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-2">
                        {headerInner}
                    </div>
                )
            )}
            {isOpen && (
                <div className="relative z-10">
                    {children}
                </div>
            )}
        </div>
    );
}
