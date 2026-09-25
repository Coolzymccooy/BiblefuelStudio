const RENDERABLE_TRACKS = new Set(['video', 'broll', 'voiceover', 'music', 'captions', 'effects']);

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clipEnd(clip) {
  return Math.max(0, Number(clip?.startSec || 0)) + Math.max(0, Number(clip?.durationSec || 0));
}

function assetIsRenderable(asset) {
  if (!asset || !asset.kind) return false;
  if (asset.kind === 'caption' || asset.kind === 'effect') return true;
  if (asset.path) return true;
  // Chatterbox/Fish voice-over placeholders are intentionally render-plan
  // compatible even before synthesis. The first proof-render path can surface
  // them as placeholders and later replace them with generated audio files.
  if (asset.kind === 'audio' && (asset.source === 'chatterbox' || asset.source === 'fish') && asset.prompt) return true;
  return false;
}

export function validateTimelineProjectForRender(project) {
  if (!isObject(project)) return { ok: false, error: 'timeline project object required' };
  if (!project.id || !project.title) return { ok: false, error: 'timeline project id/title required' };
  if (!Array.isArray(project.tracks)) return { ok: false, error: 'timeline project tracks[] required' };
  if (!isObject(project.assets)) return { ok: false, error: 'timeline project assets required' };

  let renderable = 0;
  for (const track of project.tracks) {
    if (!track || !RENDERABLE_TRACKS.has(track.kind) || !Array.isArray(track.clips)) continue;
    for (const clip of track.clips) {
      const asset = project.assets[clip?.assetId];
      if (assetIsRenderable(asset) && Number(clip?.durationSec || 0) > 0) renderable += 1;
    }
  }

  if (renderable === 0) return { ok: false, error: 'timeline project has no renderable clips' };
  return { ok: true, renderableClips: renderable };
}

export function buildTimelineRenderPlan(project, options = {}) {
  const valid = validateTimelineProjectForRender(project);
  if (!valid.ok) return valid;

  const tracks = project.tracks
    .filter((track) => RENDERABLE_TRACKS.has(track.kind) && Array.isArray(track.clips))
    .map((track) => ({
      id: track.id,
      kind: track.kind,
      label: track.label || track.kind,
      clips: track.clips
        .map((clip) => {
          const asset = project.assets[clip.assetId];
          if (!assetIsRenderable(asset) || Number(clip.durationSec || 0) <= 0) return null;
          return {
            id: clip.id,
            assetId: clip.assetId,
            label: asset.label || clip.assetId,
            source: asset.source,
            kind: asset.kind,
            path: asset.path || null,
            prompt: asset.prompt || null,
            placeholder: !asset.path && Boolean(asset.prompt),
            startSec: Math.max(0, Number(clip.startSec || 0)),
            durationSec: Math.max(0.1, Number(clip.durationSec || asset.durationSec || 5)),
            transform: clip.transform || { fit: 'cover' },
            // Track-specific payloads the renderer reads from the PLAN. The
            // whitelist above used to drop them, so caption clips arrived
            // without their text (nothing burned in) and effect clips without
            // their kind (nothing applied).
            ...(typeof clip.text === 'string' ? { text: clip.text } : {}),
            ...(clip.effect ? { effect: clip.effect } : {}),
            ...(clip.effectOptions ? { effectOptions: clip.effectOptions } : {}),
            ...(clip.muted ? { muted: true } : {}),
            ...(clip.transitionIn ? { transitionIn: clip.transitionIn } : {}),
            ...(clip.transitionOut ? { transitionOut: clip.transitionOut } : {}),
            ...(Number.isFinite(Number(clip.sourceStartSec)) && clip.sourceStartSec != null ? { sourceStartSec: Number(clip.sourceStartSec) } : {}),
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.startSec - b.startSec),
    }))
    .filter((track) => track.clips.length > 0);

  const durationSec = tracks.reduce((max, track) => Math.max(max, ...track.clips.map(clipEnd)), 0);

  return {
    ok: true,
    projectId: project.id,
    title: project.title,
    aspect: ['16:9', '9:16', '1:1'].includes(project.aspect) ? project.aspect : '16:9',
    quality: options.quality || project.renderSettings?.quality || 'proof_720p',
    durationSec: Math.round(durationSec * 100) / 100,
    tracks,
    scenes: Array.isArray(project.scenes) ? project.scenes : [],
    renderSettings: project.renderSettings || {},
  };
}
