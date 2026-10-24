/**
 * Input options for running ffmpeg/ffprobe on a video file whose bytes a
 * user chose.
 *
 * The bytes decide the format, not the file name, and some formats (an HLS
 * playlist, a concat list) make ffmpeg open other files or URLs: another
 * account's file, or a server-side request to anywhere. Holding the demuxer
 * to MP4/MOV and Matroska/WebM, and the protocol to local files, rules that
 * out. Both are input options on ffmpeg 5.1 (prod) as well. Put the guard
 * right before the `-i` it protects.
 */
export const VIDEO_INPUT_FORMATS = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm";
export const VIDEO_INPUT_GUARD = Object.freeze([
  "-format_whitelist", VIDEO_INPUT_FORMATS, "-protocol_whitelist", "file",
]);

/**
 * For every other media input (voice, music, stills, clips handed to the
 * render routes): local files only. Inputs are localised before ffmpeg runs,
 * so this is defence in depth: a value that still names a URL, or a file
 * whose bytes point at one, cannot make ffmpeg/ffprobe open a network
 * protocol (#104). An input option; nested opens (concat lists, playlists)
 * inherit it.
 */
export const LOCAL_PROTOCOL_GUARD = Object.freeze(["-protocol_whitelist", "file,pipe"]);

/** `-protocol_whitelist file,pipe -i <file>`, to spread into ffmpeg args. */
export function localInput(file) {
  return [...LOCAL_PROTOCOL_GUARD, "-i", file];
}
