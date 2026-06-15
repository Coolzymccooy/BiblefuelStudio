import { type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { useFileDrop } from '../../lib/useFileDrop';

interface DropZoneProps {
    /** Receives the dropped files (already filtered by `accept`). */
    onFiles: (files: File[]) => void;
    /** Allowed extensions / mime types / wildcards (e.g. ['.png','image/*']). */
    accept?: string[];
    /** When false, only the first dropped file is passed through. Default true. */
    multiple?: boolean;
    disabled?: boolean;
    /** Text shown in the drag overlay. */
    overlayLabel?: string;
    className?: string;
    children: ReactNode;
}

/**
 * Wraps any upload UI to accept drag-and-dropped files. Shows a dashed overlay
 * while a file is dragged over it, then forwards the files to `onFiles`. The
 * overlay is pointer-events-none so it never swallows the drop. Pair it with
 * the existing hidden <input type=file> + button so click-to-browse still works.
 */
export function DropZone({
    onFiles,
    accept,
    multiple = true,
    disabled,
    overlayLabel = 'Drop file to upload',
    className = '',
    children,
}: DropZoneProps) {
    const { isDragging, dropProps } = useFileDrop({
        accept,
        disabled,
        onFiles: (files) => {
            if (!files.length) return;
            onFiles(multiple ? files : [files[0]]);
        },
    });

    return (
        <div className={`relative ${className}`} {...dropProps}>
            {children}
            {isDragging && (
                <div className="absolute inset-0 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-primary-400 bg-primary-500/15 backdrop-blur-[2px] pointer-events-none animate-fade-in">
                    <div className="flex items-center gap-2 text-sm font-medium text-primary-100">
                        <Upload size={18} /> {overlayLabel}
                    </div>
                </div>
            )}
        </div>
    );
}
