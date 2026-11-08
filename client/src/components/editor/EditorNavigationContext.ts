import { createContext, useContext, useEffect } from 'react';

// Layout owns this transient registration; never persist it or mutate body/CSS.
// Route guarding in Layout also prevents stale registration hiding another page.
export const EditorNavigationContext = createContext<((active: boolean) => void) | null>(null);

export function useTimelineEditorNavigation(active: boolean) {
  const register = useContext(EditorNavigationContext);
  useEffect(() => {
    register?.(active);
    return () => register?.(false);
  }, [active, register]);
}
