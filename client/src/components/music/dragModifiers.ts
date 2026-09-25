import type { Modifier } from '@dnd-kit/core';

/** Rows only move up and down (saves pulling in @dnd-kit/modifiers for one line). */
export const restrictToVerticalAxisModifier: Modifier = ({ transform }) => ({ ...transform, x: 0 });
