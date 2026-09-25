/**
 * Map our internal aspect names to concrete pixel dimensions for providers
 * that take width/height. Kept modest so hosted queues return reasonably
 * fast; the ffmpeg scene graph scales/crops the last few pixels.
 *
 * @param {string} [aspect]  "portrait" (default) | "landscape" | "16:9" | "square" | "1:1"
 * @returns {{ width: number, height: number }}
 */
export function toDimensions(aspect) {
  const a = String(aspect || "").toLowerCase();
  if (a === "landscape" || a === "16:9") return { width: 1344, height: 768 };
  if (a === "square" || a === "1:1") return { width: 1024, height: 1024 };
  return { width: 768, height: 1344 }; // portrait (≈9:16) — the Story default
}
