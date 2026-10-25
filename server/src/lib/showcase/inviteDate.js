/**
 * The day and month of an event, read from the Moment's free-text date so
 * the closing scene can show a calendar card. Only a real day of a named or
 * numbered month counts; anything else (a weekday alone, "next Sunday")
 * gives null and the Moment closes on a plain finale.
 */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const NAME = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";

const monthOf = (name) => MONTHS.indexOf(name.slice(0, 3)) + 1;

function result(month, day) {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN[month - 1])) return null;
  return { month, day, label: MONTHS[month - 1].toUpperCase() };
}

/** @returns {{ month: number, day: number, label: string } | null} */
export function readInviteDate(text) {
  if (typeof text !== "string") return null;
  const t = text.toLowerCase();
  let m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(t);
  if (m) return result(Number(m[2]), Number(m[3]));
  m = new RegExp(`\\b${DAY}\\s+(?:of\\s+)?${NAME}\\b`).exec(t);
  if (m) return result(monthOf(m[2]), Number(m[1]));
  m = new RegExp(`\\b${NAME}\\s+${DAY}\\b`).exec(t);
  if (m) return result(monthOf(m[1]), Number(m[2]));
  // Slashes or dots are day first, as written in the UK.
  m = /\b(\d{1,2})[/.](\d{1,2})(?:[/.]\d{2,4})?\b/.exec(t);
  if (m) return result(Number(m[2]), Number(m[1]));
  return null;
}
