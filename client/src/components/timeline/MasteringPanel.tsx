import { Volume2 } from 'lucide-react';

/**
 * Audio mastering: loudness normalisation, fades, de-esser.
 *
 * Extracted from TimelinePage for the editor shell's Audio properties rail.
 * Presentational only — the page keeps the state.
 *
 * The LUFS range is -24..-6, which is the broadcast-sane window: -24 is quiet
 * enough for a room mix, -6 is as hot as a speech render should ever go before
 * it starts clipping on phone speakers.
 */

export const LUFS_MIN = -24;
export const LUFS_MAX = -6;

export interface MasteringPanelProps {
  /** Target integrated loudness in LUFS. */
  normalizeLUFS: number;
  onNormalizeLUFSChange: (value: number) => void;
  fadeInMs: number;
  onFadeInChange: (value: number) => void;
  fadeOutMs: number;
  onFadeOutChange: (value: number) => void;
  deEsser: boolean;
  onDeEsserChange: (value: boolean) => void;
  /** Stacks vertically in a narrow properties rail, in a row on a wide card. */
  layout?: 'row' | 'column';
}

export function MasteringPanel({
  normalizeLUFS,
  onNormalizeLUFSChange,
  fadeInMs,
  onFadeInChange,
  fadeOutMs,
  onFadeOutChange,
  deEsser,
  onDeEsserChange,
  layout = 'row',
}: MasteringPanelProps) {
  const grid =
    layout === 'column'
      ? 'grid grid-cols-1 gap-4'
      : 'grid grid-cols-1 gap-6 p-2 md:grid-cols-4';

  return (
    <div className={grid}>
      <div className="space-y-4">
        <label htmlFor="mastering-lufs" className="text-caption flex items-center gap-2 font-bold">
          <Volume2 size={14} /> Normalize (LUFS)
        </label>
        <div className="flex items-center gap-3">
          <input
            id="mastering-lufs"
            type="range"
            min={LUFS_MIN}
            max={LUFS_MAX}
            value={normalizeLUFS}
            onChange={(e) => onNormalizeLUFSChange(Number(e.target.value))}
            className="flex-1 accent-primary-500"
          />
          <span className="w-8 font-mono text-xs">{normalizeLUFS}</span>
        </div>
      </div>

      <div className="space-y-4">
        <label htmlFor="mastering-fade-in" className="text-caption flex items-center gap-2 font-bold">
          Fade In (ms)
        </label>
        <input
          id="mastering-fade-in"
          type="number"
          className="w-full rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-xs"
          value={fadeInMs}
          onChange={(e) => onFadeInChange(Number(e.target.value))}
        />
      </div>

      <div className="space-y-4">
        <label htmlFor="mastering-fade-out" className="text-caption flex items-center gap-2 font-bold">
          Fade Out (ms)
        </label>
        <input
          id="mastering-fade-out"
          type="number"
          className="w-full rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-xs"
          value={fadeOutMs}
          onChange={(e) => onFadeOutChange(Number(e.target.value))}
        />
      </div>

      <div className={`flex items-center gap-3 ${layout === 'row' ? 'pt-6' : ''}`}>
        <input
          type="checkbox"
          id="deess"
          checked={deEsser}
          onChange={(e) => onDeEsserChange(e.target.checked)}
          className="rounded border-white/10 bg-black/50 checked:bg-primary-500"
        />
        <label htmlFor="deess" className="text-xs text-gray-400">
          Enable De-esser
        </label>
      </div>
    </div>
  );
}
