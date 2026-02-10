import type { SelectHTMLAttributes } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    children: React.ReactNode;
}

export function Select({ className = '', children, ...props }: SelectProps) {
    return (
        <select
            className={`input cursor-pointer ${className}`}
            {...props}
        >
            {children}
        </select>
    );
}
