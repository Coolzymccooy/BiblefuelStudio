const FALLBACK = 'Something went wrong. Please try again.';

/** The sentence to show for a failed call; lyricVideoApi already turns server and network failures into plain ones. */
export function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : FALLBACK;
}
