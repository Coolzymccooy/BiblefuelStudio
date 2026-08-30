import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';

/** Below the lg breakpoint the editor is a phone layout: stage on top, tools
 *  as a bar, the tool panel as a sheet, the timeline as the working surface. */
function usePhoneLayout(): boolean {
  const query = '(max-width: 1023px)';
  const [phone, setPhone] = useState<boolean>(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return phone;
}

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
   * Optional controlled tool. Lets the page drive the rail - "Voice this" in
   * the Script panel jumps to the Voice tool with the script carried along -
   * without owning the rail's click handling.
   */
  activeToolId?: string;
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
/** Properties (right) rail bounds — the operator asked for the same resize +
 *  maximize the left panel has; 216 is today's fixed width, kept as default. */
const MIN_PROP_W = 216;
const MAX_PROP_W = 560;
const PROP_WIDTH_KEY = 'bf.editor.propWidth';
const PROP_MAX_KEY = 'bf.editor.propMax';
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
  activeToolId,
  propertyTools,
  propertyPanels,
  clipActions,
}: EditorShellProps) {
  const [activeId, setActiveId] = useState<string>(
    () => initialToolId || tools[0]?.id || '',
  );
  useEffect(() => {
    if (activeToolId && activeToolId !== activeId) setActiveId(activeToolId);
    // Only the controlled value should re-run this; activeId changes from
    // rail clicks must not snap back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeToolId]);

  const phone = usePhoneLayout();
  // On phones the tool panel is a SHEET over the timeline; tapping the active
  // tool again (or the chevron) folds it away so the whole timeline is usable.
  const [sheetOpen, setSheetOpen] = useState(true);
  // How much of the phone screen the stage keeps. Dragged by the grip
  // between stage and timeline, clamped so neither can be squeezed away
  // (the operator could pull the timeline up and then not pull it back).
  const [stagePct, setStagePct] = useState<number>(() => {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem('bf.editor.phoneStagePct') : null;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? Math.min(62, Math.max(14, n)) : 42;
  });
  useEffect(() => {
    try { window.localStorage.setItem('bf.editor.phoneStagePct', String(stagePct)); } catch { /* private mode */ }
  }, [stagePct]);
  const phoneBodyRef = useRef<HTMLDivElement | null>(null);
  // Landscape phones split side by side; portrait stacks.
  const [shortScreenLayout, setShortScreenLayout] = useState<boolean>(() => typeof window !== 'undefined' && !!window.matchMedia?.('(max-height: 500px)').matches);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-height: 500px)');
    const onChange = () => setShortScreenLayout(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  // Does the tools bar have more off-screen either way? Without a hint the
  // operator cannot tell that half the tools exist.
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const [toolsEdge, setToolsEdge] = useState({ left: false, right: false });
  const measureTools = useCallback(() => {
    const el = toolsRef.current;
    if (!el) return;
    setToolsEdge({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);
  useEffect(() => {
    measureTools();
    if (typeof ResizeObserver === 'undefined') return;
    const el = toolsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measureTools);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureTools, phone, tools.length]);
  const scrollTools = (dir: 1 | -1) => {
    toolsRef.current?.scrollBy({ left: dir * Math.max(150, (toolsRef.current?.clientWidth || 300) * 0.7), behavior: 'smooth' });
  };
  // The preview drawer folds away entirely, so the lanes get the screen.
  const [stageCollapsed, setStageCollapsed] = useState<boolean>(() => {
    try { return window.localStorage.getItem('bf.editor.phoneStageCollapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem('bf.editor.phoneStageCollapsed', stageCollapsed ? '1' : '0'); } catch { /* private mode */ }
  }, [stageCollapsed]);
  const onPhoneDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const host = phoneBodyRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const pct = ((ev.clientY - rect.top) / Math.max(1, rect.height)) * 100;
      setStagePct(Math.min(62, Math.max(14, pct)));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

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

  // Properties (right) rail: draggable width + a maximize toggle, mirroring
  // the left panel. Both persist so the workspace comes back as arranged.
  const [propWidth, setPropWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(PROP_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= MIN_PROP_W && saved <= MAX_PROP_W
      ? saved
      : MIN_PROP_W;
  });
  const [propMax, setPropMax] = useState<boolean>(
    () => localStorage.getItem(PROP_MAX_KEY) === 'true',
  );
  const draggingProp = useRef(false);

  const onPropDragStart = useCallback((e: React.PointerEvent) => {
    draggingProp.current = true;
    // Dragging while maximized means "I want manual control" — drop out of
    // max so the handle tracks the cursor instead of fighting it.
    setPropMax(false);
    localStorage.setItem(PROP_MAX_KEY, 'false');
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const togglePropMax = useCallback(() => {
    setPropMax((v) => {
      localStorage.setItem(PROP_MAX_KEY, String(!v));
      return !v;
    });
  }, []);

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
      if (draggingProp.current) {
        // Measured from the shell's RIGHT edge minus the 56px tool rail, so
        // the handle tracks the cursor exactly - same principle as the left
        // panel, mirrored.
        const box = shellRef.current?.getBoundingClientRect();
        if (box) {
          const next = Math.round(box.right - 56 - e.clientX);
          setPropWidth(Math.min(MAX_PROP_W, Math.max(MIN_PROP_W, next)));
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
      if (draggingProp.current) {
        draggingProp.current = false;
        setPropWidth((w) => { localStorage.setItem(PROP_WIDTH_KEY, String(w)); return w; });
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
    if (phone && id === activeId) { setSheetOpen((o) => !o); return; }
    setActiveId(id);
    setSheetOpen(true);
    onToolChange?.(id);
  };

  const activePanel = panels[activeId];

  // One tool button for both rails (desktop column, phone bottom bar).
  const toolButton = (tool: EditorTool) => {
    const active = tool.id === activeId;
    return (
      <button
        key={tool.id}
        role="tab"
        aria-selected={active}
        aria-controls={`panel-${tool.id}`}
        onClick={() => select(tool.id)}
        title={tool.label}
        className={`flex min-w-[56px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-1 text-[10px] transition lg:h-[52px] lg:w-[52px] lg:min-w-0 lg:px-0 lg:py-0 ${
          active
            ? 'bg-editor-accent/10 text-editor-accent ring-1 ring-inset ring-editor-accent/35 font-semibold'
            : 'text-[#b7ac97] font-semibold hover:bg-white/5 hover:text-editor-text'
        }`}
      >
        <span className="text-[16px] leading-none">{tool.icon}</span>
        <span className="max-w-full truncate leading-tight">
          {tool.label}
          {typeof tool.count === 'number' && tool.count > 0 && (
            <span className="text-editor-accent/80"> {tool.count}</span>
          )}
        </span>
      </button>
    );
  };

  // ---- Phone body (the design canvas: stage on top, timeline as the working
  // surface, tools as a bottom bar, the tool panel as a sheet over the
  // TIMELINE - the stage is never covered) -----------------------------
  const phoneBody = (
    <div ref={phoneBodyRef} className="flex min-h-0 flex-1 flex-col overflow-hidden short:flex-row">
      {!stageCollapsed && (
        <div
          className="flex min-w-0 flex-col items-center justify-center overflow-hidden bg-editor-stage px-1 py-1.5"
          style={shortScreenLayout
            ? { flex: '0 0 52%', minWidth: 0, height: '100%' }
            : { flex: `0 1 min(${stagePct}dvh, ${stagePct}%)`, minHeight: '96px', maxHeight: '46dvh', width: '100%' }}
        >
          {stage}
        </div>
      )}
      {/* Grip: drag to trade stage for timeline, in BOTH directions. */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-y border-editor-line bg-editor-chrome px-2 short:hidden">
        <button
          type="button"
          aria-label={stageCollapsed ? 'Show preview' : 'Hide preview'}
          title={stageCollapsed ? 'Show the preview' : 'Hide the preview and give the lanes the screen'}
          onClick={() => setStageCollapsed((v) => !v)}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-editor-dim transition hover:bg-editor-hover hover:text-editor-text"
        >
          {stageCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          Preview
        </button>
        {/* The drag grip only means something while the preview is showing. */}
        {!stageCollapsed && (
          <div
            role="separator"
            aria-label="Resize preview"
            aria-orientation="horizontal"
            onPointerDown={onPhoneDragStart}
            onDoubleClick={() => setStagePct(42)}
            title="Drag to resize the preview · double-tap to reset"
            className="flex h-full flex-1 cursor-row-resize touch-none items-center justify-center"
          >
            <div className="pointer-events-none h-[3px] w-10 rounded-full bg-editor-accent/45" />
          </div>
        )}
        {stageCollapsed && <span className="flex-1" />}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-editor-chrome short:min-w-0 short:basis-0">
        <div className="h-full overflow-hidden">{strip}</div>
        {/* Bring the panel back. Without this the sheet could only be
            closed - the operator had no way back to the tool. */}
        {!sheetOpen && (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-2 border-t border-editor-line bg-editor-panel/95 py-2 text-[13px] font-semibold text-editor-dim backdrop-blur"
          >
            <ChevronUp size={14} />
            {tools.find((t) => t.id === activeId)?.label}
          </button>
        )}
        {sheetOpen && (
          <div
            id={`panel-${activeId}`}
            role="tabpanel"
            className="editor-phone absolute inset-0 z-20 flex flex-col bg-editor-panel"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-editor-line px-3 py-1.5">
              {/* 13px, not 11px: the operator could not read these on a phone.
                  Contrast was never the problem - editor-dim measures 9.65:1
                  on the light panel - the type was simply too small against a
                  15px root. */}
              <span className="text-[13px] font-semibold uppercase tracking-[.1em] text-editor-dim">{tools.find((t) => t.id === activeId)?.label}</span>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Hide panel"
                title="Hide this panel and see the timeline"
                className="grid h-7 w-7 place-items-center rounded-md text-editor-dim hover:bg-editor-hover hover:text-editor-text"
              >
                <ChevronDown size={15} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2.5">
              {activePanel ?? <p className="text-[13px] text-editor-faint">Nothing here yet.</p>}
            </div>
          </div>
        )}
      </div>
      <div className="relative shrink-0 border-t border-editor-line bg-editor-chrome short:w-[76px] short:overflow-y-auto short:border-l short:border-t-0">
        <div
          ref={toolsRef}
          role="tablist"
          aria-label="Editor tools"
          onScroll={measureTools}
          className="flex w-full flex-row gap-1 overflow-x-auto px-2 py-1 [scrollbar-width:none] short:flex-col short:overflow-x-hidden"
        >
          {tools.map(toolButton)}
        </div>
        {toolsEdge.left && (
          <button
            type="button"
            aria-label="Scroll tools left"
            onClick={() => scrollTools(-1)}
            className="absolute inset-y-0 left-0 grid w-7 place-items-center bg-gradient-to-r from-editor-chrome via-editor-chrome/95 to-transparent text-editor-accent"
          >
            <ChevronLeft size={16} />
          </button>
        )}
        {toolsEdge.right && (
          <button
            type="button"
            aria-label="Scroll tools right"
            onClick={() => scrollTools(1)}
            className="absolute inset-y-0 right-0 grid w-7 place-items-center bg-gradient-to-l from-editor-chrome via-editor-chrome/95 to-transparent text-editor-accent"
          >
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );

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
      className="fixed inset-0 z-30 flex h-screen flex-col overflow-hidden bg-editor-chrome text-editor-text phone:bottom-[calc(64px_+_env(safe-area-inset-bottom))] phone:h-[calc(100dvh_-_64px_-_env(safe-area-inset-bottom))] lg:left-[240px]"
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
        <div className="flex shrink-0 items-center gap-3 border-b border-editor-line px-4 short:h-[36px] h-[52px] phone:h-[44px] phone:gap-2 phone:px-2 phone:[&>*]:shrink-0 phone:overflow-x-auto">
          {topBar}
        </div>
      )}

      {phone ? phoneBody : (
      <>
      {/* Column on phones, row on desktop. As a row, the full-width
          mobile tool strip and the panel became SIBLINGS in a
          horizontal layout: measured at 390px the rail stretched to
          471px tall and the panel sat at x=390, completely off-screen.
          That is the empty-editor look on mobile. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden phone:flex-none lg:flex-row">
        {/* Icon rail. Horizontal-scrolling strip on phones, where a 72px
            vertical rail would eat a fifth of the screen. */}
        <div
          role="tablist"
          aria-label="Editor tools"
          className="flex w-full shrink-0 flex-row gap-1 overflow-x-auto border-b border-editor-line px-2 py-1 phone:[scrollbar-width:none] lg:w-[60px] lg:flex-col lg:items-center lg:border-b-0 lg:border-r lg:px-0 lg:py-1.5"
        >
          {tools.map(toolButton)}
        </div>

        {/* Docked panel. Below lg it becomes a normal block above the stage
            rather than a column, so nothing is squeezed off-screen. */}
        <div
          id={`panel-${activeId}`}
          role="tabpanel"
          className={`min-h-0 w-full shrink-0 overflow-auto border-b border-editor-line bg-editor-panel p-3.5 short:p-2 lg:max-h-none lg:border-b-0 lg:border-r`}
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

        <div className="flex min-w-0 items-center justify-center overflow-auto bg-editor-stage p-4 phone:h-[32vh] short:phone:h-[36vh] phone:shrink-0 phone:p-2 lg:flex-1 lg:p-6">
          {stage}
        </div>

        {propertyTools && propertyTools.length > 0 && (
          <div className="flex min-w-0 shrink-0 phone:hidden">
            {/* Same visible-grip divider as the left panel, mirrored. */}
            <div
              role="separator"
              aria-label="Resize properties"
              aria-orientation="vertical"
              onPointerDown={onPropDragStart}
              className="group flex w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors hover:bg-primary-400/30"
            >
              <div className="pointer-events-none h-9 w-[3px] rounded-full bg-editor-accent/35 transition-colors group-hover:bg-editor-accent" />
            </div>
            <div
              className={`overflow-auto border-l border-editor-line bg-editor-panel p-3.5 ${propMax ? 'w-[min(720px,46vw)]' : ''}`}
              style={propMax ? undefined : { width: propWidth }}
            >
              <div className="mb-1.5 flex justify-end">
                <button
                  type="button"
                  aria-label={propMax ? 'Restore properties panel' : 'Maximize properties panel'}
                  title={propMax ? 'Restore properties panel' : 'Maximize properties panel'}
                  onClick={togglePropMax}
                  className="grid h-7 w-7 place-items-center rounded-md text-editor-faint transition hover:bg-editor-hover hover:text-editor-text"
                >
                  {propMax ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </button>
              </div>
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
        // phone:flex-1 is right in PORTRAIT, where the timeline is the
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
          className="group flex h-1.5 shrink-0 cursor-row-resize items-center justify-center transition-colors hover:bg-primary-400/30 phone:hidden"
        >
          {/* Same visible-grip fix as the panel divider. */}
          <div className="pointer-events-none h-[3px] w-9 rounded-full bg-editor-accent/35 transition-colors group-hover:bg-editor-accent" />
        </div>
        <div
          className="overflow-hidden border-t border-editor-line bg-editor-chrome min-h-[120px] shrink-0 phone:min-h-[110px] phone:flex-1"
          // Height is inline because it is DRAGGED; a Tailwind class cannot
          // express a runtime value.
          style={phone ? undefined : { height: `${stripPct}%` }}
        >
          {strip}
        </div>
        </>
      )}
      </>
      )}
    </div>,
    document.body,
  );
}
