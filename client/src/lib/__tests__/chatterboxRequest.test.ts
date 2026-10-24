import { describe, expect, it } from 'vitest';
import { buildChatterboxPayload } from '../chatterboxRequest';

const base = { text: 'Grace and peace', style: 0.5, cfg: 0.4 };

describe('buildChatterboxPayload', () => {
    it('sends the selected saved clone as voiceId', () => {
        const body = buildChatterboxPayload({ ...base, cloneId: 'cb:1234-abcd', referencePath: '', canUseReferencePath: false });
        expect(body).toEqual({ text: 'Grace and peace', voiceId: 'cb:1234-abcd', exaggeration: 0.5, cfgWeight: 0.4 });
    });

    it('a saved clone wins over a typed reference path', () => {
        const body = buildChatterboxPayload({ ...base, cloneId: 'cb:1', referencePath: 'C:/voices/a.wav', canUseReferencePath: true });
        expect(body.voiceId).toBe('cb:1');
    });

    it('sends the typed reference path only when the account may use one', () => {
        expect(buildChatterboxPayload({ ...base, cloneId: '', referencePath: ' C:/voices/a.wav ', canUseReferencePath: true }).voiceId)
            .toBe('C:/voices/a.wav');
        expect(buildChatterboxPayload({ ...base, cloneId: '', referencePath: 'C:/voices/a.wav', canUseReferencePath: false }).voiceId)
            .toBeUndefined();
    });

    it('ignores a clone value that is not a cb: id', () => {
        expect(buildChatterboxPayload({ ...base, cloneId: '/etc/passwd', referencePath: '', canUseReferencePath: false }).voiceId)
            .toBeUndefined();
    });

    it('leaves the voice out for the default voice and drops non-numeric settings', () => {
        const body = buildChatterboxPayload({ text: 'Hi there', cloneId: '', referencePath: '', canUseReferencePath: true, style: undefined, cfg: undefined });
        expect(body).toEqual({ text: 'Hi there' });
        expect('voiceId' in body).toBe(false);
    });
});
