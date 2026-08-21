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

const ACTION_CLASS =
  'inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors disabled:cursor-not-allowed disabled:opacity-50';

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
      <p className="text-help mb-3">
        Drop in a finished sermon — audio (MP3, WAV, M4A) or video (MP4, MOV, WEBM),
        up to {maxUploadMb} MB.
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
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-300">
            <span className="min-w-0">
              <span className="text-content-tertiary">Loaded ({sourceMediaKind}):</span>{' '}
              <span className="break-all font-mono">{fileName}</span>
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

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {sourceMediaKind === 'video' && (
                <button
                  type="button"
                  onClick={onPreviewSource}
                  disabled={!sourceMediaPath}
                  className={ACTION_CLASS}
                  title={
                    sourceMediaPreviewPath
                      ? 'Opens the source or proxy preview in the preview modal.'
                      : 'Upload source media first.'
                  }
                >
                  <Play size={12} /> Preview source
                </button>
              )}

              {sourceMediaKind === 'audio' && (
                <button
                  type="button"
                  onClick={() => sourceMediaPath && onUseAsMusicBed(sourceMediaPath)}
                  className={ACTION_CLASS}
                >
                  <Music size={12} /> Use as Music Bed
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
                disabled={!sourceMediaPath || !sourceMediaKind || !hasProject}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary-500/15 px-2 py-1 text-primary-100 transition-colors hover:bg-primary-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                title={
                  hasProject
                    ? 'Insert this source media into the active documentary timeline'
                    : 'Create a documentary timeline first'
                }
              >
                <Plus size={12} /> Insert source media
              </button>

              <button
                type="button"
                onClick={onInsertVoiceoverPlaceholder}
                disabled={!hasProject}
                className={ACTION_CLASS}
                title={
                  hasProject
                    ? 'Insert a Chatterbox placeholder into the documentary timeline'
                    : 'Create a documentary timeline first'
                }
              >
                <Sparkles size={12} /> Insert VO placeholder
              </button>
            </div>
          </div>
        )}
      </DropZone>
    </div>
  );
}
