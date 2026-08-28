import { type SyntheticEvent } from 'react';
import { Library, Plus, ChevronUp, ChevronDown, Trash2, Sparkles, Scissors } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Field } from '../ui/Field';
import { DropZone } from '../ui/DropZone';
import type { GenerateMode } from '../../lib/generativeVisuals';

/**
 * The Backgrounds block for the Render screen: Auto toggle, the ordered
 * multi-background list (reorder / trim / remove), library + upload pickers,
 * AI visual generation and Ken Burns.
 *
 * Extracted from RenderPage so the editor shell and the classic layout render
 * the SAME 15 controls from one definition. Props-driven: the page keeps the
 * state and the upload/generation logic.
 */

export interface BackgroundItem {
  id: string;
  url: string;
  previewUrl?: string;
  image: string;
  savedAt?: string;
  kind?: 'image' | 'video';
}

export interface RenderBackgroundsPanelProps {
  autoBackground: boolean;
  onAutoBackgroundChange: (next: boolean) => void;
  backgroundPath: string;
  onBackgroundPathChange: (next: string) => void;
  backgroundItems: BackgroundItem[];
  isUploading: boolean;
  maxBackgrounds: number;
  maxUploadMb: number;
  durationSec: number;
  onDropFiles: (files: File[]) => void;
  onUploadFile: (file: File) => void;
  onOpenLibrary: () => void;
  onClearAll: () => void;
  onMoveUp: (idx: number) => void;
  onMoveDown: (idx: number) => void;
  onRemove: (idx: number) => void;
  onTrimItem: (item: BackgroundItem) => void;
  getImageSrc: (item: BackgroundItem) => string;
  onImageError: (event: SyntheticEvent<HTMLImageElement>, item: BackgroundItem) => void;
  genVisualsMode: GenerateMode;
  onGenVisualsModeChange: (next: GenerateMode) => void;
  genVisualsCount: number;
  onGenVisualsCountChange: (next: number) => void;
  onGenerateVisuals: () => void;
  isGeneratingVisuals: boolean;
  kenBurns: boolean;
  onKenBurnsChange: (next: boolean) => void;
}

const ACCEPT = ['image/*', 'video/*', '.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.webm', '.m4v'];

