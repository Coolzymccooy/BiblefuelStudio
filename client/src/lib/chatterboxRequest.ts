/**
 * The body of POST /api/tts/chatterbox.
 *
 * The server takes a Chatterbox voice only as a saved clone (`cb:<id>`, from
 * the caller's own store) or empty for the bridge's default voice. The owner
 * alone may instead name a reference file on the bridge host (ruling R36);
 * the server reports that as `freeTextReference` on the voices list.
 */
const CLONE_ID = /^cb:[\w-]+$/;

export interface ChatterboxPayloadInput {
    text: string;
    /** The saved clone picked in the form, or '' for none. */
    cloneId: string;
    /** The free-text reference path typed in the form (owner only). */
    referencePath: string;
    /** May this account send a free-text reference path? */
    canUseReferencePath: boolean;
    style?: number;
    cfg?: number;
}

export interface ChatterboxPayload {
    text: string;
    voiceId?: string;
    exaggeration?: number;
    cfgWeight?: number;
}

function pickVoiceId({ cloneId, referencePath, canUseReferencePath }: ChatterboxPayloadInput): string | undefined {
    const clone = cloneId.trim();
    if (CLONE_ID.test(clone)) return clone;
    const typed = referencePath.trim();
    return canUseReferencePath && typed ? typed : undefined;
}

export function buildChatterboxPayload(input: ChatterboxPayloadInput): ChatterboxPayload {
    const voiceId = pickVoiceId(input);
    return {
        text: input.text,
        ...(voiceId ? { voiceId } : {}),
        ...(typeof input.style === 'number' ? { exaggeration: input.style } : {}),
        ...(typeof input.cfg === 'number' ? { cfgWeight: input.cfg } : {}),
    };
}
