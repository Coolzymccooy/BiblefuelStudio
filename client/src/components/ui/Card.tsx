import type { ReactNode, ElementType } from 'react';

interface CardProps {
    title?: string;
    children: ReactNode;
    className?: string;
    icon?: ElementType;
}

export function Card({ title, children, className = '', icon: Icon }: CardProps) {
    return (
        <div className={`card ${className}`}>
            <div className="card-glow" />
            {(title || Icon) && (
                <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-2">
                    {Icon && <Icon size={20} className="text-primary-400" />}
                    {title && <h3 className="text-lg font-semibold text-white">{title}</h3>}
                </div>
            )}
            <div className="relative z-10">
                {children}
            </div>
        </div>
    );
}