export function RenderBackgroundsPanel({
  autoBackground,
  onAutoBackgroundChange,
  backgroundPath,
  onBackgroundPathChange,
  backgroundItems,
  isUploading,
  maxBackgrounds,
  maxUploadMb,
  durationSec,
  onDropFiles,
  onUploadFile,
  onOpenLibrary,
  onClearAll,
  onMoveUp,
  onMoveDown,
  onRemove,
  onTrimItem,
  getImageSrc,
  onImageError,
  genVisualsMode,
  onGenVisualsModeChange,
  genVisualsCount,
  onGenVisualsCountChange,
  onGenerateVisuals,
  isGeneratingVisuals,
  kenBurns,
  onKenBurnsChange,
}: RenderBackgroundsPanelProps) {
  return (
    <div className="space-y-4">
      <Field
        label="Background"
        tooltip={`Pick 1–${maxBackgrounds} clips or images. With more than one, the render hard-cuts between them at equal slots (durationSec/N each) and automatically queues as a background job. Use the arrows to reorder.`}
      >
        {/* Auto background (video): default on. BibleFuel picks one
            clip per overlay line from your library, generating one if
            the library is empty. Picking clips below overrides it. */}
        <label className="flex items-start gap-2 mb-3 p-2 rounded-xl border border-primary-500/20 bg-primary-500/5 cursor-pointer">
          <input
            type="checkbox"
            checked={autoBackground}
            onChange={(e) => onAutoBackgroundChange(e.target.checked)}
            aria-label="Auto background"
            className="mt-0.5 accent-primary-500"
          />
          <span className="flex-1">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-primary-200">
              <Sparkles size={13} />
              Auto — let BibleFuel choose (video)
            </span>
            <span className="block text-[10px] text-content-secondary mt-0.5">
              {backgroundItems.length > 0 || backgroundPath
                ? 'Overridden — your selected background will be used.'
                : 'Picks a mood-matched clip per line from your library. Generates one if it’s empty.'}
            </span>
          </span>
        </label>
        {backgroundItems.length > 0 ? (
          <DropZone
            className="space-y-2"
            onFiles={onDropFiles}
            accept={ACCEPT}
            disabled={isUploading}
            overlayLabel="Drop image or video backgrounds"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-content-tertiary">
                {backgroundItems.length} background{backgroundItems.length === 1 ? '' : 's'} selected
              </span>
              <button
                type="button"
                onClick={onClearAll}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md text-gray-400 hover:text-red-300 hover:bg-red-500/15"
                aria-label="Clear all backgrounds"
              >
                <Trash2 size={12} /> Clear all
              </button>
            </div>
            <ul className="space-y-2 max-h-[22rem] overflow-y-auto pr-1">
              {backgroundItems.map((item, idx) => {
                const isImage = item.kind === 'image';
                return (
                  <li
                    key={`${item.id}-${idx}`}
                    className="flex items-center gap-2 p-2 rounded-lg border border-white/10 bg-white/[0.03]"
                  >
                    <div className="relative w-12 h-16 bg-black rounded overflow-hidden flex-shrink-0">
                      <img
                        src={getImageSrc(item)}
                        className="w-full h-full object-cover"
                        alt=""
                        loading="lazy"
                        onError={(e) => onImageError(e, item)}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-500/20 text-primary-200 font-semibold">
                          {idx + 1}/{backgroundItems.length}
                        </span>
                        {isImage && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-content-secondary">
                            img
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-content-tertiary truncate mt-0.5">
                        {String(item.id).split(/[\\/]/).pop()}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => onMoveUp(idx)}
                        disabled={idx === 0}
                        className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Move up"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        onClick={() => onMoveDown(idx)}
                        disabled={idx === backgroundItems.length - 1}
                        className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Move down"
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button
                        onClick={() => onRemove(idx)}
                        className="p-1.5 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-300"
                        aria-label="Remove"
                      >
                        <Trash2 size={14} />
                      </button>
                      {item.kind === 'video' && item.id && (
                        <button
                          type="button"
                          onClick={() => onTrimItem(item)}
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-black/50 text-primary-200 hover:bg-black/70"
                          title="Trim this clip"
                          aria-label="Trim this clip"
                        >
                          <Scissors size={13} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {backgroundItems.length > 1 && (
              <p className="text-[10px] text-content-secondary">
                Hard cuts between {backgroundItems.length} clips, ~{(durationSec / backgroundItems.length).toFixed(1)}s each. Auto-queues as background job.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={onOpenLibrary}
                variant="secondary"
                className="h-9 text-xs border-dashed border-white/10"
                disabled={backgroundItems.length >= maxBackgrounds}
              >
                <Library size={14} className="mr-1.5" />
                {backgroundItems.length >= maxBackgrounds ? 'Library' : 'Add from library'}
              </Button>
              <label
                className={`inline-flex items-center justify-center gap-1.5 h-9 text-xs rounded-md border cursor-pointer border-primary-500/30 bg-primary-500/10 text-primary-200 hover:bg-primary-500/20 ${backgroundItems.length >= maxBackgrounds || isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Plus size={14} />
                {isUploading ? 'Uploading…' : 'Upload from device'}
                <input
                  type="file"
                  className="hidden"
                  accept=".mp4,.mov,.webm,.m4v,.jpg,.jpeg,.png,.webp"
                  disabled={backgroundItems.length >= maxBackgrounds || isUploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <p className="text-help">
              Up to {maxUploadMb} MB per file. Video (mp4/mov/webm) or image (jpg/png/webp).
            </p>
          </DropZone>
        ) : (
          <DropZone
            className="flex flex-col gap-2"
            onFiles={onDropFiles}
            accept={ACCEPT}
            disabled={isUploading}
            overlayLabel="Drop image or video backgrounds"
          >
            <Input
              value={backgroundPath}
              onChange={(e) => onBackgroundPathChange(e.target.value)}
              placeholder="Pick a background video or image"
              className="bg-black/20"
            />
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={onOpenLibrary} variant="secondary" className="h-10 border-dashed border-white/10 text-xs">
                <Library size={14} className="mr-1.5" />
                From library
              </Button>
              <label
                className={`inline-flex items-center justify-center gap-1.5 h-10 text-xs rounded-md border cursor-pointer border-primary-500/30 bg-primary-500/10 text-primary-200 hover:bg-primary-500/20 ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Plus size={14} />
                {isUploading ? 'Uploading…' : 'Upload from device'}
                <input
                  type="file"
                  className="hidden"
                  accept=".mp4,.mov,.webm,.m4v,.jpg,.jpeg,.png,.webp"
                  disabled={isUploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <p className="text-help">
              Pick up to {maxBackgrounds}. Video (mp4/mov/webm) or image (jpg/png/webp). Up to {maxUploadMb} MB each.
            </p>
          </DropZone>
        )}
      </Field>

      <div className="mt-3 rounded-xl border border-primary-500/20 bg-primary-500/[0.04] p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-primary-300" />
          <span className="text-content-secondary text-xs font-medium">Generate visuals from my script</span>
        </div>
        <p className="text-meta">Bible-safe AI imagery (landscapes &amp; symbols) created from your lines. Uses your daily AI-image allowance.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={genVisualsMode}
            onChange={(e) => onGenVisualsModeChange(e.target.value as GenerateMode)}
            aria-label="How generated visuals combine with your backgrounds"
            className="h-9 text-xs rounded-md bg-dark-900/70 border border-white/10 px-2 text-gray-200"
          >
            <option value="alongside">Alongside my backgrounds</option>
            <option value="replace">Only AI visuals</option>
          </select>
          <select
            value={genVisualsCount}
            onChange={(e) => onGenVisualsCountChange(Number(e.target.value))}
            aria-label="How many images to generate"
            className="h-9 text-xs rounded-md bg-dark-900/70 border border-white/10 px-2 text-gray-200"
          >
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} image{n === 1 ? '' : 's'}</option>)}
          </select>
          <Button onClick={onGenerateVisuals} disabled={isGeneratingVisuals} className="h-9 text-xs">
            <Sparkles size={14} className="mr-1.5" />
            {isGeneratingVisuals ? 'Generating…' : 'Generate'}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-xs text-content-secondary cursor-pointer pt-1">
          <input type="checkbox" checked={kenBurns} onChange={(e) => onKenBurnsChange(e.target.checked)} aria-label="Ken Burns motion" className="rounded border-white/10 bg-black/50 checked:bg-primary-500" />
          Add subtle motion (Ken Burns) to image backgrounds
        </label>
      </div>
    </div>
  );
}
