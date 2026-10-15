import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import type { LyricBranding, LyricBrandingPatch, LyricProject } from '../../lib/lyricVideoTypes';
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

const boxCls = 'accent-bf-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bf-gold';
const hintCls = 'ml-6 text-xs text-content-secondary';

/** The saved choices, and a way to change one: it saves at once and goes back if the save fails. */
function useBranding(project: LyricProject, onChange: (p: LyricProject) => void) {
  const id = project.projectId;
  const [branding, setBranding] = useState<LyricBranding | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<Choice | null>(null);

  useEffect(() => {
    let stopped = false;
    setBranding(null);
    setFailed(false);
    lyricVideoApi.branding(id).then(
      (b) => { if (!stopped) setBranding(b); },
      () => { if (!stopped) setFailed(true); },
    );
    return () => { stopped = true; };
  }, [id]);

  const choose = async (key: Choice, value: boolean) => {
    if (!branding) return;
    const before = branding;
    const patch: LyricBrandingPatch = { [key]: value };
    setSaving(key);
    setBranding({ ...before, [key]: value, ...(key === 'logo' ? { logoFromSettings: false } : {}) });
    try {
      onChange(await lyricVideoApi.setBranding(id, patch));
    } catch (e) {
      setBranding(before);
      toast.error(messageOf(e));
    } finally {
      setSaving(null);
    }
  };

  return { branding, failed, saving, choose };
}

/** Step 5: what the video shows besides the lyrics. */
export function BrandingOptions({ project, disabled, onChange }: Props) {
  const { branding, failed, saving, choose } = useBranding(project, onChange);
  const hasArtist = project.artist.trim() !== '';

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
              className={boxCls}
              checked={branding?.[key] ?? false}
              disabled={disabled || !branding || saving === key}
              onChange={(e) => void choose(key, e.target.checked)}
            />
            {label}
          </label>
          {key === 'logo' && branding && !branding.hasLogo && (
            <p className={hintCls}>
              No logo yet. Add one in <Link to="/app/settings" className="underline hover:text-bf-cream">Settings → Branding</Link>.
            </p>
          )}
          {key === 'logo' && branding && !hasArtist && (
            <p className={hintCls}>Add the artist&apos;s name on the Song step to show it.</p>
          )}
        </div>
      ))}
    </fieldset>
  );
}
