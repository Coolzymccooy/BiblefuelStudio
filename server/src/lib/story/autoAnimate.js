import { readProject, writeProject } from "./projectStore.js";
import { animatableScenes, estimateAnimation, startAnimation, qualityOf } from "./animateStage.js";
import { ledgerSummary } from "../videoGen/spend.js";
import { isSeedanceConfigured } from "../videoGen/providers/seedance.js";
import { DATA_DIR } from "../paths.js";

/**
 * Series "AI motion": once an aiMotion project's pictures are ready, animate
 * its scenes without anyone clicking Animate, within the month's cap.
 *
 * It spends once per project. aiMotion.autoStartedAt is written before any
 * clip is ordered, so a later resegment (which makes new pictures and comes
 * back through the images stage) never spends again on its own; re-rolls are
 * the user's Animate buttons. When the cap would be crossed it animates as
 * many scenes as fit, in scene order, and says so in aiMotion.note.
 *
 * It never throws: it runs after the images stage and must never fail it.
 */

export const NOT_CONFIGURED_NOTE = "AI motion is not set up on the server.";
export const BUDGET_NOTE = (picked, total) => `${picked} of ${total} scenes animated: monthly AI budget reached`;

// The ledger's own tolerance, so a batch that exactly meets the cap still fits.
const EPSILON = 1e-9;

/** Mark the one automatic try made, on the latest project on disk. */
function markStarted(dataDir, projectId, note) {
  const fresh = readProject(dataDir, projectId);
  if (!fresh?.aiMotion) return null;
  return writeProject(dataDir, {
    ...fresh,
    aiMotion: { ...fresh.aiMotion, autoStartedAt: fresh.aiMotion.autoStartedAt ?? Date.now(), note },
    updatedAt: Date.now(),
  });
}

/** The scenes that fit in what is left of the month's budget, in scene order. */
function pickWithinBudget(project, quality, ledgerDir) {
  const { capUsd, spentUsd, reservedUsd } = ledgerSummary(ledgerDir);
  const left = capUsd - spentUsd - reservedUsd;
  const scenes = animatableScenes(project);
  const picked = [];
  let total = 0;
  for (const s of scenes) {
    const usd = estimateAnimation(project, [s.id], quality).usd;
    if (total + usd > left + EPSILON) break;
    total += usd;
    picked.push(s.id);
  }
  return { picked, total: scenes.length };
}

/**
 * @param {{ dataDir: string, outputDir: string }} ctx
 * @param {string} projectId
 * @param {{ ledgerDir?: string, deps?: object, start?: typeof startAnimation }} [opts]
 *   start is a test seam; deps go to startAnimation.
 */
export async function autoAnimate(ctx, projectId, { ledgerDir = DATA_DIR, deps, start = startAnimation } = {}) {
  try {
    const project = readProject(ctx.dataDir, projectId);
    if (!project?.aiMotion || project.aiMotion.autoStartedAt) return;
    if (!isSeedanceConfigured()) {
      markStarted(ctx.dataDir, projectId, NOT_CONFIGURED_NOTE);
      return;
    }
    const quality = qualityOf(project.aiMotion.quality);
    const { picked, total } = pickWithinBudget(project, quality, ledgerDir);
    const note = picked.length < total ? BUDGET_NOTE(picked.length, total) : null;
    // Written first: from here on this project never auto-spends again.
    if (!markStarted(ctx.dataDir, projectId, note)) return;
    if (picked.length) start(ctx, projectId, { sceneIds: picked, quality, ledgerDir, deps });
  } catch (e) {
    const message = String(e?.message || e);
    console.warn(`[story] auto-animate ${projectId} failed: ${message}`);
    try {
      markStarted(ctx.dataDir, projectId, `AI motion could not start: ${message}`);
    } catch { /* the warning above is all that is left */ }
  }
}
