import { Film, Play, Music, Scissors, Plus, Sparkles } from 'lucide-react';
import { DropZone } from '../ui/DropZone';

/**
 * Source media picker: upload a sermon, then act on it.
 *
 * Extracted verbatim from TimelinePage so the editor shell can dock it as a
 * panel. Deliberately presentational — every action arrives as a prop, so the
 * page keeps its state and this file stays reviewable. That split is the point:
 * TimelinePage is 2,500 lines and its last in-place refactor introduced four
 * regressions, so sections move out one at a time rather than being rewritten.
 */

export type SourceMediaKind = 'audio' | 'video' | 'image' | null;
/** The page stores this as a loose string, so accept one and narrow here. */
export type ProxyStatus = string | null;

export interface SourceMediaPanelProps {
  /** Null until something is uploaded — matches the page's own state shape. */
  sourceMediaPath: string | null;
  sourceMediaKind: SourceMediaKind;
  sourceMediaPreviewPath?: string | null;
  sourceMediaProxyPath?: string | null;
  sourceMediaProxyStatus?: ProxyStatus;
  isUploading: boolean;
  /** Null when no documentary timeline exists yet; gates the insert actions. */
  hasProject: boolean;
  maxUploadMb: number;
  onUpload: (file: File) => void;
  onPreviewSource: () => void;
  onUseAsMusicBed: (path: string) => void;
  onTrim: () => void;
  onInsertSourceMedia: () => void;
  onInsertVoiceoverPlaceholder: () => void;
}

const ACCEPT_ATTR =
  '.mp3,.wav,.m4a,.mp4,.mov,.webm,.m4v,.png,.jpg,.jpeg,.webp,.gif,audio/*,video/*,image/*';

const ACCEPT_LIST = [
  'audio/*', 'video/*', 'image/*',
  '.mp3', '.wav', '.m4a', '.mp4', '.mov', '.webm', '.m4v',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
];

const PROXY_TONE: Record<string, string> = {
  ready: 'bg-emerald-500/15 text-emerald-200',
  failed: 'bg-red-500/15 text-red-200',
};

// Tighter padding and a smaller size so three actions fit a 300px panel.
// 'Insert source media' was being clipped at the panel edge.
const ACTION_CLASS =
  'inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-1.5 py-1 text-[11px] text-primary-200 transition-colors hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-50';

export function SourceMediaPanel({
  sourceMediaPath,
  sourceMediaKind,
  sourceMediaPreviewPath,
  sourceMediaProxyPath,
  sourceMediaProxyStatus,
  isUploading,
  hasProject,
  maxUploadMb,
  onUpload,
  onPreviewSource,
  onUseAsMusicBed,
  onTrim,
  onInsertSourceMedia,
  onInsertVoiceoverPlaceholder,
}: SourceMediaPanelProps) {
  const fileName = sourceMediaPath?.split(/[\/]/).pop();

  return (
    <div>
      {/* Demoted to a caption. It is reference information — formats and a size
          cap — not an instruction, and at body size it out-shouted the Choose
          file button, which is the only thing on this panel that matters. */}
      <p className="mb-2.5 text-[10px] leading-snug text-content-tertiary">
        Sermon audio or video · up to {maxUploadMb} MB
      </p>

      <DropZone
        onFiles={(files) => onUpload(files[0])}
        accept={ACCEPT_LIST}
        multiple={false}
        disabled={isUploading || !hasProject}
        overlayLabel="Drop sermon audio, video, or image"
      >
        <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-primary-500/30 bg-primary-500/10 px-4 py-2 text-primary-200 hover:bg-primary-500/20">
          <Film size={16} />
          <span className="text-sm">{isUploading ? 'Uploading...' : 'Choose file'}</span>
          <input
            type="file"
            className="hidden"
            accept={ACCEPT_ATTR}
            disabled={isUploading || !hasProject}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
        </label>

        {!hasProject && (
          <p className="mt-2 text-[11px] text-content-tertiary">
            Create a documentary timeline first to insert source media.
          </p>
        )}

        {sourceMediaPath && (
          <div className="mt-3 flex flex-col gap-2 text-xs text-gray-300">
            <span className="min-w-0">
              {/* Truncated, not break-all. A 40-character job id wrapped over
                  three lines and became the loudest thing in the panel; the
                  full name stays available in the title attribute. */}
              <span className="text-[10px] uppercase tracking-wide text-content-tertiary">
                {sourceMediaKind}
              </span>
              <span
                className="ml-1.5 inline-block max-w-full truncate align-bottom font-mono text-[11px] text-content-secondary"
                title={fileName}
              >
                {fileName}
              </span>
              {sourceMediaKind === 'video' && sourceMediaProxyPath && (
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${
                    PROXY_TONE[sourceMediaProxyStatus || ''] || 'bg-amber-500/15 text-amber-200'
                  }`}
                >
                  Proxy{' '}
                  {sourceMediaProxyStatus === 'ready'
                    ? 'ready'
                    : sourceMediaProxyStatus === 'failed'
                      ? 'failed'
                      : 'pending'}
                </span>
              )}
            </span>

            <div className="flex flex-wrap items-center gap-1.5">
              {sourceMediaKind === 'video' && (
                <button
                  type="button"
                  onClick={onPreviewSource}
                  aria-label="Preview source"
                  disabled={!sourceMediaPath}
                  className={ACTION_CLASS}
                  title={
                    sourceMediaPreviewPath
                      ? 'Opens the source or proxy preview in the preview modal.'
                      : 'Upload source media first.'
                  }
                >
                  <Play size={12} /> Preview
                </button>
              )}

              {sourceMediaKind === 'audio' && (
                <button
                  type="button"
                  onClick={() => sourceMediaPath && onUseAsMusicBed(sourceMediaPath)}
                  aria-label="Use as Music Bed"
                  className={ACTION_CLASS}
                >
                  <Music size={12} /> Music bed
                </button>
              )}

              {sourceMediaKind !== 'image' && (
                <button type="button" onClick={onTrim} className={ACTION_CLASS}>
                  <Scissors size={12} /> Trim
                </button>
              )}

              <button
                type="button"
                onClick={onInsertSourceMedia}
                aria-label="Insert source media"
                disabled={!sourceMediaPath || !sourceMediaKind || !hasProject}
                className="inline-flex items-center gap-1 rounded-md bg-primary-500/15 px-1.5 py-1 text-[11px] text-primary-100 transition-colors hover:bg-primary-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                title={
                  hasProject
                    ? 'Insert this source media into the active documentary timeline'
                    : 'Create a documentary timeline first'
                }
              >
                <Plus size={12} /> Insert
              </button>

              <button
                type="button"
                onClick={onInsertVoiceoverPlaceholder}
                aria-label="Insert VO placeholder"
                disabled={!hasProject}
                className={ACTION_CLASS}
                title={
                  hasProject
                    ? 'Insert a Chatterbox placeholder into the documentary timeline'
                    : 'Create a documentary timeline first'
                }
              >
                <Sparkles size={12} /> VO
              </button>
            </div>
          </div>
        )}
      </DropZone>
    </div>
  );
}
