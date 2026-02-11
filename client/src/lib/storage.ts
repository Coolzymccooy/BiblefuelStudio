export const STORAGE_KEYS = {
    scripts: 'BF_SCRIPTS',
    audioPath: 'BF_AUDIO_PATH',
    audioHistory: 'BF_AUDIO_HISTORY',
    timelineClips: 'BF_TIMELINE_CLIPS',
    ttsText: 'BF_TTS_TEXT',
    renderLines: 'BF_RENDER_LINES',
    renderBackgroundPath: 'BF_RENDER_BG',
    renderInBackground: 'BF_RENDER_BG_MODE',
    renderAspect: 'BF_RENDER_ASPECT',
    renderCaptionWidth: 'BF_RENDER_CAPTION_WIDTH',
    renderMusicPath: 'BF_RENDER_MUSIC_PATH',
    renderMusicVolume: 'BF_RENDER_MUSIC_VOL',
    renderAutoDuck: 'BF_RENDER_AUTO_DUCK',
    renderDurationSec: 'BF_RENDER_DURATION_SEC',
    ttsVoiceId: 'BF_TTS_VOICE_ID',
    ttsStability: 'BF_TTS_STABILITY',
    ttsSimilarity: 'BF_TTS_SIMILARITY',
    ttsVoicePresets: 'BF_TTS_VOICE_PRESETS',
};

export function loadJson<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

export function saveJson<T>(key: string, value: T) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
}

export function pushUnique<T>(
    key: string,
    item: T,
    getId: (item: T) => string,
    max = 25
): T[] {
    const list = loadJson<T[]>(key, []);
    const id = getId(item);
    const next = [item, ...list.filter((i) => getId(i) !== id)].slice(0, max);
    saveJson(key, next);
    return next;
}

export function toOutputUrl(path: string | undefined | null, baseUrl: string) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const fileName = path.split(/[\\/]/).pop();
    if (!fileName) return '';
    return `${baseUrl}/outputs/${fileName}`;
}
