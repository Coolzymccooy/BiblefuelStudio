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
