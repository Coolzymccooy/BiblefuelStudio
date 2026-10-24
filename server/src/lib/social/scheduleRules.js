/**
 * Rules every schedule follows, wherever it is saved from (the app's
 * Settings, Save all, or an agent's schedules tool). Pure: no file or env
 * access, so the MCP tool modules can import it too.
 */

// R35: schedules agents may create per user (their later runs are not charged to any key).
export const MAX_AGENT_SCHEDULES = 5;

// R39: at most once an hour (the prod box has no swap and one worker): five
// fields, the minute one a single number.
const HOURLY_AT_MOST = /^\d{1,2}$/;

/** Why `cron` may not be saved, or null. */
export function cronProblem(cron) {
  const fields = String(cron || "").trim().split(/\s+/);
  if (fields.length !== 5) return "cron needs five fields: minute hour day-of-month month day-of-week, for example 0 9 * * *.";
  if (!HOURLY_AT_MOST.test(fields[0])) {
    return "A schedule may run at most once an hour: the minute field must be a single number, for example 0 9 * * *.";
  }
  return null;
}

/**
 * The first problem among `incoming` schedules that are new or whose cron
 * changed from `stored`, or null. A schedule saved before R39 keeps its cron
 * until someone changes it, so Save all never fails on an old schedule.
 */
export function changedCronProblem(incoming, stored) {
  const before = new Map((Array.isArray(stored) ? stored : []).map((s) => [String(s?.id), String(s?.cron || "").trim()]));
  for (const schedule of Array.isArray(incoming) ? incoming : []) {
    const cron = String(schedule?.cron || "").trim();
    if (before.get(String(schedule?.id)) === cron) continue;
    const problem = cronProblem(cron);
    if (problem) return `${String(schedule?.name || "A schedule").trim() || "A schedule"}: ${problem}`;
  }
  return null;
}

/** How many schedules in `list` were made through an agent key, not counting the one with id `exceptId`. */
export function agentScheduleCount(list, exceptId) {
  return (Array.isArray(list) ? list : []).filter((s) => s?.createdByAgentKeyId && String(s.id) !== String(exceptId)).length;
}
