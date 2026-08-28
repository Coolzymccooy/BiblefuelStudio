import type { ChangeEvent } from 'react';
import { ClipboardList, Type, Sparkles } from 'lucide-react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { Field } from '../ui/Field';

/**
 * Caption controls for the Render screen.
 *
 * Extracted from RenderPage so the same panel can serve both the classic
 * layout and the editor shell. Props-driven on purpose: the page keeps the
 * state, this owns only the presentation, so the two layouts cannot drift
 * apart the way the Timeline's overlays did.
 */

export interface CaptionAnimationOption {
  id: string;
  label: string;
  /** Preview-only animations exist in the picker but do not survive a render. */
  renderable?: boolean;
}

export interface LayoutOption {
  value: string;
  label: string;
}

export interface CaptionMotionOption {
  id: string;
  label: string;
  description?: string;
}

export interface RenderCaptionsPanelProps {
  lines: string;
  onLinesChange: (next: string) => void;
  typographyPreset: string;
  onTypographyPresetChange: (next: string) => void;
  layout: string;
  onLayoutChange: (next: string) => void;
  layoutOptions: LayoutOption[];
  depth: boolean;
  onDepthChange: (next: boolean) => void;
  /** Caption animations from the server; may be empty while loading. */
  animations?: CaptionAnimationOption[];
  /** Caption MOTION options from the server (how captions are timed). */
  motions?: CaptionMotionOption[];
  captionMotion?: string;
  onCaptionMotionChange?: (next: string) => void;
  captionStagger?: boolean;
  onCaptionStaggerChange?: (next: boolean) => void;
  captionHighlight?: boolean;
  onCaptionHighlightChange?: (next: boolean) => void;
  /** True when a saved script is available to pull in. */
  hasScripts?: boolean;
  onOpenScripts: () => void;
  onUseLatestScript?: () => void;
  onFormatForVideo: () => void;
  maxLines: number;
  /** Docked in an editor panel: icon actions with tooltips, short labels. */
  compact?: boolean;
}

export function RenderCaptionsPanel({
  lines,
  onLinesChange,
  typographyPreset,
  onTypographyPresetChange,
  motions,
  captionMotion,
  onCaptionMotionChange,
  captionStagger,
  onCaptionStaggerChange,
  captionHighlight,
  onCaptionHighlightChange,
  layout,
  onLayoutChange,
  layoutOptions,
  depth,
  onDepthChange,
  animations = [],
  hasScripts = false,
  onOpenScripts,
  onUseLatestScript,
  onFormatForVideo,
  maxLines,
  compact = false,
}: RenderCaptionsPanelProps) {
  return (
    <div className="space-y-4">
      <Field
        label="Overlay text"
        badge={`Max ${maxLines} lines`}
        tooltip="One line per caption slide. Lines are auto-sliced to fit the frame and the chosen animation rhythm."
      >
        <Textarea
          value={lines}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onLinesChange(e.target.value)}
          placeholder="Enter your script lines here..."
          className={compact ? "bg-black/20 h-24 !text-[12px] leading-snug" : "bg-black/20 h-32"}
        />
        {/* Compact: one row of icon actions, the words live in tooltips. */}
        <div className={compact ? "mt-1.5 flex items-center gap-1.5" : "mt-2 flex flex-wrap gap-2"}>
          <Button
            variant="secondary"
            className={compact ? "h-7 w-8 !px-0 text-xs" : "h-8 text-xs"}
            onClick={onFormatForVideo}
            aria-label="Format for Video"
            title="Format for video — tidy the lines into short, speakable captions"
          >
            <Type size={14} className={compact ? "" : "mr-2"} />
            {!compact && 'Format for Video'}
          </Button>
          <Button
            variant="secondary"
            className={compact ? "h-7 w-8 !px-0 text-xs" : "h-8 text-xs"}
            onClick={onOpenScripts}
            aria-label="Pick From Scripts"
            title="Pick from scripts — choose a saved script from your library"
          >
            <ClipboardList size={14} className={compact ? "" : "mr-2"} />
            {!compact && 'Pick From Scripts'}
          </Button>
          {hasScripts && onUseLatestScript && (
            <Button
              variant="secondary"
              className={compact ? "h-7 w-8 !px-0 text-xs" : "h-8 text-xs"}
              onClick={onUseLatestScript}
              aria-label="Use Latest Script"
              title="Use latest script — drop in the newest script from your library"
            >
              <Sparkles size={14} className={compact ? "" : "mr-2"} />
              {!compact && 'Use Latest Script'}
            </Button>
          )}
        </div>
      </Field>

      {Array.isArray(motions) && motions.length > 0 && (
        <Field
          label="Caption motion"
          tooltip="How captions are TIMED, independent of how they look. Pick one base mode; stagger and highlight layer on top."
        >
          <Select
            aria-label="Caption motion"
            value={captionMotion || motions[0].id}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onCaptionMotionChange?.(e.target.value)}
          >
            {motions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
          <div className="mt-2 space-y-1.5">
            <label className="flex items-center gap-2 text-[12px] text-content-secondary" title="Lines arrive a beat apart">
              <input
                type="checkbox"
                checked={Boolean(captionStagger)}
                onChange={(e) => onCaptionStaggerChange?.(e.target.checked)}
              />
              {compact ? 'Stagger lines' : 'Stagger lines (arrive a beat apart)'}
            </label>
            {/* Highlighting the spoken word only means something when a whole
                line is on screen - in per-word mode there is nothing to
                highlight it against. */}
            {captionMotion !== 'words' && (
              <label className="flex items-center gap-2 text-[12px] text-content-secondary">
                <input
                  type="checkbox"
                  checked={Boolean(captionHighlight)}
                  onChange={(e) => onCaptionHighlightChange?.(e.target.checked)}
                />
                {compact ? 'Highlight words' : 'Highlight each word on the line'}
              </label>
            )}
          </div>
        </Field>
      )}

      <Field
        label="Caption animation"
        tooltip="Word-synced motion applies when Kinetic captions are on. The list matches the Voice Lab picker."
      >
        <Select
          aria-label="Caption animation"
          value={typographyPreset}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => onTypographyPresetChange(e.target.value)}
        >
          {animations.length > 0 && (
            <optgroup label="Caption animations (word-synced)">
              {animations.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}{a.renderable ? '' : ' (preview-only)'}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Classic presets (no motion)">
            <option value="cinematic-default">Cinematic (default)</option>
            <option value="intimate-fade">Intimate fade</option>
            <option value="scripture-emphasis">Scripture emphasis</option>
            <option value="playful-pop">Playful pop</option>
            <option value="worship-cinematic">Worship cinematic</option>
          </optgroup>
        </Select>
      </Field>

      <Field
        label="Text layout"
        tooltip="Where word captions sit on the frame. Bottom layouts keep text in the safe band above the TikTok/Reels caption strip; staggered alternates left/centre/right per phrase."
      >
        <Select
          aria-label="Text layout"
          value={layout}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => onLayoutChange(e.target.value)}
        >
          {layoutOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </Field>

      <label className={`flex items-center gap-2 cursor-pointer ${compact ? 'text-[12px] text-content-secondary' : 'text-sm text-gray-300'}`} title="Ghost shadow behind each word">
        <input
          type="checkbox"
          checked={depth}
          onChange={(e) => onDepthChange(e.target.checked)}
          className="rounded border-white/10 bg-black/50 checked:bg-primary-500"
        />
        {compact ? 'Layered depth' : 'Layered depth (ghost shadow behind each word)'}
      </label>
    </div>
  );
}
