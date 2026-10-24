import { releaseOrphanFilmHolds } from "../cartoon/filmStage.js";
import { releaseOrphanShotHolds } from "../sceneScript/shotStage.js";

/**
 * Release, at boot, every run hold the restart left on the shared AI video
 * ledger: cartoon films (`cartoon-film:`) and scene-script shot runs
 * (`ss-run:`). A hold stands only for clips not yet ordered, so after a
 * restart it covers nothing. This touches only the ledger file: it runs
 * whether or not AI video is set up and whether or not any project folder
 * exists, so no hold can outlive its run into the next month and shrink the
 * cap for every other feature. Holds of runs going in this process are kept.
 * Returns how many holds were released.
 */
export function releaseOrphanHolds(ledgerDir) {
  return releaseOrphanFilmHolds(ledgerDir) + releaseOrphanShotHolds(ledgerDir);
}
