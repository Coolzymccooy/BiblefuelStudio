import { usdForTokens, settleSpend, isReserved } from "./spend.js";

/**
 * Count one paid video task's cost exactly once, for any project whose shots
 * carry `clip.chargedTaskId` and whose total is `spentUsd` (scene scripts and
 * cartoons share this shape).
 *
 * The ledger settles only while the reservation stands (settling removes it in
 * the same write). The project total moves in the same write that marks the
 * shot charged for this task. So collecting the same task again, for example
 * after a server restart, never charges the ledger or the project twice.
 *
 * @param {object} args
 * @param {string} args.ledgerDir  the shared spend ledger's folder
 * @param {string} args.key        the ledger reservation key for this shot
 * @param {{model:string,resolution:string,tokens:number}} args.spend
 * @param {string} args.shotId
 * @param {string} args.taskId
 * @param {(fn: (project: object) => object|null) => unknown} args.update
 *   the project store's atomic read-modify-write, bound to this project
 * @returns {number} the task's cost in US$
 */
export function chargeTaskOnce({ ledgerDir, key, spend, shotId, taskId, update }) {
  const usd = isReserved(ledgerDir, key) ? settleSpend(ledgerDir, key, spend) : usdForTokens(spend);
  update((p) => {
    const shot = p.shots.find((s) => s.id === shotId);
    if (!shot || shot.clip?.chargedTaskId === taskId) return null;
    return {
      ...p,
      spentUsd: (Number(p.spentUsd) || 0) + usd,
      shots: p.shots.map((s) => (s.id === shotId ? { ...s, clip: { ...s.clip, chargedTaskId: taskId } } : s)),
    };
  });
  return usd;
}
