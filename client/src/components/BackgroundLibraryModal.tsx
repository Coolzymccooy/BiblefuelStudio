import { useEffect, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, Library } from 'lucide-react';
import { Button } from './ui/Button';

/**
 * Minimal shape the picker needs. Every page's LibraryItem structurally
 * satisfies this — extra fields (savedAt, etc.) are ignored here.
 */
export interface LibraryPickerItem {
    id: string;
    url?: string;
    previewUrl?: string;
    image?: string;
    kind?: 'image' | 'video';
}

interface BackgroundLibraryModalProps<T extends LibraryPickerItem> {
    open: boolean;
    onClose: () => void;
    items: T[];
    isLoading: boolean;
    /**
     * 'multi'  — numbered, ordered multi-select with a Clear all + Done footer
     *            (Render / Timeline: order = render sequence).
     * 'single' — pick one clip and close immediately (Queue batch background).
     */
    mode?: 'multi' | 'single';
    title?: string;
    /** Ordered selected ids (multi only) — drives the numbered badges + header count. */
    selectedIds?: string[];
    /** Max selectable (multi only) — shown as "X of MAX" and dims tiles at cap. */
    max?: number;
    /** Tile tap: toggle (multi) or select (single). In single mode the modal closes after. */
    onPick: (item: T) => void;
    /** Clear all selections (multi only). */
    onClear?: () => void;
    /** Done button (multi only). Falls back to onClose. */
    onDone?: () => void;
    /** Thumbnail URL resolver. Defaults to item.image || item.url. */
    getImageSrc?: (item: T) => string;
    /** Optional hover-preview video URL. Return null/'' to skip (no <video> rendered). */
    getVideoSrc?: (item: T) => string | null;
    /** Optional <img> error handler (fallback thumbnails). */
    onImageError?: (e: SyntheticEvent<HTMLImageElement>, item: T) => void;
}

const defaultImageSrc = (item: LibraryPickerItem): string => item.image || item.url || '';

/**
 * Shared background-library picker used by Render, Timeline and Queue.
 *
 * Consolidating the three previously-duplicated (and drifted) copies fixes the
 * mobile bug in one place: tiles use a padding-box aspect ratio instead of CSS
 * `aspect-ratio`, which iOS Safari collapses into thin stacked strips when the
 * grid child holds `h-full` media. Sizing uses dvh (not vh) so the footer stays
 * on-screen under Safari's bottom toolbar, and the footer respects the safe area.
 */
