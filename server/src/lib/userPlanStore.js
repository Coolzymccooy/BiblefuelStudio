import fs from "fs";
import path from "path";

/**
 * Per-user plan record store.
 *
 * Layout: DATA_DIR/users/<userId>/plan.json
 * Shape:  { plan, status, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, updatedAt }
 *
 * Plan tier comes from this store first; falls back to getPlanForUser() in
 * userPlan.js (which hard-codes super-admin via SUPER_ADMIN_EMAIL).
 *
 * Spec: docs/superpowers/specs/2026-05-26-public-multitenancy-design.md §Phase 3
 */

function planFilePath(dataDir) {
  if (!dataDir) throw new Error("plan: dataDir required");
  return path.join(dataDir, "plan.json");
}

const DEFAULT_RECORD = Object.freeze({
  plan: "free",
  status: "active",                  // active | past_due | canceled | none
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  currentPeriodEnd: null,            // ISO timestamp
  updatedAt: null,
});

/**
 * @param {string} dataDir
 * @returns {{plan:string, status:string, stripeCustomerId:string|null, stripeSubscriptionId:string|null, currentPeriodEnd:string|null, updatedAt:string|null}}
 */
export function readUserPlan(dataDir) {
  try {
    if (!fs.existsSync(dataDir)) return { ...DEFAULT_RECORD };
    const file = planFilePath(dataDir);
    if (!fs.existsSync(file)) return { ...DEFAULT_RECORD };
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      plan: String(parsed?.plan || DEFAULT_RECORD.plan),
      status: String(parsed?.status || DEFAULT_RECORD.status),
      stripeCustomerId: parsed?.stripeCustomerId || null,
      stripeSubscriptionId: parsed?.stripeSubscriptionId || null,
      currentPeriodEnd: parsed?.currentPeriodEnd || null,
      updatedAt: parsed?.updatedAt || null,
    };
  } catch {
    return { ...DEFAULT_RECORD };
  }
}

export function writeUserPlan(dataDir, patch) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const current = readUserPlan(dataDir);
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(planFilePath(dataDir), JSON.stringify(next, null, 2));
  return next;
}
