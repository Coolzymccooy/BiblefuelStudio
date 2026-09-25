/**
 * What an audio file picker offers.
 *
 * "audio/*" alone gives iOS no file types to match the Files app against, so
 * a song downloaded to Files, a voice memo (.m4a) or a GarageBand bounce
 * (.caf/.aiff) may not be pickable. Listing the extensions lets the phone
 * match them. The server takes all of these, including a file that arrives
 * with no type at all, and converts the less common ones to MP3.
 */
export const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.wav', '.aif', '.aiff', '.caf', '.flac', '.ogg'] as const;

/** For DropZone / useFileDrop, which take a list. */
export const AUDIO_ACCEPT_LIST: string[] = ['audio/*', ...AUDIO_EXTENSIONS];

/** For an <input type="file" accept>. */
export const AUDIO_ACCEPT = AUDIO_ACCEPT_LIST.join(',');
