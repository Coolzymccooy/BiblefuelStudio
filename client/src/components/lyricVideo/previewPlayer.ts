/**
 * Starts the preview's song at `seconds`. The preview owns its player, so the
 * timing list reaches it through the page: the song's own player is the video
 * with controls (the looping backgrounds under it are tagged `data-backdrop`).
 */
export function playPreviewFrom(root: HTMLElement | null, seconds: number): void {
  const player = root?.querySelector<HTMLVideoElement>('video[controls]');
  if (!player) return;
  player.currentTime = seconds;
  // A browser may refuse to start playback by script; the player's own controls still work.
  const started = player.play() as Promise<void> | undefined;
  if (started && typeof started.catch === 'function') started.catch(() => undefined);
}
