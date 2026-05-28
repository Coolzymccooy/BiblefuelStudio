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
}

/**
 * Voice Lab caption-animation picker. Lists the ported lumina design-animations
 * from the server, with a badge for whether each fully renders server-side
 * (ffmpeg) vs preview-only, and chips for browser-only effects we don't render.
 * The chosen id is the `typographyPreset` passed to renders, and is persisted
 * to localStorage so the render flow can pick it up.
 */
export function AnimationPicker({ value, onChange, className = '' }: AnimationPickerProps) {
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
    <Card title="Caption Animation" icon={Wand2} className={className}>
      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <Loader2 size={16} className="animate-spin" /> Loading animations…
        </div>
      ) : error ? (
        <div className="text-red-300 text-sm">{error}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {animations.map((a) => {
            const active = a.id === selected;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => pick(a)}
                aria-pressed={active}
                className={`text-left rounded-xl p-3 border transition focus:outline-none focus:ring-2 focus:ring-emerald-400/40 ${
                  active
                    ? 'border-emerald-400/60 bg-emerald-500/10 ring-1 ring-emerald-400/40'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-100">{a.label}</span>
                  <Badge variant={a.renderable ? 'success' : 'warning'}>
                    {a.renderable ? 'Renderable' : 'Preview-only'}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-gray-400">{a.description}</p>
                {a.unsupported.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {a.unsupported.map((u) => (
                      <span
                        key={u}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500 border border-white/10"
                      >
                        no {u}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
