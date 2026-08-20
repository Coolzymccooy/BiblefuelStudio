import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { storyApi } from '../../lib/storyApi';

/**
 * Project-level cast picker.
 *
 * Style anchors keep the LOOK consistent across scenes but say nothing about
 * WHO is in frame, so a recurring figure gets reinvented every scene — the main
 * reason AI-assembled stories look incoherent. Selecting the cast once per
 * project appends a fixed physical description to every scene prompt, which is
 * the image-generation equivalent of casting an actor.
 *
 * Cast is chosen per PROJECT rather than per scene because a story's cast does
 * not change halfway through, and because ambiguous figures (young David vs
 * King David) cannot be resolved automatically from scene text — only the
 * author knows which part of the story this is.
 */
export function CastPicker({
    projectId,
    value,
    onChange,
}: {
    projectId: string;
    value: string[];
    onChange?: (cast: string[]) => void;
}) {
    const [options, setOptions] = useState<Array<{ key: string; description: string }>>([]);
    const [saving, setSaving] = useState(false);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;
        storyApi.listCharacters()
            .then((list) => { if (!cancelled) setOptions(list); })
            // A failed lookup must not block the page — the cast is optional.
            .catch(() => { if (!cancelled) setOptions([]); });
        return () => { cancelled = true; };
    }, []);

    const selected = new Set(value || []);

    const toggle = async (key: string) => {
        const next = selected.has(key)
            ? (value || []).filter((k) => k !== key)
            : [...(value || []), key];
        setSaving(true);
        try {
            const project = await storyApi.setCast(projectId, next);
            onChange?.(project.cast || next);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not update the cast');
        } finally {
            setSaving(false);
        }
    };

    if (options.length === 0) return null;

    return (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center justify-between text-left"
                aria-expanded={open}
            >
                <span className="text-sm font-medium text-gray-200">
                    Cast {selected.size > 0 && <span className="text-primary-300">· {selected.size} selected</span>}
                </span>
                <span className="text-xs text-gray-400">{open ? 'Hide' : 'Choose'}</span>
            </button>

            {open && (
                <div className="mt-3 space-y-2">
                    <p className="text-xs text-gray-400">
                        Pick the figures in this story so they look the same in every scene.
                        Changing this affects scenes generated afterwards — regenerate existing
                        images to apply it.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {options.map((o) => (
                            <button
                                key={o.key}
                                type="button"
                                disabled={saving}
                                onClick={() => toggle(o.key)}
                                title={o.description}
                                aria-pressed={selected.has(o.key)}
                                className={`rounded-full border px-3 py-1 text-xs transition disabled:opacity-50 ${
                                    selected.has(o.key)
                                        ? 'border-primary-400/60 bg-primary-500/20 text-primary-100'
                                        : 'border-white/10 bg-black/20 text-gray-300 hover:border-white/25'
                                }`}
                            >
                                {o.key.replace(/_/g, ' ')}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
