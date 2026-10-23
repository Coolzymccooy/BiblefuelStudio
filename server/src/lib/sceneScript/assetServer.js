import http from "http";
import fs from "fs";
import path from "path";

/**
 * A short-lived file server for one render: Chrome (inside Remotion) loads
 * clips, voices, music and fonts from it. It only serves the files it was
 * given, by name, on 127.0.0.1, with byte ranges (video seeking needs them)
 * and CORS (the composition page is on another local port).
 */

const TYPES = Object.freeze({
  ".mp4": "video/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
  ".ttf": "font/ttf", ".otf": "font/otf", ".jpg": "image/jpeg", ".png": "image/png",
});

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
}

function sendFile(req, res, file) {
  const size = fs.statSync(file).size;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Length": size });
  if (req.method === "HEAD") return res.end();
  return fs.createReadStream(file).pipe(res);
}

/**
 * @param {Record<string, string>} files public name -> absolute path
 * @returns {Promise<{ port: number, url: (name: string) => string, close: () => Promise<void> }>}
 */
export function startAssetServer(files) {
  const allowed = new Map(Object.entries(files));
  const server = http.createServer((req, res) => {
    cors(res);
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    let name;
    try { name = decodeURIComponent(new URL(req.url, "http://x").pathname.slice(1)); } catch { name = ""; }
    const file = allowed.get(name);
    if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    try { return sendFile(req, res, file); } catch { res.writeHead(500); return res.end(); }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        url: (n) => `http://127.0.0.1:${port}/${encodeURIComponent(n)}`,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}
