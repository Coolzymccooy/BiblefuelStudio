import { describe, it, expect } from 'vitest';
import {
  addEffectToScene,
  removeEffectClip,
  effectClipLabel,
  collectEffectsForRender,
  DEFAULT_EFFECT_OPTIONS,
} from '../timelineEffects';
import { buildWorshipDocumentaryProject } from '../timelineProject';

function project() {
  return buildWorshipDocumentaryProject({ title: 'T' });
}

describe('addEffectToScene', () => {
  it('places the effect at the scene it targets, not at zero', () => {
    const p = project();
    const scene = p.scenes[2];
    const next = addEffectToScene(p, { sceneId: scene.id, effect: 'glow' });
    const track = next.tracks.find((t) => t.kind === 'effects')!;
    expect(track.clips).toHaveLength(1);
    expect(track.clips[0].startSec).toBe(scene.startSec);
  });

  it('never mutates the project it was given', () => {
    const p = project();
    const before = JSON.stringify(p);
    addEffectToScene(p, { sceneId: p.scenes[0].id, effect: 'grade' });
    expect(JSON.stringify(p)).toBe(before);
  });

  it('applies per-effect defaults so a clip is renderable without extra input', () => {
    const p = project();
    const next = addEffectToScene(p, { sceneId: p.scenes[0].id, effect: 'grade' });
    const clip = next.tracks.find((t) => t.kind === 'effects')!.clips[0];
    expect(clip.effect).toBe('grade');
    expect(clip.effectOptions).toEqual(DEFAULT_EFFECT_OPTIONS.grade);
  });

  it('honours caller-supplied options over the defaults', () => {
    const p = project();
    const next = addEffectToScene(p, {
      sceneId: p.scenes[0].id, effect: 'glow', options: { intensity: 0.9 },
    });
    const clip = next.tracks.find((t) => t.kind === 'effects')!.clips[0];
    expect(clip.effectOptions?.intensity).toBe(0.9);
    // Unspecified keys still fall back to the default.
    expect(clip.effectOptions?.radius).toBe(DEFAULT_EFFECT_OPTIONS.glow.radius);
  });

  it('a transition is short and sits on the scene BOUNDARY', () => {
    const p = project();
    const scene = p.scenes[1];
    const next = addEffectToScene(p, { sceneId: scene.id, effect: 'transition' });
    const clip = next.tracks.find((t) => t.kind === 'effects')!.clips[0];
    // A transition joins the previous scene to this one, so it straddles the
    // boundary rather than starting inside the scene.
    expect(clip.durationSec).toBeLessThanOrEqual(1);
    expect(clip.startSec).toBeLessThanOrEqual(scene.startSec);
  });

  it('clamps a non-transition effect to the scene length', () => {
    const p = project();
    const scene = p.scenes[0];
    const next = addEffectToScene(p, {
      sceneId: scene.id, effect: 'lightleak', durationSec: 9999,
    });
    const clip = next.tracks.find((t) => t.kind === 'effects')!.clips[0];
    expect(clip.durationSec).toBeLessThanOrEqual(scene.targetDurationSec);
  });

  it('returns the project unchanged for an unknown scene', () => {
    const p = project();
    const next = addEffectToScene(p, { sceneId: 'nope', effect: 'glow' });
    expect(next).toBe(p);
  });

  it('stacks multiple effects on one scene', () => {
    const p = project();
    const id = p.scenes[0].id;
    const a = addEffectToScene(p, { sceneId: id, effect: 'glow' });
    const b = addEffectToScene(a, { sceneId: id, effect: 'grade' });
    expect(b.tracks.find((t) => t.kind === 'effects')!.clips).toHaveLength(2);
  });
});

describe('removeEffectClip', () => {
  it('removes only the named clip', () => {
    const p = project();
    const id = p.scenes[0].id;
    const a = addEffectToScene(p, { sceneId: id, effect: 'glow' });
    const b = addEffectToScene(a, { sceneId: id, effect: 'grade' });
    const target = b.tracks.find((t) => t.kind === 'effects')!.clips[0];
    const c = removeEffectClip(b, target.id);
    const left = c.tracks.find((t) => t.kind === 'effects')!.clips;
    expect(left).toHaveLength(1);
    expect(left[0].id).not.toBe(target.id);
  });

  it('drops the orphaned asset so the project does not grow forever', () => {
    const p = project();
    const a = addEffectToScene(p, { sceneId: p.scenes[0].id, effect: 'glow' });
    const clip = a.tracks.find((t) => t.kind === 'effects')!.clips[0];
    const b = removeEffectClip(a, clip.id);
    expect(b.assets[clip.assetId]).toBeUndefined();
  });
});

describe('collectEffectsForRender', () => {
  it('emits the shape the server normalizer expects', () => {
    const p = project();
    const next = addEffectToScene(p, { sceneId: p.scenes[0].id, effect: 'grade' });
    const [payload] = collectEffectsForRender(next);
    // server/src/lib/timelineRender/effects.js reads effect/startSec/
    // durationSec/options off each clip.
    expect(payload).toMatchObject({
      effect: 'grade',
      startSec: expect.any(Number),
      durationSec: expect.any(Number),
      options: expect.any(Object),
    });
  });

  it('is empty when nothing has been added', () => {
    expect(collectEffectsForRender(project())).toEqual([]);
  });

  it('returns effects in start order', () => {
    const p = project();
    const late = addEffectToScene(p, { sceneId: p.scenes[3].id, effect: 'glow' });
    const both = addEffectToScene(late, { sceneId: p.scenes[0].id, effect: 'grade' });
    const out = collectEffectsForRender(both);
    expect(out[0].startSec).toBeLessThanOrEqual(out[1].startSec);
  });
});

describe('effectClipLabel', () => {
  it('names the effect and its distinguishing option', () => {
    expect(effectClipLabel('grade', { look: 'cinematic' })).toMatch(/cinematic/i);
    expect(effectClipLabel('transition', { style: 'wipeleft' })).toMatch(/wipeleft/i);
  });

  it('falls back to the effect name alone', () => {
    expect(effectClipLabel('glow', {})).toMatch(/glow/i);
  });
});
