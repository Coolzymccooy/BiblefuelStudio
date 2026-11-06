import { describe, expect, it } from 'vitest';
import {
    beginVoiceTakeChange, completeVoiceTakeChange, emptyVoiceTakeTiming,
    normalizeVoiceTakeWords, selectVoiceTake, wordsForVoiceTake,
} from '../voiceTakeTiming';

const words = [{ text: 'Hello', startMs: 120, endMs: 510 }];
const generated = () => completeVoiceTakeChange(emptyVoiceTakeTiming, 0, 'take-a.mp3', { words });

describe('audio-identity-bound word timing', () => {
    it('lands measured words only on the exact current take', () => {
        const state = generated();
        expect(wordsForVoiceTake(state, 'take-a.mp3')).toEqual(words);
        expect(wordsForVoiceTake(state, 'take-b.mp3')).toBeUndefined();
        expect(wordsForVoiceTake(state, './take-a.mp3')).toBeUndefined();
    });
    it('retains timing for explicit reselection of the same unchanged source', () => {
        const state = selectVoiceTake(generated(), 'take-a.mp3');
        expect(wordsForVoiceTake(state, state.path)).toEqual(words);
    });
    it.each(['uploaded.wav', 'history.mp3', 'manual-path.wav', ''])('clears timing when switching to %s', (path) => {
        const state = selectVoiceTake(generated(), path);
        expect(state.words).toBeNull();
        expect(wordsForVoiceTake(state, path)).toBeUndefined();
        expect(selectVoiceTake(state, 'take-a.mp3').words).toBeNull();
    });
    it.each(['processed.mp3', 'trimmed.mp3', 'silence-removed.mp3', 'take-a.mp3'])(
        'does not carry source offsets through processing, including reused output paths: %s', (path) => {
            const pending = beginVoiceTakeChange(generated(), 'Processing');
            expect(pending.words).toBeNull();
            const state = completeVoiceTakeChange(pending, pending.revision, path, null, 'Align processed output');
            expect(wordsForVoiceTake(state, path)).toBeUndefined();
            expect(state.status).toBe('Align processed output');
        },
    );
    it('ignores stale success and failure after switching audio, including A → B → A', () => {
        const pending = beginVoiceTakeChange(generated(), 'Generating');
        const switched = selectVoiceTake(selectVoiceTake(pending, 'take-b.mp3'), 'take-a.mp3');
        expect(completeVoiceTakeChange(switched, pending.revision, 'old-response.mp3', { words })).toBe(switched);
        expect(completeVoiceTakeChange(switched, pending.revision, switched.path, null, 'Failed')).toBe(switched);
    });
    it('allows only the newest asynchronous operation to complete', () => {
        const first = beginVoiceTakeChange(generated(), 'Generating');
        const second = beginVoiceTakeChange(first, 'Uploading');
        expect(completeVoiceTakeChange(second, first.revision, 'tts.mp3', { words })).toBe(second);
        const uploaded = completeVoiceTakeChange(second, second.revision, 'upload.wav', null);
        expect(uploaded.path).toBe('upload.wav');
        expect(uploaded.words).toBeNull();
    });
    it('clears prior timing on failed generation and replaces it on successful regeneration', () => {
        const pending = beginVoiceTakeChange(generated(), 'Generating');
        expect(pending.words).toBeNull();
        const failed = completeVoiceTakeChange(pending, pending.revision, pending.path, null, 'Generation failed');
        expect(failed.words).toBeNull();
        const retry = beginVoiceTakeChange(failed, 'Generating');
        const success = completeVoiceTakeChange(retry, retry.revision, 'new.mp3', { words });
        expect(wordsForVoiceTake(success, 'new.mp3')).toEqual(words);
    });
    it('rejects contradictory response audio identities', () => {
        for (const data of [{ file: 'other.mp3', words }, { audioPath: 'other.mp3', words }]) {
            expect(completeVoiceTakeChange(emptyVoiceTakeTiming, 0, 'take.mp3', data).words).toBeNull();
        }
    });
});

