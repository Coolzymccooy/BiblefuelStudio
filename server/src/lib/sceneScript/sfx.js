/**
 * Synthesized sound design, so there are no sample files to license:
 * a soft heartbeat for reflective openings and a low cinematic impact for
 * the line after a music drop. Both are ffmpeg argument lists.
 */

/** Lub-dub every 1.15 s: two decaying 52 Hz thumps, the second softer. */
export function heartbeatArgs(out, durationSec) {
  const beat = "mod(t,1.15)";
  const heart = `sin(2*PI*52*t)*(exp(-22*${beat})*lt(${beat},0.3)+0.65*exp(-22*(${beat}-0.3))*gte(${beat},0.3)*lt(${beat},0.6))`;
  const d = Math.max(1, Math.ceil(Number(durationSec) || 30));
  return ["-y", "-v", "error", "-f", "lavfi", "-i", `aevalsrc='${heart}':s=48000:d=${d}`,
    "-af", "lowpass=f=140,volume=0.9,aformat=channel_layouts=stereo", out];
}

/** A falling sub sweep plus a burst of dark noise with a long tail. */
export function impactArgs(out) {
  const sub = "sin(2*PI*(70*t-12*t*t))*exp(-1.6*t)";
  return ["-y", "-v", "error",
    "-f", "lavfi", "-i", `aevalsrc='${sub}':s=48000:d=4`,
    "-f", "lavfi", "-i", "anoisesrc=color=brown:amplitude=0.6:d=4:r=48000",
    "-filter_complex", "[1:a]lowpass=f=400,afade=t=out:st=0:d=2.5[n];[0:a][n]amix=inputs=2:weights=1 0.5:normalize=0,"
      + "aecho=0.8:0.5:120|260:0.3|0.2,alimiter=limit=0.9,aformat=channel_layouts=stereo[o]",
    "-map", "[o]", out];
}

/** Cut a bed from offset for the section's length, looping a short bed, at a common loudness. */
export function bedSectionArgs(bedFile, out, { offsetSec = 0, durationSec }) {
  return ["-y", "-v", "error", "-stream_loop", "-1", "-ss", String(Math.max(0, offsetSec)), "-i", bedFile,
    "-t", String(Math.max(0.5, durationSec).toFixed(3)),
    "-af", "loudnorm=I=-20:TP=-2:LRA=11", "-ar", "48000", "-ac", "2", out];
}
