import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import type { LyricBranding, LyricBrandingPatch, LyricProject } from '../../lib/lyricVideoTypes';
import { checkboxCls } from '../story/formStyles';
import { messageOf } from './messageOf';

interface Props {
  project: LyricProject;
  /** True while a video is being made. */
  disabled: boolean;
  onChange: (p: LyricProject) => void;
}

type Choice = 'logo' | 'intro' | 'endCard';

const CHOICES: Array<{ key: Choice; label: string }> = [
  { key: 'logo', label: 'Logo and artist name' },
  { key: 'intro', label: 'Intro credit' },
  { key: 'endCard', label: 'End card' },
];

const LOGO_HINT_ID = 'lyric-branding-logo-hint';
const ARTIST_HINT_ID = 'lyric-branding-artist-hint';
const hintCls = 'ml-6 text-xs text-content-secondary';

/** The saved choices, and a way to change one: it saves at once and goes back if the save fails. */
function useBranding(project: LyricProject, onChange: (p: LyricProject) => void) {
  const id = project.projectId;
  const [branding, setBranding] = useState<LyricBranding | null>(null);
  const [failed, setFailed] = useState(false);
  // One save at a time: while any is in flight every box is disabled, so saves never overlap.
  const [saving, setSaving] = useState(false);
  // The project being shown now; a save for another one that finishes late is ignored.
  const current = useRef(id);
  current.current = id;

  useEffect(() => {
    let stopped = false;
    setBranding(null);
    setFailed(false);
    setSaving(false);
    lyricVideoApi.branding(id).then(
      (b) => { if (!stopped) setBranding(b); },
      () => { if (!stopped) setFailed(true); },
    );
    return () => { stopped = true; };
  }, [id]);

  const choose = async (key: Choice, value: boolean) => {
    if (!branding || saving) return;
    const previous = branding[key];
    const patch: LyricBrandingPatch = { [key]: value };
    setSaving(true);
    setBranding((b) => b && { ...b, [key]: value, ...(key === 'logo' ? { logoFromSettings: false } : {}) });
    try {
      const saved = await lyricVideoApi.setBranding(id, patch);
      if (current.current === id) onChange(saved);
    } catch (e) {
      if (current.current !== id) return;
      setBranding((b) => b && { ...b, [key]: previous });
      toast.error(messageOf(e));
    } finally {
      if (current.current === id) setSaving(false);
    }
  };

  return { branding, failed, saving, choose };
}

/** Step 5: what the video shows besides the lyrics. */
export function BrandingOptions({ project, disabled, onChange }: Props) {
  const { branding, failed, saving, choose } = useBranding(project, onChange);
  const hasArtist = project.artist.trim() !== '';
  const noLogo = branding !== null && !branding.hasLogo;
  const noArtist = branding !== null && !hasArtist;
  // The Logo checkbox is described by whichever hints are showing.
  const logoHints = [noLogo && LOGO_HINT_ID, noArtist && ARTIST_HINT_ID].filter(Boolean).join(' ') || undefined;

  return (
    <fieldset className="space-y-2">
      <legend className="field-label">Branding</legend>
      {failed ? (
        <p role="alert" className="text-xs text-content-secondary">
          The branding options could not be loaded. The video uses your usual settings.
        </p>
      ) : CHOICES.map(({ key, label }) => (
        <div key={key} className="space-y-1">
          <label className="flex items-center gap-2 text-sm text-content-secondary">
            <input
              type="checkbox"
              className={checkboxCls}
              checked={branding?.[key] ?? false}
              disabled={disabled || !branding || saving}
              aria-describedby={key === 'logo' ? logoHints : undefined}
              onChange={(e) => void choose(key, e.target.checked)}
            />
            {label}
          </label>
          {key === 'logo' && noLogo && (
            <p id={LOGO_HINT_ID} className={hintCls}>
              No logo yet. Add one in <Link to="/app/settings" className="underline hover:text-bf-cream">Settings → Branding</Link>.
            </p>
          )}
          {key === 'logo' && noArtist && (
            <p id={ARTIST_HINT_ID} className={hintCls}>Add the artist&apos;s name on the Song step to show it.</p>
          )}
        </div>
      ))}
    </fieldset>
  );
}
