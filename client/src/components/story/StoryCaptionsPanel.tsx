import { useEffect, useState, type ChangeEvent } from 'react';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { LAYOUT_OPTIONS } from '../../lib/layoutOptions';
import type { StoryCaptionSettings } from '../../lib/storyTypes';

/**
 * Caption controls for a Story Video project.
 *
 * Story renders burn captions from the narration transcript, so unlike the
 * Render screen there is no overlay-text editor here — only the look and the
 * timing. The catalogues (animations, motions) come from the server so this
 * picker and the Render/Voice Lab ones cannot list different sets, and the
 * layouts come from the shared LAYOUT_OPTIONS for the same reason.
 *
 * Every change is a patch, not a whole settings object: the caller decides
 * when to persist, and the server merges against the stored project.
 */

interface AnimationOption { id: string; label: string; renderable?: boolean }
interface MotionOption { id: string; label: string; description?: string }

export interface StoryCaptionsPanelProps {
  value: StoryCaptionSettings;
  onChange: (patch: StoryCaptionSettings) => void;
  busy?: boolean;
}

export function StoryCaptionsPanel({ value, onChange, busy = false }: StoryCaptionsPanelProps) {
  const [animations, setAnimations] = useState<AnimationOption[]>([]);
  const [motions, setMotions] = useState<MotionOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.get<{ ok: boolean; animations?: AnimationOption[]; motions?: MotionOption[] }>(
        '/api/tts/animations',
      );
      if (cancelled || !res.ok) return; // The catalogue is optional: the rest of the panel still works.
      setAnimations(res.data?.animations ?? []);
      setMotions(res.data?.motions ?? []);
    })();
    return () => { cancelled = true; };
  }, []);

  const captions = value.captions ?? 'kinetic';
  const on = captions !== 'none';
  // "static" predates the motion control; keep it on a project that has it so
  // turning captions off and on again doesn't silently change the render.
  const toggle = (next: string) => onChange({ captions: next === 'on' ? (captions === 'none' ? 'kinetic' : captions) : 'none' });

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-4">
      <Field
        label="Captions"
        tooltip="Burn the narration into the video as captions. The words come from the transcript — there is nothing to type."
      >
        <Select aria-label="Captions" value={on ? 'on' : 'none'} disabled={busy} onChange={(e: ChangeEvent<HTMLSelectElement>) => toggle(e.target.value)}>
          <option value="on">On</option>
          <option value="none">Off</option>
        </Select>
      </Field>

      {on && (
        <>
          {motions.length > 0 && (
            <Field
              label="Caption motion"
              tooltip="How captions are TIMED, independent of how they look. Pick one base mode; stagger and highlight layer on top."
            >
              <Select
                aria-label="Caption motion"
                value={value.captionMotion || motions[0].id}
                disabled={busy}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange({ captionMotion: e.target.value })}
              >
                {motions.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </Select>
              <div className="mt-2 space-y-1.5">
                <label className="flex items-center gap-2 text-[12px] text-content-secondary">
                  <input
                    type="checkbox"
                    checked={Boolean(value.captionStagger)}
                    disabled={busy}
                    onChange={(e) => onChange({ captionStagger: e.target.checked })}
                  />
                  Stagger lines (arrive a beat apart)
                </label>
                {/* Highlighting the spoken word only means something when a
                    whole line is on screen — per-word mode has nothing to
                    highlight it against. */}
                {value.captionMotion !== 'words' && (
                  <label className="flex items-center gap-2 text-[12px] text-content-secondary">
                    <input
                      type="checkbox"
                      checked={Boolean(value.captionHighlight)}
                      disabled={busy}
                      onChange={(e) => onChange({ captionHighlight: e.target.checked })}
                    />
                    Highlight each word on the line
                  </label>
                )}
              </div>
            </Field>
          )}

          <Field
            label="Caption animation"
            tooltip="Word-synced motion applies when captions are per-word. The list matches the Voice Lab picker."
          >
            <Select
              aria-label="Caption animation"
              value={value.captionPreset || 'cinematic-default'}
              disabled={busy}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange({ captionPreset: e.target.value })}
            >
              {animations.length > 0 && (
                <optgroup label="Caption animations (word-synced)">
                  {animations.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}{a.renderable ? '' : ' (preview-only)'}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Classic presets (no motion)">
                <option value="cinematic-default">Cinematic (default)</option>
                <option value="intimate-fade">Intimate fade</option>
                <option value="scripture-emphasis">Scripture emphasis</option>
                <option value="playful-pop">Playful pop</option>
                <option value="worship-cinematic">Worship cinematic</option>
              </optgroup>
            </Select>
          </Field>

          <Field
            label="Text layout"
            tooltip="Where captions sit on the frame. Bottom layouts keep text in the safe band above the TikTok/Reels caption strip; staggered alternates left/centre/right."
          >
            <Select
              aria-label="Text layout"
              value={value.captionLayout || 'center'}
              disabled={busy}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange({ captionLayout: e.target.value })}
            >
              {LAYOUT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300" title="Ghost shadow behind each word">
            <input
              type="checkbox"
              checked={(value.captionDepth ?? 'none') !== 'none'}
              disabled={busy}
              onChange={(e) => onChange({ captionDepth: e.target.checked ? 'soft' : 'none' })}
              className="rounded border-white/10 bg-black/50 checked:bg-primary-500"
            />
            Layered depth (ghost shadow behind each word)
          </label>
        </>
      )}
    </div>
  );
}
