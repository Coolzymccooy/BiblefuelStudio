export type VoiceWordTiming = { text: string; startMs: number; endMs: number };

export interface VoiceTakeTiming {
    path: string;
    revision: number;
    timingPath: string | null;
    words: VoiceWordTiming[] | null;
    status: string;
}

export const emptyVoiceTakeTiming: VoiceTakeTiming = {
    path: '', revision: 0, timingPath: null, words: null, status: 'No audio selected.',
};

const record = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function validatedNativeWords(value: unknown): VoiceWordTiming[] | null {
    if (!Array.isArray(value) || !value.length) return null;
    const words: VoiceWordTiming[] = [];
    for (const raw of value) {
        const word = record(raw);
        if (!word || typeof word.text !== 'string' || !word.text.trim()
            || !finite(word.startMs) || !finite(word.endMs)
            || word.startMs < 0 || word.endMs <= word.startMs
            || (words.length > 0 && (word.startMs < words[words.length - 1].startMs
                || word.endMs < words[words.length - 1].endMs))) return null;
        words.push({ text: word.text, startMs: word.startMs, endMs: word.endMs });
    }
    return words;
}

/** Only measured native words or character boundaries; never estimate from text. */
export function normalizeVoiceTakeWords(value: unknown): VoiceWordTiming[] | null {
    const data = record(value);
    if (!data || data.timingStatus === 'none' || data.alignmentSource === 'none') return null;
    const nativeWords = validatedNativeWords(data.words);
    if (nativeWords) return nativeWords;
    // Empty or malformed native timing must not hide real character alignment.
    // Reject the native source as a whole; never combine its subset with another.

    const alignment = record(data.alignment);
    if (!alignment) return null;
    const characters = alignment.characters;
    const starts = alignment.starts ?? alignment.character_start_times_seconds;
    const ends = alignment.ends ?? alignment.character_end_times_seconds;
    if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends)
        || !characters.length || starts.length !== characters.length || ends.length !== characters.length) return null;
    const words: VoiceWordTiming[] = [];
    let text = '';
    let start = 0;
    let end = 0;
    const flush = () => {
        if (text) words.push({ text, startMs: start * 1000, endMs: end * 1000 });
        text = '';
    };
    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        if (typeof char !== 'string' || !char || !finite(starts[i]) || !finite(ends[i])
            || starts[i] < 0 || ends[i] < starts[i]
            || (i > 0 && (starts[i] < starts[i - 1] || ends[i] < ends[i - 1]))) return null;
        // A character entry must not hide an untimed word boundary.
        if (/\s/.test(char)) {
            if (char.trim()) return null;
            flush();
        } else {
            if (!text) start = starts[i];
            text += char;
            end = ends[i];
        }
    }
    flush();
    return validatedNativeWords(words);
}

/** Exact identity only: reselecting the same path preserves verified timing. */
export function selectVoiceTake(state: VoiceTakeTiming, path: string): VoiceTakeTiming {
    return { ...state, path, revision: state.revision + 1,
        timingPath: path === state.path ? state.timingPath : null,
        words: path === state.path ? state.words : null,
        status: path === state.path ? state.status : 'No word timing for this audio. Generate with timestamps or align it before using word-synced captions.',
    };
}

/** Invalidate prior requests synchronously, even before React renders. */
export function beginVoiceTakeChange(state: VoiceTakeTiming, status: string): VoiceTakeTiming {
    return { ...state, revision: state.revision + 1, timingPath: null, words: null, status };
}

export function completeVoiceTakeChange(
    state: VoiceTakeTiming, revision: number, path: string, data: unknown, status?: string,
): VoiceTakeTiming {
    if (state.revision !== revision) return state;
    const result = record(data);
    const identityMatches = (!result?.file || result.file === path)
        && (!result?.audioPath || result.audioPath === path);
    const words = path && identityMatches ? normalizeVoiceTakeWords(data) : null;
    return { path, revision: revision + 1, timingPath: words ? path : null, words,
        status: words ? 'Word timing is attached to this audio take.' : status || 'This take has no word timing. Align it before using word-synced captions.',
    };
}

export function wordsForVoiceTake(state: VoiceTakeTiming, path: string): VoiceWordTiming[] | undefined {
    return state.path === path && state.timingPath === path ? state.words ?? undefined : undefined;
}
