/**
 * Build a safe filename for a `Content-Disposition: attachment` header.
 *
 * Used by the /outputs download path (?dl=<name>). The value lands inside a
 * quoted HTTP header, so we must strip anything that could break out of the
 * quotes or inject a new header (CR/LF, double-quote, backslash) and anything
 * that smells like a path (slashes). Everything else outside a conservative
 * filename charset is replaced with `_`, and the result is length-capped.
 *
 * @param {unknown} dlParam   the raw ?dl= query value (preferred name)
 * @param {unknown} pathName  fallback source (e.g. the request path) when dlParam is empty
 * @returns {string} a non-empty, header-safe single filename segment
 */
export function safeDownloadName(dlParam, pathName) {
  const raw = String(dlParam || "").trim();
  const fallback = String(pathName || "").split("/").pop() || "download";
  const base = (raw || fallback)
    .replace(/[\r\n"\\/]/g, "")          // header-injection + path separators
    .replace(/[^A-Za-z0-9._-]/g, "_")    // conservative filename charset
    .replace(/^\.+/, "")                  // no leading dots (".." / hidden)
    .slice(0, 128);
  return base || "download";
}
