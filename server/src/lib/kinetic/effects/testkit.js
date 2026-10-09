// Helpers shared by the effect test files. Not a test file itself.
import { resolveLook } from "../looks.js";

export const words = (text, start) => text.split(" ").map((t, i) => ({ text: t, start: start + i * 0.25, end: start + i * 0.25 + 0.25 }));
export const phrase = (text, start = 2) => ({ text, start, end: start + text.split(" ").length * 0.25, words: words(text, start) });
export const planned = (text, effect, extra = {}) => ({ index: 0, phrase: phrase(text), effect, slot: 0, hook: false, rot: -2, ...extra });
export const ctx = (p, over = {}) => ({ planned: p, look: resolveLook("studio-lagos-night"), energy: "lively", w: 1280, h: 720, aspect: "wide", nextStart: 10, ...over });
/** Final (x, y) of an event: the end point of \move, or \pos. */
export const posOf = (line) => {
  const move = line.match(/\\move\(-?\d+,-?\d+,(-?\d+),(-?\d+)/);
  const m = move || line.match(/\\pos\((-?\d+),(-?\d+)/);
  return m.slice(1, 3).map(Number);
};
/** The words a set of Dialogue lines show on screen, in order, with override blocks removed. */
export const visible = (lines) => lines
  .map((l) => l.replace(/^.*?Kinetic,,0,0,0,,/, "").replace(/\{[^}]*\}/g, ""))
  .join(" ")
  .split(" ")
  .filter(Boolean);
