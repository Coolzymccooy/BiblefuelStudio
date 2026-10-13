/** Timing a song again spends one of today's free renders and starts the lines over, so ask first. */
export const RETIME_WARNING =
  "Time the lyrics again? This uses one of today's free renders, and it replaces any timing changes you made by hand.";

/** True when the user agrees to time a song that has already been timed. */
export const confirmRetime = (): boolean => window.confirm(RETIME_WARNING);
