import { useEffect, useState } from 'react';
import { Wand2, Loader2 } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { api } from '../../lib/api';
import { STORAGE_KEYS, loadJson, saveJson } from '../../lib/storage';

/** One entry of the kinetic caption animation catalog (GET /api/tts/animations). */
export interface KineticAnimation {
  id: string;
  label: string;
  description: string;
  presetId: string;
  renderable: boolean;
  unsupported: string[];
}

interface AnimationPickerProps {
  /** Controlled selection (animation id). Falls back to localStorage, then a default. */
  value?: string;
  onChange?: (id: string, animation: KineticAnimation) => void;
  className?: string;
  /** Open on mount (the embedded lab shows it as its own tab). */
  defaultOpen?: boolean;
}

/**
 * Voice Lab caption-animation picker. Lists the ported lumina design-animations
 * from the server, with a badge for whether each fully renders server-side
 * (ffmpeg) vs preview-only, and chips for browser-only effects we don't render.
 * The chosen id is the `typographyPreset` passed to renders, and is persisted
 * to localStorage so the render flow can pick it up.
 */
export function AnimationPicker({ value, onChange, className = '', defaultOpen = false }: AnimationPickerProps) {
  const [animations, setAnimations] = useState<KineticAnimation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(
    // Shares RenderPage's storage key so a pick here becomes the render default.
    () => value || loadJson<string>(STORAGE_KEYS.renderTypographyPreset, 'cinematic-worship'),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await api.get<{ ok: boolean; animations: KineticAnimation[] }>('/api/tts/animations');
      if (cancelled) return;
      if (res.ok && res.data?.animations) {
        setAnimations(res.data.animations);
      } else {
        setError(res.error || 'Failed to load animations');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stay in sync when the parent controls the value.
  useEffect(() => {
    if (value && value !== selected) setSelected(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const pick = (a: KineticAnimation) => {
    setSelected(a.id);
    saveJson(STORAGE_KEYS.renderTypographyPreset, a.id);
    onChange?.(a.id, a);
  };

  return (
    <Card
      title="Caption Animation"
      icon={Wand2}
      className={className}
      collapsible
      defaultOpen={defaultOpen}
      tooltip="Word-synced motion styles applied to kinetic captions. Renderable presets bake into the final MP4 via ffmpeg; preview-only ones are browser previews while the renderer support catches up."
    >
      {loading ? (
        <div className="flex items-center gap-2 text-content-secondary text-sm">
          <Loader2 size={16} className="animate-spin" /> Loading animations…
        </div>
      ) : error ? (
        <div className="text-[11px] text-content-secondary">Animations unavailable right now — {error}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
          {animations.map((a) => {
            const active = a.id === selected;
            // Browser-only effects move to a hover tooltip so each card stays a
            // compact two-line tile instead of growing a chip stack.
            const tip = a.unsupported.length > 0
              ? `${a.description}\nBrowser-only (not baked): ${a.unsupported.join(', ')}`
              : a.description;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => pick(a)}
                aria-pressed={active}
                title={tip}
                className={`text-left rounded-lg px-3 py-2 border transition focus:outline-none focus:ring-2 focus:ring-editor-accent/40 ${
                  active
                    ? 'border-editor-accent/60 bg-editor-accent/10 ring-1 ring-editor-accent/40'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-gray-100" title={a.label}>{a.label}</span>
                  <Badge variant={a.renderable ? 'default' : 'warning'} className="shrink-0 !px-1.5 !py-0.5 !text-[10px]">
                    {a.renderable ? 'Renders' : 'Preview only'}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-content-secondary truncate">{a.description}</p>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
