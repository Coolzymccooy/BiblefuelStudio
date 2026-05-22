import { useCallback, useEffect, useState } from 'react';
import { loadJson, saveJson, STORAGE_KEYS } from './storage';

export interface VoiceSynthesisDefaults {
    enabled: boolean;
    category: string;
    providerOverride: string;
    cinematicMode: boolean;
}

export const DEFAULT_VOICE_SYNTHESIS: VoiceSynthesisDefaults = {
    enabled: false,
    category: 'devotional',
    providerOverride: '',
    cinematicMode: true,
};

export function loadVoiceSynthesisDefaults(): VoiceSynthesisDefaults {
    const raw = loadJson<Partial<VoiceSynthesisDefaults>>(
        STORAGE_KEYS.voiceSynthesisDefaults,
        {},
    );
    return {
        enabled: Boolean(raw?.enabled),
        category: typeof raw?.category === 'string' && raw.category.trim().length > 0
            ? raw.category
            : DEFAULT_VOICE_SYNTHESIS.category,
        providerOverride: typeof raw?.providerOverride === 'string'
            ? raw.providerOverride
            : DEFAULT_VOICE_SYNTHESIS.providerOverride,
        cinematicMode: raw?.cinematicMode ?? DEFAULT_VOICE_SYNTHESIS.cinematicMode,
    };
}

export function saveVoiceSynthesisDefaults(value: VoiceSynthesisDefaults) {
    saveJson(STORAGE_KEYS.voiceSynthesisDefaults, value);
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('bf:voice-synthesis-defaults'));
    }
}

export function useVoiceSynthesisDefaults(): [
    VoiceSynthesisDefaults,
    (patch: Partial<VoiceSynthesisDefaults>) => void,
] {
    const [state, setState] = useState<VoiceSynthesisDefaults>(() => loadVoiceSynthesisDefaults());

    useEffect(() => {
        const handler = () => setState(loadVoiceSynthesisDefaults());
        window.addEventListener('bf:voice-synthesis-defaults', handler);
        window.addEventListener('storage', handler);
        return () => {
            window.removeEventListener('bf:voice-synthesis-defaults', handler);
            window.removeEventListener('storage', handler);
        };
    }, []);

    const update = useCallback((patch: Partial<VoiceSynthesisDefaults>) => {
        setState((prev) => {
            const next = { ...prev, ...patch };
            saveVoiceSynthesisDefaults(next);
            return next;
        });
    }, []);

    return [state, update];
}
