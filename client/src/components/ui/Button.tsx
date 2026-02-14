import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger';
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
    const baseStyles = 'px-4 py-2 rounded-lg font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2';

    const variantStyles = {
        primary: 'bg-primary-500 text-black hover:bg-primary-400 border border-primary-400/40 shadow-lg shadow-black/30',
        secondary: 'bg-dark-900/70 text-gray-200 border border-white/10 hover:bg-dark-900/90 hover:border-white/20',
        danger: 'bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25',
    };

    return (
        <button
            className={`${baseStyles} ${variantStyles[variant]} ${className}`}
            disabled={disabled || isLoading}
            {...props}
        >
            {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {children}
        </button>
    );
}
