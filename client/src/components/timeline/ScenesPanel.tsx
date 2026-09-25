import type { TimelineProject, TimelineEffectKind } from '../../lib/timelineProject';
import {
  TRANSITION_STYLE_IDS,
  GRADE_LOOK_IDS,
  LIGHTLEAK_COLOUR_IDS,
} from '../../lib/timelineProject';
import { effectClipLabel } from '../../lib/timelineEffects';
import { Wand2, Trash2 } from 'lucide-react';

/**
 * Scenes panel: pick a scene, then attach an effect to it.
 *
 * Scenes were previously rendered as inert <div>s here and as draggable-but-
 * unclickable blocks in the strip, so a scene could not be selected anywhere.
 * Selection matters because effects attach TO a scene — without it there is no
 * way to say where a glow or a grade should apply.
 */

const EFFECTS: Array<{ id: TimelineEffectKind; label: string; hint: string }> = [
  { id: 'transition', label: 'Transition', hint: 'Joins the previous scene to this one' },
  { id: 'grade', label: 'Grade', hint: 'Colour look across the scene' },
  { id: 'glow', label: 'Glow', hint: 'Soft bloom on highlights' },
  { id: 'lightleak', label: 'Light leak', hint: 'Angled light wash' },
];

/** The option each effect varies by, so one control covers all four. */
const OPTION_SETS: Partial<Record<TimelineEffectKind, { key: 'style' | 'look' | 'colour'; values: readonly string[] }>> = {
  transition: { key: 'style', values: TRANSITION_STYLE_IDS },
  grade: { key: 'look', values: GRADE_LOOK_IDS },
  lightleak: { key: 'colour', values: LIGHTLEAK_COLOUR_IDS },
};

export interface ScenesPanelProps {
  project: TimelineProject | null;
  selectedSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  onAddEffect: (sceneId: string, effect: TimelineEffectKind, option?: string) => void;
  onRemoveEffect: (clipId: string) => void;
  /** Which option value is chosen per effect, e.g. { grade: 'cinematic' }. */
  effectOption: Partial<Record<TimelineEffectKind, string>>;
  onEffectOptionChange: (effect: TimelineEffectKind, value: string) => void;
}

export function ScenesPanel({
  project,
  selectedSceneId,
  onSelectScene,
  onAddEffect,
  onRemoveEffect,
  effectOption,
  onEffectOptionChange,
}: ScenesPanelProps) {
  if (!project) {
    return <p className="text-[11px] text-editor-faint">Create a documentary timeline first.</p>;
  }

  const selected = project.scenes.find((s) => s.id === selectedSceneId) || null;
  const effectsTrack = project.tracks.find((t) => t.kind === 'effects');

  // Only the effects sitting inside the selected scene, so the list answers
  // "what is on THIS scene" rather than showing every effect in the project.
  const sceneEffects = selected
    ? (effectsTrack?.clips || []).filter(
        (c) =>
          c.startSec >= selected.startSec - 1 &&
          c.startSec < selected.startSec + selected.targetDurationSec,
      )
    : [];

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {project.scenes.map((scene) => {
          const active = scene.id === selectedSceneId;
          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => onSelectScene(scene.id)}
              aria-pressed={active}
              className={`w-full rounded-lg border p-2 text-left transition ${
                active
                  ? 'border-primary-300 bg-primary-500/15'
                  : 'border-editor-line hover:border-primary-300/50'
              }`}
            >
              <p className="text-xs font-semibold text-editor-text">{scene.label}</p>
              <p className="mt-0.5 line-clamp-2 text-[10px] text-editor-dim">{scene.voiceoverBrief}</p>
            </button>
          );
        })}
      </div>

      {!selected ? (
        <p className="text-[11px] text-editor-faint">Select a scene to add effects to it.</p>
      ) : (
        <div className="space-y-2 border-t border-editor-line pt-3">
          <p className="text-[10px] uppercase tracking-[.12em] text-editor-faint">
            Effects on {selected.label}
          </p>

          {EFFECTS.map((fx) => {
            const opts = OPTION_SETS[fx.id];
            return (
              <div key={fx.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onAddEffect(selected.id, fx.id, opts ? effectOption[fx.id] : undefined)}
                  title={fx.hint}
                  className="inline-flex flex-1 items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-1.5 text-[11px] text-primary-200 transition-colors hover:bg-white/[0.12]"
                >
                  <Wand2 size={12} /> {fx.label}
                </button>
                {opts && (
                  <select
                    aria-label={`${fx.label} option`}
                    value={effectOption[fx.id] ?? opts.values[0]}
                    onChange={(e) => onEffectOptionChange(fx.id, e.target.value)}
                    className="w-24 rounded-md border border-editor-line bg-editor-panel px-1.5 py-1 text-[11px] text-editor-text"
                  >
                    {opts.values.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}

          {sceneEffects.length === 0 ? (
            <p className="text-[10px] text-editor-faint">No effects on this scene yet.</p>
          ) : (
            <ul className="space-y-1">
              {sceneEffects.map((clip) => (
                <li key={clip.id} className="flex items-center gap-2 rounded-md bg-white/[0.04] px-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-editor-text">
                    {effectClipLabel(clip.effect!, clip.effectOptions || {})}
                  </span>
                  <span className="text-[10px] text-editor-faint">{Math.round(clip.durationSec)}s</span>
                  <button
                    type="button"
                    onClick={() => onRemoveEffect(clip.id)}
                    aria-label={`Remove ${effectClipLabel(clip.effect!, clip.effectOptions || {})}`}
                    className="text-editor-faint transition-colors hover:text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
