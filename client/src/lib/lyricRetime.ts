/** Timing a song again spends part of today's allowance, so ask first. Hand-moved lines are locked and survive a re-run. */
export const RETIME_WARNING =
  "Timing the lyrics again counts toward today's render allowance. Lines you moved by hand stay where you put them; the rest are timed again.";

/** True when the user agrees to time a song that has already been timed. */
export const confirmRetime = (): boolean => window.confirm(RETIME_WARNING);
