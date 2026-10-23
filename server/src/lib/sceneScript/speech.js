import crypto from "crypto";
import { referenceOfLine } from "./reference.js";

/**
 * What the voice provider is sent for one line. The only changes from the
 * author's text are pronunciation-only: ALL-CAPS lines are sent in sentence
 * case (some voices spell capitals out) and a printed reference on a
 * reference line is read out in words. The caption keeps the author's text.
 */

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINAL = Object.freeze({ 1: "First", 2: "Second", 3: "Third" });

export function numberToWords(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0 || v > 999) return String(n);
  if (v < 20) return ONES[v];
  if (v < 100) return TENS[Math.floor(v / 10)] + (v % 10 ? `-${ONES[v % 10]}` : "");
  const rest = v % 100;
  return `${ONES[Math.floor(v / 100)]} hundred${rest ? ` and ${numberToWords(rest)}` : ""}`;
}

/** "1 Corinthians 15:10" -> "First Corinthians, chapter fifteen, verse ten" */
export function referenceInWords(ref) {
  const m = /^([123])\s+(.+)$/.exec(ref.book);
  const book = m ? `${ORDINAL[m[1]]} ${m[2]}` : ref.book;
  let out = `${book}, chapter ${numberToWords(ref.chapter)}`;
  const range = ref.verseTo && ref.verseTo !== ref.verseFrom;
  if (ref.verseFrom) out += `, verse${range ? "s" : ""} ${numberToWords(ref.verseFrom)}`;
  if (range) out += ` to ${numberToWords(ref.verseTo)}`;
  return out;
}

function isShouting(text) {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 4 && letters === letters.toUpperCase();
}

function sentenceCase(text) {
  const lower = text.toLowerCase();
  return lower.replace(/(^\s*\W*|[.!?]\s+\W*)([a-z])/g, (_m, lead, c) => `${lead}${c.toUpperCase()}`)
    .replace(/\bi\b/g, "I");
}

export function speakableText(line) {
  const text = String(line.text || "").trim();
  if (line.kind === "reference" && /\d/.test(text)) {
    const ref = referenceOfLine(text);
    if (ref) return `${referenceInWords(ref)}.`;
  }
  return isShouting(text) ? sentenceCase(text) : text;
}

const escapeXml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const localeOf = (voice) => voice.split(":")[0].split("-").slice(0, 2).join("-");

export function ssmlFor({ voice, rate = "0%", pitch = "0%", text }) {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${localeOf(voice)}">`
    + `<voice name="${escapeXml(voice)}"><prosody rate="${escapeXml(rate)}" pitch="${escapeXml(pitch)}">${escapeXml(text)}</prosody></voice></speak>`;
}

/** Changes whenever what would be heard changes, so stale audio is never reused. */
export function audioKey(parts) {
  return crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 12);
}
