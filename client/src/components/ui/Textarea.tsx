import type { TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { }

export function Textarea({ className = '', ...props }: TextareaProps) {
    return (
        <textarea
            className={`input min-h-[92px] ${className}`}
            {...props}
        />
    );
}
