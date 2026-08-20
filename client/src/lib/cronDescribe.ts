// Plain-English rendering of the cron expressions the schedule UI produces.
// Deliberately narrow: it covers the daily/weekly shapes the presets emit and
// the common hand-typed ones, and falls back to echoing the raw expression
// rather than guessing. A wrong-but-confident description is worse than none,
// because the operator uses this to trust that a schedule is armed.

const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

function clockLabel(hour: number, minute: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mm = String(minute).padStart(2, '0');
  return `${h12}:${mm}${suffix}`;
}

export function describeCron(cron: string, timezone?: string): string {
  const expr = String(cron || '').trim();
  if (!expr) return 'No time set';

  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return expr;

  const [min, hour, dom, mon, dow] = parts;
  const tz = String(timezone || '').trim();
  const tzSuffix = tz ? ` ${tz}` : '';

  const minNum = Number(min);
  const hourNum = Number(hour);
  const numericTime = /^\d+$/.test(min) && /^\d+$/.test(hour)
    && minNum >= 0 && minNum < 60 && hourNum >= 0 && hourNum < 24;

  // Every N hours — "0 */12 * * *"
  const everyNHours = /^\*\/(\d+)$/.exec(hour);
  if (everyNHours && /^\d+$/.test(min) && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${everyNHours[1]} hours${tzSuffix}`;
  }

  if (!numericTime) return expr;
  const time = clockLabel(hourNum, minNum);

  // Weekly — "0 9 * * 0"
  if (dom === '*' && mon === '*' && /^\d$/.test(dow)) {
    const day = DAYS[Number(dow)];
    if (day) return `${day} at ${time}${tzSuffix}`;
  }

  // Daily — "0 6 * * *"
  if (dom === '*' && mon === '*' && dow === '*') {
    return `Daily at ${time}${tzSuffix}`;
  }

  return expr;
}
