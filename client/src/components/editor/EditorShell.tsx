import { useState, type ReactNode } from 'react';

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

  const select = (id: string) => {
    setActiveId(id);
    onToolChange?.(id);
  };

  const activePanel = panels[activeId];

  return (
    <div
      className="fixed inset-0 z-30 flex flex-col overflow-hidden bg-editor-chrome text-editor-text lg:left-64"
      // lg:left-64 clears the app's 256px (w-64) desktop sidebar so the
      // fixed shell does not sit beneath it.
      // FIXED, not 100vh-in-a-padded-container. Previously the shell was
      // height:100vh inside a wrapper with pt-5/pb-16, so it overflowed by
      // exactly that padding and the WHOLE editor scrolled — rails, preview
      // and all. An editor's furniture must stay put; only the panels and
      // lanes inside it scroll. overflow-hidden makes that structural.
    >
      {topBar && (
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-editor-line px-4">
          {topBar}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Icon rail. Horizontal-scrolling strip on phones, where a 72px
            vertical rail would eat a fifth of the screen. */}
        <div
          role="tablist"
          aria-label="Editor tools"
          className="flex shrink-0 gap-1 overflow-x-auto border-editor-line max-lg:w-full max-lg:flex-row max-lg:border-b max-lg:px-2 max-lg:py-1.5 lg:w-[60px] lg:flex-col lg:items-center lg:border-r lg:py-1.5"
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
                className={`flex shrink-0 flex-col items-center justify-center gap-1 rounded-lg text-[10px] transition max-lg:min-w-[64px] max-lg:px-2 max-lg:py-1.5 lg:h-[52px] lg:w-[52px] ${
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
          className="min-h-0 shrink-0 overflow-auto border-editor-line bg-editor-panel p-3.5 max-lg:max-h-[38vh] max-lg:w-full max-lg:border-b lg:w-[300px] lg:border-r"
        >
          {activePanel ?? (
            <p className="text-[11px] text-editor-faint">Nothing here yet.</p>
          )}
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto bg-editor-stage p-4 lg:p-6">
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
        <div className="shrink-0 border-t border-editor-line bg-editor-chrome">
          {strip}
        </div>
      )}
    </div>
  );
}
