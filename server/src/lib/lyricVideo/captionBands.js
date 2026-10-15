/**
 * Caption ink windows: when does a lyric caption reach into a band at the top of the frame?
 * The branding overlay (logo and artist name) uses this to step aside while a caption is drawn
 * near it. Everything here reads the ASS text that buildLyricAss produces, so it sees exactly
 * what the renderer will draw.
 */

/** The pop effects start scaled up; allow for it when estimating how far a caption reaches. */
const POP_SCALE = 1.35;
const DEFAULT_ALIGN = 5;

const TIME_RE = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/;
const POS_RE = /\\pos\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/;
const MOVE_RE = /\\move\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/;
const SIZE_RE = /\\fs(\d+(?:\.\d+)?)/;
const ALIGN_RE = /\\an(\d)/;
const BORDER_RE = /\\bord(\d+(?:\.\d+)?)/;
const DRAW_RE = /\\p(\d+)/g;

/** "H:MM:SS.cc" to seconds, or NaN when it does not parse. */
function toSeconds(stamp) {
  const m = TIME_RE.exec(String(stamp).trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
}

/** True when any override in the text switches drawing mode on (\p1 and up). */
function isDrawing(text) {
  for (const m of text.matchAll(DRAW_RE)) if (Number(m[1]) > 0) return true;
  return false;
}

/** The anchor y of the event: the first \pos, or the smaller y of the first \move. Null if none. */
function anchorY(text) {
  const pos = POS_RE.exec(text);
  const move = MOVE_RE.exec(text);
  if (pos && (!move || pos.index < move.index)) return Number(pos[2]);
  if (move) return Math.min(Number(move[2]), Number(move[4]));
  return null;
}

/** How far above the anchor y the ink reaches, by alignment row. */
function reachAbove(align, fs) {
  if (align >= 7) return 0;
  if (align >= 4) return 0.5 * fs * POP_SCALE;
  return fs * POP_SCALE;
}

/** One Dialogue line to { start, end, top }, or null when it draws no positioned text. */
function inkOf(line) {
  const fields = line.slice("Dialogue:".length).split(",");
  if (fields.length < 10) return null;
  const text = fields.slice(9).join(",");
  const start = toSeconds(fields[1]);
  const end = toSeconds(fields[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || isDrawing(text)) return null;
  const y = anchorY(text);
  const size = SIZE_RE.exec(text);
  if (y === null || !size) return null;
  const align = Number((ALIGN_RE.exec(text) || [])[1] || DEFAULT_ALIGN);
  const border = Number((BORDER_RE.exec(text) || [])[1] || 0);
  return { start, end, top: y - reachAbove(align, Number(size[1])) - border };
}

/**
 * Each caption event in the ASS as { start, end, top }: its seconds on screen and the highest
 * y its ink can reach. Drawings and events without a position or size are left out.
 * @param {string} ass
 * @returns {Array<{ start: number, end: number, top: number }>}
 */
export function parseInkEvents(ass) {
  return String(ass || "")
    .split(/\r?\n/)
    .filter((l) => l.startsWith("Dialogue:"))
    .map(inkOf)
    .filter(Boolean);
}

/**
 * The time spans in which a caption reaches above `bandBottom`, padded and merged.
 * @param {Array<{ start: number, end: number, top: number }>} events
 * @param {{ bandBottom: number, pad?: number, joinGap?: number }} opts
 * @returns {Array<[number, number]>}
 */
export function bandHideWindows(events, { bandBottom, pad = 0.25, joinGap = 1 }) {
  const spans = events
    .filter((e) => e.top < bandBottom)
    .map((e) => [Math.max(0, e.start - pad), e.end + pad])
    .sort((a, b) => a[0] - b[0]);
  return spans.reduce((merged, [from, to]) => {
    const last = merged[merged.length - 1];
    if (last && from - last[1] < joinGap) return [...merged.slice(0, -1), [last[0], Math.max(last[1], to)]];
    return [...merged, [from, to]];
  }, []);
}

/**
 * The last moment any caption is on screen; 0 when there are none.
 * @param {Array<{ end: number }>} events
 * @returns {number}
 */
export function captionsEnd(events) {
  return events.reduce((latest, e) => Math.max(latest, e.end), 0);
}
