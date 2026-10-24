import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { OUTPUT_DIR } from "./paths.js";
import { existingStockFile, writeStockFile } from "./stockDownload.js";

// Test seam: the module's HTTP client (node-fetch), swappable so tests make no request.
let _fetch = fetch;
export function _setFetchForTest(impl) { _fetch = impl; }
export function _resetFetchForTest() { _fetch = fetch; }

export async function pexelsSearchVideos(query, perPage = 24) {
  const rawKey = (process.env.PEXELS_API_KEY || "");
  const key = rawKey.replace(/['"]/g, '').trim();
  if (!key) throw new Error("PEXELS_API_KEY missing");

  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=portrait`;

  // Diagnostic log (masked for security)
  console.log(`[PEXELS] Searching: ${url}`);
  console.log(`[PEXELS] Using Key: ${key.substring(0, 4)}... (Len: ${key.length})`);

  const resp = await _fetch(url, { headers: { Authorization: key } });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[PEXELS] API Failure ${resp.status}:`, errText);
    throw new Error(`Pexels API Error (${resp.status}): ${errText}`);
  }
  const data = await resp.json();
  const videos = (data.videos || []).map(v => ({
    id: v.id,
    duration: v.duration,
    url: v.url,
    image: v.image,
    // pick a medium portrait file if available for preview
    previewUrl: (v.video_files || []).find(f => f.width <= 480)?.link || (v.video_files?.[0]?.link),
    files: (v.video_files || []).map(f => ({ id: f.id, quality: f.quality, width: f.width, height: f.height, link: f.link, file_type: f.file_type }))
  }));
  return videos;
}

// The id names the output file (pexels-<id>.mp4) and the API path, so only a
// real (numeric) Pexels id may get that far: "../x" would write elsewhere.
const PEXELS_ID = /^\d+$/;

export async function pexelsDownloadVideoById(id) {
  if (!PEXELS_ID.test(String(id ?? ""))) throw new Error("Pexels video id must be a number");
  const rawKey = (process.env.PEXELS_API_KEY || "");
  const key = rawKey.replace(/['"]/g, '').trim();
  if (!key) throw new Error("PEXELS_API_KEY missing");

  // One global file per id, shared by every account: reuse it rather than
  // download over a file another render may be reading (#112).
  const outDir = OUTPUT_DIR;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `pexels-${id}.mp4`);
  const existing = existingStockFile(outFile);
  if (existing) return existing;

  const url = `https://api.pexels.com/videos/videos/${id}`;
  const resp = await _fetch(url, { headers: { Authorization: key } });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[PEXELS] Download API Failure ${resp.status}:`, errText);
    throw new Error(`Pexels download error (${resp.status}): ${errText}`);
  }
  const v = await resp.json();
  const files = v.video_files || [];
  // Choose portrait-ish highest width under 1080 if possible
  const sorted = files.sort((a, b) => (b.width || 0) - (a.width || 0));
  const pick = sorted.find(f => (f.width || 0) <= 1080) || sorted[0];
  if (!pick?.link) throw new Error("No downloadable link found");

  const dl = await _fetch(pick.link);
  if (!dl.ok) throw new Error(`Download failed: ${dl.status}`);
  return await writeStockFile(dl.body, outFile);
}
