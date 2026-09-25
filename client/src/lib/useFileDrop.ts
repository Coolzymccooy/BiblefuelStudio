import { useRef, useState, type DragEvent } from 'react';

/**
 * Does a file satisfy an `accept` list? Entries may be extensions ('.png'),
 * mime types ('image/png'), or wildcards ('image/*'). An empty/undefined list
 * accepts everything. Best-effort — the upload handler still validates.
 */
export function fileMatchesAccept(file: { name: string; type: string }, accept?: string[]): boolean {
    if (!accept || accept.length === 0) return true;
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    return accept.some((entry) => {
        const a = entry.trim().toLowerCase();
        if (!a) return false;
        if (a.startsWith('.')) return name.endsWith(a);
        if (a.endsWith('/*')) return type.startsWith(a.slice(0, -1)); // 'image/' prefix
        return type === a;
    });
}

interface UseFileDropOptions {
    onFiles: (files: File[]) => void;
    accept?: string[];
    disabled?: boolean;
}

interface FileDropHandlers {
    onDragEnter: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
}

/**
 * Drag-and-drop file support for an element. Returns `isDragging` (for visual
 * feedback) and `dropProps` to spread onto the drop target. Uses an enter/leave
 * depth counter so hovering child elements doesn't flicker the highlight, and
 * only reacts to actual file drags (not text/element drags).
 */
export function useFileDrop({ onFiles, accept, disabled }: UseFileDropOptions): {
    isDragging: boolean;
    dropProps: FileDropHandlers;
} {
    const [isDragging, setIsDragging] = useState(false);
    const depth = useRef(0);

    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes('Files');

    const reset = () => { depth.current = 0; setIsDragging(false); };

    const onDragEnter = (e: DragEvent) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setIsDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault(); // required to allow a drop
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (_e: DragEvent) => {
        if (disabled) return;
        depth.current -= 1;
        if (depth.current <= 0) reset();
    };
    const onDrop = (e: DragEvent) => {
        if (disabled) return;
        e.preventDefault();
        reset();
        const files = Array.from(e.dataTransfer?.files || []).filter((f) => fileMatchesAccept(f, accept));
        if (files.length) onFiles(files);
    };

    return { isDragging, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