describe('native/character timestamp normalization without invented offsets', () => {
    const alignment = { characters: ['H', 'i', ' ', '世', '界', '!'],
        starts: [0.12, 0.2, 0.3, 0.4, 0.5, 0.6], ends: [0.2, 0.3, 0.4, 0.5, 0.6, 0.65] };
    it('keeps native millisecond timing unchanged', () => {
        expect(normalizeVoiceTakeWords({ words })).toEqual(words);
    });
    it('groups measured character boundaries including Unicode and punctuation', () => {
        expect(normalizeVoiceTakeWords({ alignment })).toEqual([
            { text: 'Hi', startMs: 120, endMs: 300 }, { text: '世界!', startMs: 400, endMs: 650 },
        ]);
        expect(normalizeVoiceTakeWords({ alignment: { characters: alignment.characters,
            character_start_times_seconds: alignment.starts, character_end_times_seconds: alignment.ends } }))
            .toEqual(normalizeVoiceTakeWords({ alignment }));
    });
    it('valid native words retain priority over conflicting character alignment', () => {
        expect(normalizeVoiceTakeWords({ words, alignment })).toEqual(words);
    });
    it.each([
        [], null, 'malformed',
        [{ text: 'bad', startMs: 10, endMs: 5 }],
        [...words, { text: 'bad', startMs: NaN, endMs: 900 }],
    ].map((native) => [native]))('recovers validated character timing when native timing is unusable (%j)', (native) => {
        const data = { words: native, alignment, alignmentSource: 'elevenlabs', timingStatus: 'native' };
        const snapshot = JSON.stringify(data);
        const recovered = normalizeVoiceTakeWords(data);
        expect(recovered).toEqual(normalizeVoiceTakeWords({ alignment }));
        expect(recovered?.map((w) => w.text)).toEqual(['Hi', '世界!']);
        expect(JSON.stringify(data)).toBe(snapshot); // Do not rewrite provider provenance.
        const state = completeVoiceTakeChange(emptyVoiceTakeTiming, 0, 'take.mp3', { ...data, file: 'take.mp3' });
        expect(wordsForVoiceTake(state, 'take.mp3')).toEqual(recovered);
        expect(wordsForVoiceTake(state, 'other.mp3')).toBeUndefined();
        expect(completeVoiceTakeChange(emptyVoiceTakeTiming, 0, 'wrong.mp3', { ...data, file: 'take.mp3' }).words).toBeNull();
    });
    it('rejects broken character timing after rejecting native timing, without returning a subset', () => {
        expect(normalizeVoiceTakeWords({ words: [], alignment: { ...alignment, ends: [0.2] } })).toBeNull();
        expect(normalizeVoiceTakeWords({ words: [{ text: 'bad', startMs: 9, endMs: 8 }],
            alignment: { characters: ['bad'], starts: [0], ends: [0] } })).toBeNull();
    });
    it('honors explicit missing timing and never invents timing from scripts', () => {
        for (const data of [null, {}, { text: 'Hello' }, { words: [] }, { words: null },
            { words, timingStatus: 'none' }, { words, alignmentSource: 'none' },
            { words: [], alignment, timingStatus: 'none' }, { words: [], alignment, alignmentSource: 'none' }]) {
            expect(normalizeVoiceTakeWords(data)).toBeNull();
        }
    });
    it.each([
        [{ text: 'bad', startMs: -1, endMs: 10 }],
        [{ text: 'bad', startMs: 10, endMs: 10 }],
        [{ text: 'bad', startMs: 0, endMs: Infinity }],
        [{ text: 'bad', startMs: '0', endMs: 10 }],
        [...words, { text: 'backwards', startMs: 50, endMs: 100 }],
    ])('rejects an invalid native array in full (%j)', (...invalid) => {
        expect(normalizeVoiceTakeWords({ words: invalid })).toBeNull();
    });
    it('accepts measured overlap with nondecreasing starts and ends', () => {
        const overlapping = [...words, { text: 'world', startMs: 500, endMs: 800 }];
        expect(normalizeVoiceTakeWords({ words: overlapping })).toEqual(overlapping);
    });
    it('rejects incomplete/malformed/backwards character timing rather than returning subsets', () => {
        for (const invalid of [
            { ...alignment, ends: [0.2] },
            { characters: ['hello world'], starts: [0], ends: [1] },
            { characters: ['a', 'b'], starts: [0.2, 0.1], ends: [0.3, 0.4] },
            { characters: ['a'], starts: [0], ends: [0] },
        ]) expect(normalizeVoiceTakeWords({ alignment: invalid })).toBeNull();
    });
});
