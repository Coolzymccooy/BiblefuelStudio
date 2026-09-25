import { AnimationPicker } from '../voicelab/AnimationPicker';

/**
 * Kinetic caption styling: animation preset, text layout, layered depth.
 *
 * Extracted from TimelinePage's "Transcribe & Caption" card so the editor shell
 * can dock it under the Captions tool. Purely presentational — the page keeps
 * the state, so this stays reviewable and the extraction is a move rather than
 * a rewrite.
 *
 * The whole block is gated on kinetic captions being ON: with them off the
 * render is plain audio/video over a background, so animation and layout have
 * nothing to act on and showing them would imply an effect that never happens.
 */

export interface LayoutOption {
  value: string;
  label: string;
}

export interface CaptionStylePanelProps {
  /** When false the panel renders nothing — these controls have no effect. */
  enabled: boolean;
  typographyPreset: string;
  onTypographyPresetChange: (id: string) => void;
  layout: string;
  onLayoutChange: (value: string) => void;
  layoutOptions: LayoutOption[];
  /** Ghost shadow behind each word. */
  depth: boolean;
  onDepthChange: (value: boolean) => void;
}

export function CaptionStylePanel({
  enabled,
  typographyPreset,
  onTypographyPresetChange,
  layout,
  onLayoutChange,
  layoutOptions,
  depth,
  onDepthChange,
}: CaptionStylePanelProps) {
  if (!enabled) return null;

  return (
    <div className="mb-4">
      <p className="mb-2 text-xs text-gray-400">Kinetic typography style</p>
      <AnimationPicker value={typographyPreset} onChange={onTypographyPresetChange} />

      <div className="mt-3">
        <p className="mb-2 text-xs text-gray-400">Text layout</p>
        <select
          value={layout}
          onChange={(e) => onLayoutChange(e.target.value)}
          aria-label="Text layout"
          className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 focus:border-primary-500/40 focus:outline-none"
        >
          {layoutOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={depth}
            onChange={(e) => onDepthChange(e.target.checked)}
            className="rounded border-white/10 bg-black/50 checked:bg-primary-500"
          />
          Layered depth (ghost shadow behind each word)
        </label>
      </div>
    </div>
  );
}
