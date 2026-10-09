import { useEffect, useState, type ChangeEvent } from 'react';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
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
interface StudioOption { id: string; label: string; description?: string }

const FALLBACK_ENERGIES: StudioOption[] = [
  { id: 'calm', label: 'Calm' },
  { id: 'lively', label: 'Lively' },
  { id: 'wild', label: 'Wild' },
];

/** "studio-lagos-night" -> "Lagos Night". */
const readableLook = (id: string) =>
  id
    .replace(/^studio-/, '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

export interface StoryCaptionsPanelProps {
  value: StoryCaptionSettings;
  onChange: (patch: StoryCaptionSettings) => void;
  busy?: boolean;
}

export function StoryCaptionsPanel({ value, onChange, busy = false }: StoryCaptionsPanelProps) {
  const [animations, setAnimations] = useState<AnimationOption[]>([]);
  const [motions, setMotions] = useState<MotionOption[]>([]);
  const [studioLooks, setStudioLooks] = useState<StudioOption[]>([]);
  const [energies, setEnergies] = useState<StudioOption[]>([]);
  const [libass, setLibass] = useState(true);
  // A look whose sample clip failed to load: hide the player rather than show
  // a broken one.
  const [failedPreview, setFailedPreview] = useState<string | null>(null);

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
  const studio = (value.captionPreset || '').startsWith('studio-');
  // A saved Studio look must show correctly even before (or without) the
  // catalogue, or the select would display its first option instead.
  const savedStudioMissing = studio && !studioLooks.some((l) => l.id === value.captionPreset);
  // The title is a free-text field, so it is drafted locally and saved on
  // blur/Enter; patching per keystroke would round-trip the project each time.
  const [titleDraft, setTitleDraft] = useState(value.captionTitle ?? '');
  useEffect(() => { setTitleDraft(value.captionTitle ?? ''); }, [value.captionTitle]);
  const commitTitle = () => {
    const next = titleDraft.replace(/\s+/g, ' ').trim();
    if (next !== (value.captionTitle ?? '')) onChange({ captionTitle: next });
  };
  const energyOptions = energies.length > 0 ? energies : FALLBACK_ENERGIES;
  const shuffle = () => {
    let next = Math.floor(Math.random() * 2147483647);
    if (next === value.captionSeed) next = (next + 1) % 2147483647;
    onChange({ captionSeed: next });
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
              value={value.captionPreset || 'cinematic-default'}
              disabled={busy}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange({ captionPreset: e.target.value })}
            >
              {(studioLooks.length > 0 || savedStudioMissing) && (
                <optgroup label="Studio effects">
                  {savedStudioMissing && (
                    <option value={value.captionPreset}>{readableLook(value.captionPreset!)}</option>
                  )}
                  {studioLooks.map((l) => (
                    <option key={l.id} value={l.id} disabled={!libass}>
                      {l.label}{libass ? '' : ' (unavailable on this server)'}
                    </option>
                  ))}
                </optgroup>
              )}
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

          {studio && failedPreview !== value.captionPreset && (
            <video
              key={value.captionPreset}
              src={`/studio-looks/${value.captionPreset!.replace(/^studio-/, '')}.mp4`}
              autoPlay
              muted
              loop
              playsInline
              aria-label="Studio look sample"
              onError={() => setFailedPreview(value.captionPreset ?? null)}
              className="w-full max-w-xs rounded-lg border border-white/10"
            />
          )}

          {studio && (
            <>
            <Field
              label="Energy"
              tooltip="How wild the effects get. Calm pops and stacks words; Lively adds big brush slams on lines that repeat; Wild slams everywhere, made for songs."
            >
              <div className="flex items-center gap-2">
                <Select
                  aria-label="Energy"
                  value={value.captionEnergy || 'lively'}
                  disabled={busy}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange({ captionEnergy: e.target.value as StoryCaptionSettings['captionEnergy'] })}
                >
                  {energyOptions.map((en) => (
                    <option key={en.id} value={en.id}>{en.label}</option>
                  ))}
                </Select>
                <button
                  type="button"
                  onClick={shuffle}
                  disabled={busy}
                  className="shrink-0 rounded-lg border border-white/10 px-3 py-2.5 text-xs text-content-secondary hover:text-bf-cream disabled:opacity-50"
                  title="Re-roll which effect each line gets"
                >
                  Shuffle effects
                </button>
              </div>
            </Field>
            <Field
              label="Title intro"
              tooltip="Optional. Shown big before the first line, like a song title. Leave empty for none."
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
