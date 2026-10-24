import crypto from "crypto";

/**
 * Constant-time secret comparison. Both sides are coerced to strings and
 * hashed to fixed-size SHA-256 digests first: timingSafeEqual throws on a
 * length mismatch, and equal-length digests keep the comparison constant time
 * whatever the lengths of the inputs.
 */
export function sameSecret(a, b) {
  const da = crypto.createHash("sha256").update(String(a)).digest();
  const db = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(da, db);
}
