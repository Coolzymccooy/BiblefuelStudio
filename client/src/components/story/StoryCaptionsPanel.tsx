import { useEffect, useState, type ChangeEvent } from 'react';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { LAYOUT_OPTIONS } from '../../lib/layoutOptions';
import type { StoryCaptionSettings } from '../../lib/storyTypes';
import { isStudioLook, nextSeed, type StudioOption } from '../../lib/studioCaptions';
import { StudioLookOptions, StudioEffectsControls } from '../captions/StudioEffects';

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

const DEFAULT_PRESET = 'cinematic-default';
const CLASSIC_PRESETS = [
  { id: DEFAULT_PRESET, label: 'Cinematic (default)' },
  { id: 'intimate-fade', label: 'Intimate fade' },
  { id: 'scripture-emphasis', label: 'Scripture emphasis' },
  { id: 'playful-pop', label: 'Playful pop' },
  { id: 'worship-cinematic', label: 'Worship cinematic' },
] as const;

export function StoryCaptionsPanel({ value, onChange, busy = false }: StoryCaptionsPanelProps) {
  const [animations, setAnimations] = useState<AnimationOption[]>([]);
  const [motions, setMotions] = useState<MotionOption[]>([]);
  const [studioLooks, setStudioLooks] = useState<StudioOption[]>([]);
  const [energies, setEnergies] = useState<StudioOption[]>([]);
  const [libass, setLibass] = useState(true);
  const [catalogueLoaded, setCatalogueLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.get<{
        ok: boolean;
        animations?: AnimationOption[];
        motions?: MotionOption[];
        studioLooks?: StudioOption[];
        energies?: StudioOption[];
        libass?: boolean;
      }>('/api/tts/animations');
      if (cancelled || !res.ok) return; // The catalogue is optional: the rest of the panel still works.
      setAnimations(res.data?.animations ?? []);
      setMotions(res.data?.motions ?? []);
      setStudioLooks(res.data?.studioLooks ?? []);
      setEnergies(res.data?.energies ?? []);
      setLibass(res.data?.libass !== false);
      setCatalogueLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const captions = value.captions ?? 'kinetic';
  const on = captions !== 'none';
  // "static" predates the motion control. Turning captions off PERSISTS
  // 'none' over it, and `value` is the refetched project, so the old mode is
  // gone by the time the operator switches back on — remember it here, or a
  // legacy project silently becomes word-synced on an off/on round trip.
  const [lastOn, setLastOn] = useState<'static' | 'kinetic'>(captions === 'none' ? 'kinetic' : captions);
  useEffect(() => { if (captions !== 'none') setLastOn(captions); }, [captions]);
  const toggle = (next: string) => onChange({ captions: next === 'on' ? lastOn : 'none' });
  // What the renderer will actually do, not what the catalogue lists first:
  // buildStoryCaptions reads `captionMotion || (captions === 'static' ? 'lines' : …)`,
  // so a legacy static project renders per line even with no motion stored.
  const effectiveMotion = value.captionMotion || (captions === 'static' ? 'lines' : 'words');
  // Studio looks choreograph themselves (libass): the drawtext timing,
  // layout and depth controls don't apply, so they give way to Energy and
  // Shuffle.
  const studio = isStudioLook(value.captionPreset);
  // The look the select shows. New projects store "default", which is no
  // option (it renders as Cinematic), so the browser would show the first
  // option instead; after the catalogue loads, any other value that is not an
  // option reads as Cinematic too. A saved Studio look has its own option.
  const knownPreset = (id: string) =>
    CLASSIC_PRESETS.some((p) => p.id === id) || isStudioLook(id) || animations.some((a) => a.id === id);
  const stored = value.captionPreset;
  const shownPreset = !stored || stored === 'default' || (catalogueLoaded && !knownPreset(stored))
    ? DEFAULT_PRESET
    : stored;
  // The title is a free-text field, so it is drafted locally and saved on
  // blur/Enter; patching per keystroke would round-trip the project each time.
  const [titleDraft, setTitleDraft] = useState(value.captionTitle ?? '');
  useEffect(() => { setTitleDraft(value.captionTitle ?? ''); }, [value.captionTitle]);
  const commitTitle = () => {
    const next = titleDraft.replace(/\s+/g, ' ').trim();
    setTitleDraft(next); // show the cleaned title even when nothing changed to save
    if (next !== (value.captionTitle ?? '')) onChange({ captionTitle: next });
  };

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
          {!studio && motions.length > 0 && (
            <Field
              label="Caption motion"
              tooltip="How captions are TIMED, independent of how they look. Pick one base mode; stagger and highlight layer on top."
            >
              <Select
                aria-label="Caption motion"
                value={effectiveMotion}
                disabled={busy}
                // The motion list comes from the server catalogue, so TS can't
                // narrow it to the union; the options rendered below are the
                // only values reachable here.
                onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange({ captionMotion: e.target.value as StoryCaptionSettings['captionMotion'] })}
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
                {effectiveMotion !== 'words' && (
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
              value={shownPreset}
              disabled={busy}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange({ captionPreset: e.target.value })}
            >
              <StudioLookOptions looks={studioLooks} libass={libass} value={value.captionPreset} />
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
                {CLASSIC_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </optgroup>
            </Select>
          </Field>

          {studio && (
            <>
            <StudioEffectsControls
              look={value.captionPreset!}
              energy={value.captionEnergy || 'lively'}
              energies={energies}
              onEnergyChange={(next) => onChange({ captionEnergy: next })}
              onShuffle={() => onChange({ captionSeed: nextSeed(value.captionSeed) })}
              disabled={busy}
              unavailable={!libass}
            />
            <Field
              label="Title intro"
              tooltip="Optional. Shown big before the first line, like a song title — it needs a moment of silence before the narration starts (under ~0.7 s, it's skipped). Leave empty for none."
            >
              <Input
                type="text"
                aria-label="Title intro"
                value={titleDraft}
                maxLength={60}
                disabled={busy}
                placeholder="e.g. Hold My Hand"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              />
            </Field>
            </>
          )}

          {!studio && (
            <Field
              label="Text layout"
              tooltip="Where captions sit on the frame. Bottom layouts keep text in the safe band above the TikTok/Reels caption strip; staggered alternates left/centre/right."
            >
              <Select
                aria-label="Text layout"
                value={value.captionLayout || 'center'}
                disabled={busy}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange({ captionLayout: e.target.value as StoryCaptionSettings['captionLayout'] })}
              >
                {LAYOUT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
          )}

          {!studio && effectiveMotion === 'words' && (
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
          )}
        </>
      )}
    </div>
  );
}
