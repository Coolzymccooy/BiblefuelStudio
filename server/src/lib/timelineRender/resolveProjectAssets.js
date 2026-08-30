/**
 * Timeline assets can carry a LIBRARY ID instead of a file path - "Send
 * backgrounds to B-roll" hands over the Background tool's picks, whose ids are
 * library/Pexels ids the captioned-video route already knows how to resolve.
 * The proof renderer only understands files and URLs, so an id reached ffmpeg
 * as a missing input and surfaced as "we couldn't read one of your media
 * files". Resolve ids to real media BEFORE the plan is built.
 *
 * `resolve(pathOrId)` is injected (routes/jobs.js's resolveAssetPath in
 * production) so this stays a pure, testable mapping.
 */
export function resolveProjectAssets(project, { resolve, exists }) {
  if (!project || typeof project !== 'object' || !project.assets || typeof project.assets !== 'object') return project;
  let changed = false;
  const assets = {};
  for (const [id, asset] of Object.entries(project.assets)) {
    const raw = asset && typeof asset.path === 'string' ? asset.path.trim() : '';
    if (!raw || /^https?:\/\//i.test(raw) || exists(raw)) { assets[id] = asset; continue; }
    const resolved = resolve(raw);
    if (resolved && resolved !== raw) {
      assets[id] = { ...asset, path: resolved, sourceId: asset.sourceId || raw };
      changed = true;
    } else {
      assets[id] = asset;
    }
  }
  return changed ? { ...project, assets } : project;
}
