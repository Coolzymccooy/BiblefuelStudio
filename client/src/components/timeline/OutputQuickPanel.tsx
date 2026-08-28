import type { ReactNode } from 'react';
import { CheckCircle2, Circle, Video, Share2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { PanelSection } from '../editor/PanelSection';

/**
 * The Output tool for the Timeline editor: readiness as VISIBLE state (the
 * same refusals the Render button used to raise as toasts, one at a time),
 * the one Render action, the finished render, and the Share Kit - all
 * docked, no page hop. Props-driven; the page owns the render pipeline.
 */

export interface ReadinessItem {
  label: string;
  status: 'done' | 'todo' | 'optional';
  detail?: string;
  /** One-click fix for a blocker, e.g. "Send backgrounds to B-roll". */
  action?: { label: string; onClick: () => void };
}

export interface OutputQuickPanelProps {
  items: ReadinessItem[];
  renderLabel: string;
  renderHint: string;
  onRender: () => void;
  isRendering: boolean;
  /** 0-100 while rendering. */
  progress: number;
  renderedVideo: string | null;
  onPreviewOnStage: () => void;
  onShare: () => void;
  onDownload: () => void;
  shareKit: ReactNode;
  /** The full render configuration (classic Render's panels), docked below. */
  config?: ReactNode;
}

export function OutputQuickPanel({
  items, renderLabel, renderHint, onRender, isRendering, progress, renderedVideo,
  onPreviewOnStage, onShare, onDownload, shareKit, config,
}: OutputQuickPanelProps) {
  const blockers = items.filter((i) => i.status === 'todo');
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[.1em] text-editor-faint">What you need to render</p>
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.label} className="flex items-start gap-2">
              {item.status === 'done'
                ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-bf-success" />
                : <Circle size={13} className={`mt-0.5 shrink-0 ${item.status === 'todo' ? 'text-editor-accent' : 'text-editor-faint'}`} />}
              <div className="min-w-0">
                <p className={`text-[11px] ${item.status === 'todo' ? 'font-semibold text-editor-text' : 'text-editor-dim'}`}>{item.label}</p>
                {item.detail && <p className="break-words text-[10px] leading-snug text-editor-faint">{item.detail}</p>}
                {item.action && (
                  <button
                    type="button"
                    onClick={item.action.onClick}
                    className="mt-1 rounded-md border border-editor-accent/40 bg-editor-accent/10 px-2 py-0.5 text-[10px] font-semibold text-editor-accent transition hover:bg-editor-accent/20"
                  >
                    {item.action.label}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Button
        onClick={onRender}
        disabled={isRendering || blockers.length > 0}
        isLoading={isRendering}
        className="h-10 w-full text-xs"
        title={blockers[0]?.detail || renderHint}
      >
        <Video size={14} className="mr-1.5" />
        {isRendering ? `Rendering… ${Math.round(progress)}%` : renderLabel}
      </Button>
      <p className="text-[10px] leading-snug text-editor-faint">{renderHint}</p>
      {isRendering && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-primary-500 transition-all duration-150" style={{ width: `${Math.max(2, progress)}%` }} />
        </div>
      )}

      {renderedVideo && !isRendering && (
        <div className="space-y-2 rounded-xl border border-editor-line bg-white/[0.02] p-3">
          <p className="text-[11px] font-semibold text-editor-text">Latest render</p>
          <div className="grid grid-cols-2 gap-1.5">
            <Button onClick={onPreviewOnStage} className="h-8 text-[11px]">Preview on stage</Button>
            <Button variant="secondary" onClick={onShare} className="h-8 border-editor-line text-[11px]"><Share2 size={12} className="mr-1" />Share</Button>
          </div>
          <button type="button" onClick={onDownload} className="w-full text-center text-[10px] text-editor-dim underline-offset-2 hover:underline">Download MP4</button>
        </div>
      )}

      {config && (
        <PanelSection title="Render lab" summary="captions · visuals · audio · output · share" defaultOpen>
          {config}
        </PanelSection>
      )}

      <PanelSection title="Share Kit" summary="copy caption · auto-post">
        {shareKit}
      </PanelSection>
    </div>
  );
}
