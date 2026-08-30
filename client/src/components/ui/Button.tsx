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

    const variantStyles = {
        primary: 'bg-primary-500 text-black hover:bg-primary-400 border border-primary-400/40 shadow-lg shadow-black/30',
        secondary: 'bg-dark-900/70 text-gray-200 border border-white/10 hover:bg-dark-900/90 hover:border-white/20',
        danger: 'bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25',
        ghost: 'bg-transparent text-gray-300 border border-transparent hover:bg-white/5 hover:text-white',
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
