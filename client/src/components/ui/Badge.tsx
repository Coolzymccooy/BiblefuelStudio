interface BadgeProps {
    children: React.ReactNode;
    variant?: 'default' | 'success' | 'warning' | 'danger';
    className?: string;
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
    const variantStyles = {
        default: 'bg-white/10 text-gray-200 border border-white/10',
        success: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20',
        warning: 'bg-yellow-500/15 text-yellow-200 border border-yellow-500/25',
        danger: 'bg-red-500/15 text-red-300 border border-red-500/25',
    };

    return (
        <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${variantStyles[variant]} ${className}`}>
            {children}
        </span>
    );
}
