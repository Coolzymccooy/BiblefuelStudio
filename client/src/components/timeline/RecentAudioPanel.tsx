import { Plus, Waves, Music } from 'lucide-react';

/**
 * Recently used audio, with the three things you can do with a clip:
 * add it to the assembly, adopt it as the source, or use it as the music bed.
 *
 * Extracted from TimelinePage for the editor shell's Voice tool. Presentational
 * only — the page keeps the history and the handlers.
 */

export interface AudioHistoryItem {
  id: string;
  path: string;
  kind: string;
}

/** Long histories are capped: this is a quick-access list, not an archive. */
export const MAX_VISIBLE = 25;

export interface RecentAudioPanelProps {
  items: AudioHistoryItem[];
  onAddClip: (path: string, kind: string) => void;
  onUseAsSource: (path: string) => void;
  onUseAsMusicBed: (path: string) => void;
}

// Shared vocabulary rather than a local style: see .icon-btn in index.css.
const ICON_BUTTON = 'icon-btn';

export function RecentAudioPanel({
  items,
  onAddClip,
  onUseAsSource,
  onUseAsMusicBed,
}: RecentAudioPanelProps) {
  if (items.length === 0) {
    return <p className="text-help">No audio history yet.</p>;
  }

  return (
    <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
      {items.slice(0, MAX_VISIBLE).map((item) => {
        // Full path stays in the title attribute: the basename is what the user
        // recognises, but the path is what they need when something is wrong.
        const name = item.path.split(/[\\/]/).pop() || item.path;
        return (
          <div
            key={item.id}
            className="surface-raised flex items-center gap-2 rounded-lg px-2 py-1.5"
          >
            <span
              className="min-w-0 flex-1 truncate text-xs text-content-secondary"
              title={item.path}
            >
              {name}
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                onClick={() => onAddClip(item.path, item.kind)}
                title="Add to assembly"
                aria-label={`Add ${name} to assembly`}
                className={ICON_BUTTON}
              >
                <Plus size={13} />
              </button>
              <button
                onClick={() => onUseAsSource(item.path)}
                title="Use as source"
                aria-label={`Use ${name} as source`}
                className={ICON_BUTTON}
              >
                <Waves size={13} />
              </button>
              <button
                onClick={() => onUseAsMusicBed(item.path)}
                title="Use as music bed"
                aria-label={`Use ${name} as music bed`}
                className={ICON_BUTTON}
              >
                <Music size={13} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
