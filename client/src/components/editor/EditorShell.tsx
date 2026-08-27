import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * CapCut-style editor shell: icon rail, docked panel, stage, bottom strip.
 *
 * Editing screens need a different shape from reading screens. The app's page
 * layout centres a column and leaves large desktop margins, which is right for
 * Scripts or Settings but wrong for a multi-track timeline — the surface that
 * most needs horizontal room got the least.
 *
 * WHY THE CHROME STAYS DARK IN BOTH THEMES
 * The rail, panel and bottom strip keep their dark surface even in light mode,
 * as CapCut does. Only the stage follows the theme. That is not an oversight:
 * it keeps the preview the brightest thing on screen, which is the entire point
 * of an editor. A light rail beside a dark video fights the content.
 *
 * The shell owns ONLY layout and which rail item is active. Panels, stage and
 * strip are passed in, so a page can adopt this without its logic moving.
 */

export interface EditorTool {
  /** Stable key, also used as the panel lookup. */
  id: string;
  /** Short label under the icon — keep to one word where possible. */
  label: string;
  icon: ReactNode;
  /** Optional count badge, e.g. clips on that track. */
  count?: number;
}

/** An icon-only operation on the current clip (split, delete, crop, speed…). */
export interface ClipAction {
  id: string;
  /** Accessible name AND tooltip. Icon-only buttons still need a real name. */
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

export interface EditorShellProps {
  tools: EditorTool[];
  /** Panel body per tool id. A missing entry renders the empty state. */
  panels: Record<string, ReactNode>;
  /** The preview area. */
  stage: ReactNode;
  /** Full-width bottom strip (timeline, transport). Optional. */
  strip?: ReactNode;
  /** Top bar content — project name, actions. */
  topBar?: ReactNode;
  /** Which tool starts selected; defaults to the first. */
  initialToolId?: string;
  /** Notified when the user switches tool, for pages that need to react. */
  onToolChange?: (toolId: string) => void;
  /**
   * Right-hand properties rail, shown only when there is something to inspect.
   * CapCut reveals this once a clip is selected; keeping it hidden otherwise is
   * what leaves the centre free for the preview.
   */
  propertyTools?: EditorTool[];
  propertyPanels?: Record<string, ReactNode>;
  /**
   * Dense icon-only toolbar above the timeline. Labels live in aria-label and
   * title rather than on screen — that density is how the chrome stays thin.
   */
  clipActions?: ClipAction[];
}

/** Panel resize bounds. Below the minimum the panel's own controls clip. */
const MIN_PANEL_W = 220;
const MAX_PANEL_W = 560;
const DEFAULT_PANEL_W = 300;
const PANEL_WIDTH_KEY = 'bf.editor.panelWidth';
/**
 * Timeline strip height bounds, as a PERCENTAGE of the shell.
 *
 * A percentage, not pixels: the operator asked that dragging the timeline up
 * must not squeeze the preview into nothing. Both surfaces then scale with the
 * window instead of one eating a fixed slice of a small screen.
 */
const MIN_STRIP_PCT = 15;
const MAX_STRIP_PCT = 65;
const DEFAULT_STRIP_PCT = 38;
const STRIP_HEIGHT_KEY = 'bf.editor.stripPct';
const APP_NAV_W = 240;
const RAIL_W = 60;

export function EditorShell({
  tools,
  panels,
  stage,
  strip,
  topBar,
  initialToolId,
  onToolChange,
  propertyTools,
  propertyPanels,
  clipActions,
}: EditorShellProps) {
  const [activeId, setActiveId] = useState<string>(
    () => initialToolId || tools[0]?.id || '',
  );
  const [activePropId, setActivePropId] = useState<string>(
    () => propertyTools?.[0]?.id || '',
  );

  // Draggable panel divider, as CapCut has. The panel was a fixed 300px, so a
  // dense panel (backgrounds, render history) could not be widened and the
  // stage could not be given more room for a close look at the frame.
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= MIN_PANEL_W && saved <= MAX_PANEL_W
      ? saved
      : DEFAULT_PANEL_W;
  });
  const dragging = useRef(false);

  // Timeline height, dragged from the divider above the strip.
  const [stripPct, setStripPct] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STRIP_HEIGHT_KEY));
    return Number.isFinite(saved) && saved >= MIN_STRIP_PCT && saved <= MAX_STRIP_PCT
      ? saved
      : DEFAULT_STRIP_PCT;
  });
  const draggingStrip = useRef(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const onStripDragStart = useCallback((e: React.PointerEvent) => {
    draggingStrip.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    // Capture so the drag survives the pointer leaving the 6px handle.
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (draggingStrip.current) {
        // Measured against the shell's own box, so the split is correct
        // whatever the window height. Clamped so neither the timeline nor
        // the preview above it can be driven to nothing.
        const box = shellRef.current?.getBoundingClientRect();
        if (box && box.height > 0) {
          const pct = ((box.bottom - e.clientY) / box.height) * 100;
          setStripPct(Math.min(MAX_STRIP_PCT, Math.max(MIN_STRIP_PCT, Math.round(pct))));
        }
        return;
      }
      if (!dragging.current) return;
      // Width is measured from the shell's left edge minus the rail, so the
      // handle tracks the cursor exactly rather than drifting.
      const shellLeft = window.innerWidth >= 1024 ? APP_NAV_W + RAIL_W : RAIL_W;
      const next = Math.round(e.clientX - shellLeft);
      setPanelWidth(Math.min(MAX_PANEL_W, Math.max(MIN_PANEL_W, next)));
    };
    const up = () => {
      if (draggingStrip.current) {
        draggingStrip.current = false;
        setStripPct((p) => { localStorage.setItem(STRIP_HEIGHT_KEY, String(p)); return p; });
        return;
      }
      if (!dragging.current) return;
      dragging.current = false;
      // Persist on release, not on every move: a write per pointermove would
      // hit localStorage dozens of times a second.
      setPanelWidth((w) => { localStorage.setItem(PANEL_WIDTH_KEY, String(w)); return w; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const select = (id: string) => {
    setActiveId(id);
    onToolChange?.(id);
  };

  const activePanel = panels[activeId];

  // Portalled to <body> ON PURPOSE. The app's page wrapper carries
  // `animate-bffade`, whose keyframes animate `transform` with fill-mode
  // `both` — so a transform stays applied forever. A transformed ancestor
  // becomes the containing block for fixed descendants, which cost us twice:
  // `inset-0` stopped resolving against the viewport (the shell computed to
  // 107px tall and the editor rendered blank), and `left-64` stacked on top
  // of the wrapper's own centring margin, leaving a ~270px dead gap down the
  // left. Escaping to <body> makes `fixed` mean the viewport again.
  return createPortal(
    <div
      ref={shellRef}
      className="fixed inset-0 z-30 flex h-screen flex-col overflow-hidden bg-editor-chrome text-editor-text lg:left-[240px]"
      // h-screen is NOT redundant with inset-0. Measured in the live DOM: with
      // position:fixed, top:0 AND bottom:0, the element still computed to
      // 106.75px, because it is a flex ITEM of the app's <main> column and that
      // flex sizing beat the inset stretch. Without an explicit height the
      // middle row resolved to 0 and the editor rendered blank.
      // An explicit 240px, not a rem-derived scale step: this app's root
      // font-size is 15px, so lg:left-60 (15rem) resolved to 225px and left
      // the shell underlapping the 240px nav. Clears the sidebar so the
      // fixed shell does not sit beneath it.
      // FIXED, not 100vh-in-a-padded-container. Previously the shell was
      // height:100vh inside a wrapper with pt-5/pb-16, so it overflowed by
      // exactly that padding and the WHOLE editor scrolled — rails, preview
      // and all. An editor's furniture must stay put; only the panels and
      // lanes inside it scroll. overflow-hidden makes that structural.
    >
      {topBar && (
        <div className="flex shrink-0 items-center gap-3 border-b border-editor-line px-4 short:h-[36px] h-[52px]">
          {topBar}
        </div>
      )}

      {/* Column on phones, row on desktop. As a row, the full-width
          mobile tool strip and the panel became SIBLINGS in a
          horizontal layout: measured at 390px the rail stretched to
          471px tall and the panel sat at x=390, completely off-screen.
          That is the empty-editor look on mobile. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Icon rail. Horizontal-scrolling strip on phones, where a 72px
            vertical rail would eat a fifth of the screen. */}
        <div
          role="tablist"
          aria-label="Editor tools"
          className="flex w-full shrink-0 flex-row gap-1 overflow-x-auto border-b border-editor-line px-2 py-1.5 lg:w-[60px] lg:flex-col lg:items-center lg:border-b-0 lg:border-r lg:px-0 lg:py-1.5"
        >
          {tools.map((tool) => {
            const active = tool.id === activeId;
            return (
              <button
                key={tool.id}
                role="tab"
                aria-selected={active}
                aria-controls={`panel-${tool.id}`}
                onClick={() => select(tool.id)}
                title={tool.label}
                className={`flex min-w-[64px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] transition lg:h-[52px] lg:w-[52px] lg:min-w-0 lg:px-0 lg:py-0 ${
                  active
                    ? 'bg-editor-hover text-editor-accent'
                    : 'text-editor-faint hover:bg-editor-hover hover:text-editor-dim'
                }`}
              >
                <span className="text-[16px] leading-none">{tool.icon}</span>
                {/* Count rides ON the label rather than taking a third line —
                    that third line is what forced the rail to 62px and pushed
                    the last tool out of view. */}
                <span className="max-w-full truncate leading-tight">
                  {tool.label}
                  {typeof tool.count === 'number' && tool.count > 0 && (
                    <span className="text-editor-faint"> {tool.count}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Docked panel. Below lg it becomes a normal block above the stage
            rather than a column, so nothing is squeezed off-screen. */}
        <div
          id={`panel-${activeId}`}
          role="tabpanel"
          className="min-h-0 w-full shrink-0 overflow-auto border-b border-editor-line bg-editor-panel p-3.5 max-h-[38vh] short:max-h-[40%] short:p-2 lg:max-h-none lg:border-b-0 lg:border-r"
          // Width is inline because it is DRAGGED: a Tailwind class cannot
          // express a runtime value. Desktop only - on mobile the panel is
          // full-width and stacked, so a horizontal drag has no meaning.
          style={typeof window !== 'undefined' && window.innerWidth >= 1024 ? { width: panelWidth } : undefined}
        >
          {activePanel ?? (
            <p className="text-[11px] text-editor-faint">Nothing here yet.</p>
          )}
        </div>

        {/* On phones the stage is CONTENT-SIZED, not flex-1. At 390px an
            empty stage claimed ~500px - the largest thing on screen - to
            say "Preview appears here after a render", pushing the panel
            and timeline into slivers. Desktop keeps flex-1, where the
            preview genuinely is the main surface. */}
        {/* Drag handle, desktop only. 6px hit area with an ALWAYS-VISIBLE grip
            pill - a transparent strip was functionally there but
            undiscoverable, and the operator read it as a missing feature. */}
        <div
          role="separator"
          aria-label="Resize panel"
          aria-orientation="vertical"
          onPointerDown={onDragStart}
          className="group hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors hover:bg-primary-400/30 lg:flex"
        >
          <div className="pointer-events-none h-9 w-[3px] rounded-full bg-editor-accent/35 transition-colors group-hover:bg-editor-accent" />
        </div>

        <div className="flex min-w-0 items-center justify-center overflow-auto bg-editor-stage p-4 max-lg:shrink-0 lg:flex-1 lg:p-6">
          {stage}
        </div>

        {propertyTools && propertyTools.length > 0 && (
          <div className="flex shrink-0 max-lg:hidden">
            <div className="w-[216px] overflow-auto border-l border-editor-line bg-editor-panel p-3.5">
              {propertyPanels?.[activePropId] ?? (
                <p className="text-[11px] text-editor-faint">Select a clip to edit it.</p>
              )}
            </div>
            <div
              role="tablist"
              aria-label="Properties"
              className="flex w-[56px] flex-col items-center gap-1 border-l border-editor-line py-2"
            >
              {propertyTools.map((tool) => {
                const active = tool.id === activePropId;
                return (
                  <button
                    key={tool.id}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActivePropId(tool.id)}
                    className={`flex h-[50px] w-[48px] flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] transition ${
                      active
                        ? 'bg-editor-hover text-editor-accent'
                        : 'text-editor-faint hover:bg-editor-hover hover:text-editor-dim'
                    }`}
                  >
                    <span className="text-[15px] leading-none">{tool.icon}</span>
                    <span className="max-w-full truncate px-1">{tool.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {clipActions && clipActions.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-editor-line bg-editor-chrome px-3 py-1.5">
          {clipActions.map((action) => (
            <button
              key={action.id}
              type="button"
              aria-label={action.label}
              title={action.label}
              onClick={action.onClick}
              disabled={action.disabled}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-editor-dim transition hover:bg-editor-hover hover:text-editor-text disabled:pointer-events-none disabled:opacity-40"
            >
              {action.icon}
            </button>
          ))}
        </div>
      )}

      {strip && (
        // basis/max-h rather than shrink-0. A shrink-0 strip at a fixed height
        // wins the flex fight outright on a short viewport, collapsing the
        // rail/panel/stage row above it to zero — the screen goes blank apart
        // from the two bars. The strip may take at most 40% of the height and
        // never less than 160px, so the editor above it always has room.
        // shrink-0 with a fixed height starved the row above; `shrink basis-auto`
        // then let it claim 160px while the shell itself had collapsed. The
        // strip is now a plain flex item with a hard height ceiling, so the
        // middle row (flex-1) always gets the remainder.
        // On phones the strip GROWS into the space the stage gave up -
        // the timeline is the working surface there. Without flex-1 that
        // space became a ~450px dead gap between stage and timeline.
        // Desktop keeps the fixed 38% ceiling so the preview stays king.
        // max-lg:flex-1 is right in PORTRAIT, where the timeline is the
        // working surface. In landscape it grew to 350px of a 390px
        // viewport and starved the rail/panel row to h=0 - the same
        // starvation pattern as the render player. A short-viewport
        // ceiling keeps the split sane on both orientations.
        <>
        {/* Horizontal drag handle above the timeline. The operator asked to be
            able to pull the timeline up - and that doing so must NOT squeeze
            the preview to nothing, which is why the height is a clamped
            percentage rather than free pixels. */}
        <div
          role="separator"
          aria-label="Resize timeline"
          aria-orientation="horizontal"
          onPointerDown={onStripDragStart}
          className="group flex h-1.5 shrink-0 cursor-row-resize items-center justify-center transition-colors hover:bg-primary-400/30"
        >
          {/* Same visible-grip fix as the panel divider. */}
          <div className="pointer-events-none h-[3px] w-9 rounded-full bg-editor-accent/35 transition-colors group-hover:bg-editor-accent" />
        </div>
        <div
          className="overflow-hidden border-t border-editor-line bg-editor-chrome min-h-[120px] shrink-0"
          // Height is inline because it is DRAGGED; a Tailwind class cannot
          // express a runtime value.
          style={{ height: `${stripPct}%` }}
        >
          {strip}
        </div>
        </>
      )}
    </div>,
    document.body,
  );
}
