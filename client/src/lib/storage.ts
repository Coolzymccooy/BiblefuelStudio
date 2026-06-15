export const STORAGE_KEYS = {
    scripts: 'BF_SCRIPTS',
    audioPath: 'BF_AUDIO_PATH',
    audioHistory: 'BF_AUDIO_HISTORY',
    timelineClips: 'BF_TIMELINE_CLIPS',
    ttsText: 'BF_TTS_TEXT',
    renderLines: 'BF_RENDER_LINES',
    renderBackgroundPath: 'BF_RENDER_BG',
    // Multi-bg picker on the Render page — ordered array of up to 4
    // LibraryItems (Pexels picks + local uploads). When length > 1 the render
    // request transparently switches to the queued scenes[] path on the
    // server, which hard-cuts between segments. Single-item case stays on
    // the legacy instant path.
    renderBackgrounds: 'BF_RENDER_BGS',
    renderInBackground: 'BF_RENDER_BG_MODE',
    renderAspect: 'BF_RENDER_ASPECT',
    renderCaptionWidth: 'BF_RENDER_CAPTION_WIDTH',
    renderMusicPath: 'BF_RENDER_MUSIC_PATH',
    renderMusicVolume: 'BF_RENDER_MUSIC_VOL',
    renderAutoDuck: 'BF_RENDER_AUTO_DUCK',
    renderDurationSec: 'BF_RENDER_DURATION_SEC',
    renderTypographyPreset: 'BF_RENDER_TYPOGRAPHY_PRESET',
    renderLayout: 'BF_RENDER_LAYOUT',
    renderDepth: 'BF_RENDER_DEPTH',
    ttsVoiceId: 'BF_TTS_VOICE_ID',
    ttsStability: 'BF_TTS_STABILITY',
    ttsSimilarity: 'BF_TTS_SIMILARITY',
    ttsVoicePresets: 'BF_TTS_VOICE_PRESETS',
    ttsProvider: 'BF_TTS_PROVIDER',
    ttsEdgeVoiceId: 'BF_TTS_EDGE_VOICE_ID',
    voiceSynthesisDefaults: 'BF_VOICE_SYNTHESIS_DEFAULTS',
    // Voice Lab "Compare voices": last text + persisted star ratings/notes
    // keyed by `${textHash}:${provider}:${voiceId||'default'}` so revisiting
    // the same combo restores the prior rating.
    compareText: 'BF_COMPARE_TEXT',
    compareRatings: 'BF_COMPARE_RATINGS',
    // Sermon Clip Studio (Timeline page): persist the entire captioned-video
    // flow so a browser refresh doesn't wipe the uploaded audio, transcript,
    // edited lines, music, background, preset, or last render. Keyed `scl*`
    // to stay isolated from the legacy /render page's `render*` keys, which
    // a different surface area may write to.
    sclSourcePath: 'BF_SCL_SOURCE_PATH',
    sclSourceKind: 'BF_SCL_SOURCE_KIND',
    sclTranscript: 'BF_SCL_TRANSCRIPT',
    sclEditedLines: 'BF_SCL_EDITED_LINES',
    sclMusicPath: 'BF_SCL_MUSIC_PATH',
    sclMusicVolume: 'BF_SCL_MUSIC_VOLUME',
    sclAutoDuck: 'BF_SCL_AUTO_DUCK',
    sclBackground: 'BF_SCL_BACKGROUND', // legacy single-bg key, kept for back-compat reads
    sclBackgrounds: 'BF_SCL_BACKGROUNDS', // new: array of up to 4 LibraryItems
    sclAutoBackground: 'BF_SCL_AUTO_BACKGROUND', // let BibleFuel auto-pick from the user's library pool
    sclSyncBackgrounds: 'BF_SCL_SYNC_BACKGROUNDS', // sync multi-bg cuts to speech + crossfade
    sclKineticCaptions: 'BF_SCL_KINETIC_CAPTIONS', // burn per-word captions onto the video (off = plain audio/video + bg)
    sclTypographyPreset: 'BF_SCL_TYPOGRAPHY_PRESET',
    sclLayout: 'BF_SCL_LAYOUT',
    sclDepth: 'BF_SCL_DEPTH',
    sclRenderedVideo: 'BF_SCL_RENDERED_VIDEO',
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
    const root = String(baseUrl || '').trim() || (typeof window !== 'undefined' ? window.location.origin : '');
    return `${root}/outputs/${fileName}`;
}
