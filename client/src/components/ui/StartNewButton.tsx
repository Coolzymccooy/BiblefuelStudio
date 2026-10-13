import { Plus } from 'lucide-react';
import { secondaryBtnCls } from '../story/formStyles';

interface StartNewButtonProps {
    onClick: () => void;
    disabled?: boolean;
    /** The small form for the editor's side panels; pages use the full button. */
    compact?: boolean;
}

/**
 * "Start new" wherever a creation page has a project open (Ambient, Moments,
 * Story Video, the editor's Story panel). It was faint grey text on each page
 * and easy to miss; this is one visible button so it looks and works the same
 * everywhere. Pages put it in ScreenHeader's `right` slot, never beside a wide
 * row of step tabs: that slot does not shrink, so on a phone the row pushed
 * the button off screen.
 */
export function StartNewButton({ onClick, disabled = false, compact = false }: StartNewButtonProps) {
    const cls = compact
        ? 'inline-flex shrink-0 items-center gap-1 rounded-md border border-editor-line px-2 py-1 text-[10px] font-semibold text-editor-dim hover:text-editor-text disabled:opacity-50'
        : `${secondaryBtnCls} whitespace-nowrap px-3 py-1.5 text-sm disabled:opacity-50`;
    return (
        <button type="button" disabled={disabled} onClick={onClick} className={cls}>
            <Plus size={compact ? 12 : 16} aria-hidden="true" /> Start new
        </button>
    );
}
