import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    isLoading?: boolean;
    children: ReactNode;
}

export function Button({
    variant = 'primary',
    isLoading = false,
    children,
    disabled,
    className = '',
    ...props
}: ButtonProps) {
    const baseStyles = 'px-4 py-2 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center gap-2 active:scale-[.97]';

    // Every variant resolves through THEME TOKENS. `secondary` used
    // bg-dark-900/70 + text-gray-200 and `ghost` used hover:text-white, which
    // are dark-only: in light mode a secondary button stayed a dark slab with
    // grey-on-grey text ("Add Clip" and "Save Project" were barely legible).
    const variantStyles = {
        primary: 'bg-accent-fill text-accent-ink hover:brightness-110 border border-transparent shadow-md',
        secondary: 'bg-editor-panel text-editor-text border border-editor-line hover:border-editor-accent/50 hover:bg-editor-hover',
        danger: 'bg-red-500/15 text-tone-danger border border-red-500/30 hover:bg-red-500/25',
        ghost: 'bg-transparent text-editor-dim border border-transparent hover:bg-editor-hover hover:text-editor-text',
    };

    // A *loading* button stays full-opacity with a crisp spinner so it reads as
    // "working", not broken. Only a genuinely disabled (non-loading) button
    // dims to 50%. Previously `disabled:opacity-50` fired for both — so a
    // loading button faded out, which looked blurry/stuck.
    const stateStyles = isLoading
        ? 'cursor-wait'
        : disabled
            ? 'opacity-50 cursor-not-allowed'
            : '';

    return (
        <button
            className={`${baseStyles} ${variantStyles[variant]} ${stateStyles} ${className}`}
            disabled={disabled || isLoading}
            aria-busy={isLoading || undefined}
            {...props}
        >
            {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {children}
        </button>
    );
}