export function BackgroundLibraryModal<T extends LibraryPickerItem>({
    open,
    onClose,
    items,
    isLoading,
    mode = 'multi',
    title,
    selectedIds = [],
    max,
    onPick,
    onClear,
    onDone,
    getImageSrc = defaultImageSrc,
    getVideoSrc,
    onImageError,
}: BackgroundLibraryModalProps<T>) {
    const isMulti = mode === 'multi';

    // Close on Escape — cheap keyboard affordance the old inline modals lacked.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    const heading = title ?? (isMulti ? 'Select Backgrounds' : 'Select Background');
    const subtitle = isMulti
        ? `${selectedIds.length}${max ? ` of ${max}` : ''} selected · click to toggle, order = render sequence`
        : 'Tap a clip to use it as the background';
    const atCap = isMulti && typeof max === 'number' && selectedIds.length >= max;

    // Portal to <body>: the page shell wraps content in a transformed ancestor
    // (Tailwind `transform`/animation utilities set `transform: matrix(...)`),
    // which becomes the containing block for `position: fixed`. Rendered inline,
    // the overlay would center against the full (scrolled) page height instead
    // of the viewport — on mobile this pushed the Done/Clear footer ~500px below
    // the screen. Portaling escapes that ancestor so `fixed inset-0` tracks the
    // real viewport again.
    return createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-2 sm:p-4">
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />
            {/* Plain div (not <Card>): Card wraps children in an extra div that
                breaks `flex flex-col`, leaving the scroll grid unconstrained so
                content overflows below the viewport with no scrollbar.
                max-h in dvh (not vh) keeps the footer visible under Safari's
                bottom toolbar. */}
            <div
                role="dialog"
                aria-modal="true"
                aria-label={heading}
                className="relative w-full max-w-[min(1280px,95vw)] max-h-[calc(100dvh-1rem)] flex flex-col rounded-xl bg-dark-900/95 backdrop-blur-xl border border-white/20 shadow-2xl overflow-hidden"
            >
                <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
                    <div>
                        <h3 className="font-bold text-lg text-white">{heading}</h3>
                        <p className="text-subtitle mt-0.5">{subtitle}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-white"
                        aria-label="Close"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 content-start gap-3 pb-24">
                    {isLoading ? (
                        <div className="col-span-full py-20 flex justify-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-500" />
                        </div>
                    ) : items.length > 0 ? (
                        items.map((item) => {
                            const selectedIdx = selectedIds.indexOf(item.id);
                            const isSelected = selectedIdx !== -1;
                            const disabled = !isSelected && atCap;
                            const videoSrc = getVideoSrc?.(item) || null;
                            return (
                                <div
                                    key={item.id}
                                    // aspect-[9/16] gives each tile a real, width-derived height.
                                    // A percentage-padding spacer looks equivalent but contributes
                                    // 0 to CSS-grid row sizing, so `align-content` stretched the
                                    // rows to fill the grid — collapsing a full library into thin
                                    // strips. aspect-ratio DOES feed track sizing; the media is
                                    // absolutely positioned (not a flow `h-full` child), which is
                                    // what avoids the iOS Safari aspect-ratio collapse.
                                    className={`group relative aspect-[9/16] bg-black rounded-xl overflow-hidden transition-all shadow-lg cursor-pointer ${
                                        isSelected
                                            ? 'ring-2 ring-primary-400'
                                            : disabled
                                                ? 'ring-1 ring-white/10 hover:ring-amber-400/50'
                                                : 'hover:ring-2 hover:ring-primary-500'
                                    }`}
                                    // Tap always goes through — onPick owns the cap (it toasts a
                                    // hint) so users can still tell every clip apart instead of
                                    // fading unselected tiles into an indistinct grey mass.
                                    onClick={() => {
                                        onPick(item);
                                        if (!isMulti) onClose();
                                    }}
                                >
                                    {/* Full-opacity thumbnails so each background reads as a
                                        distinct image; at cap, unselected tiles stay visible
                                        (slightly dimmed) rather than greying out. */}
                                    <img
                                        src={getImageSrc(item)}
                                        className={`absolute inset-0 w-full h-full object-cover transition-opacity ${disabled ? 'opacity-70' : 'opacity-100'}`}
                                        alt=""
                                        loading="lazy"
                                        onError={onImageError ? (e) => onImageError(e, item) : undefined}
                                    />
                                    {videoSrc && (
                                        <video
                                            src={videoSrc}
                                            className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity"
                                            muted
                                            loop
                                            playsInline
                                            autoPlay
                                            preload="metadata"
                                            onError={(e) => {
                                                e.currentTarget.style.display = 'none';
                                            }}
                                        />
                                    )}
                                    {isSelected && (
                                        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary-500 text-white text-[11px] font-bold flex items-center justify-center shadow-lg">
                                            {selectedIdx + 1}
                                        </div>
                                    )}
                                    <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                                        <p className="text-[10px] font-mono text-white truncate">ID: {item.id}</p>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="col-span-full py-20 text-center opacity-30 text-white">
                            <Library size={48} className="mx-auto mb-4" />
                            <p>Your library is empty.</p>
                        </div>
                    )}
                </div>

                {isMulti && (
                    <div className="flex items-center justify-between p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-white/10 bg-black/30 shrink-0">
                        <Button
                            variant="secondary"
                            className="text-xs h-9"
                            onClick={onClear}
                            disabled={selectedIds.length === 0}
                        >
                            Clear all
                        </Button>
                        <Button className="text-xs h-9" onClick={onDone ?? onClose}>
                            <CheckCircle2 size={14} className="mr-1.5" />
                            Done
                        </Button>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
