/**
 * Put an instrumental on a Music bed in place of the song it was made from
 * (under any of the names that song goes by: its file path or its library
 * ref), keeping the order; add it at the end when the song wasn't there.
 */
export function swapIntoMusicBed(paths: readonly string[], instrumental: string, replaces: readonly string[]): string[] {
  const old = new Set(replaces);
  const swapped = paths.map((p) => (old.has(p) ? instrumental : p));
  const unique = swapped.filter((p, i) => swapped.indexOf(p) === i);
  return unique.includes(instrumental) ? unique : [...unique, instrumental];
}
