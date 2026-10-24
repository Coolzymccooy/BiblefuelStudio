import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { OUTPUT_DIR } from "./paths.js";
import { existingStockFile, writeStockFile } from "./stockDownload.js";

// Test seam: the module's HTTP client (node-fetch), swappable so tests make no request.
let _fetch = fetch;
export function _setFetchForTest(impl) { _fetch = impl; }
export function _resetFetchForTest() { _fetch = fetch; }

export async function pixabaySearchVideos(query, perPage = 24) {
  const rawKey = (process.env.PIXABAY_API_KEY || "");
  const key = rawKey.replace(/['"]/g, '').trim();
  if (!key) throw new Error("PIXABAY_API_KEY missing");

  const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&per_page=${perPage}`;
  const resp = await _fetch(url);
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Pixabay API Error (${resp.status}): ${errText}`);
  }
  const data = await resp.json();
  const videos = (data.hits || []).map(v => {
    const files = v.videos || {};
    const sizes = ["large", "medium", "small", "tiny"];
    const pickPreview = sizes.map(s => files[s]).find(Boolean);
    return {
      id: v.id,
      duration: v.duration,
      url: v.pageURL,
      image: v.userImageURL || v.picture_id ? `https://i.vimeocdn.com/video/${v.picture_id}_640x360.jpg` : undefined,
      previewUrl: pickPreview?.url,
      files: sizes.map(s => files[s]).filter(Boolean).map(f => ({
        quality: s,
        width: f.width,
        height: f.height,
        link: f.url,
        file_type: "video/mp4"
      }))
    };
  });
  return videos;
}

// The id names the output file (pixabay-<id>.mp4) and goes into the API query,
// so only a real (numeric) Pixabay id may get that far: "123/../.." would
// write elsewhere (#112, same rule as PEXELS_ID).
const PIXABAY_ID = /^\d+$/;

export async function pixabayDownloadVideoById(id) {
  if (!PIXABAY_ID.test(String(id ?? ""))) throw new Error("Pixabay video id must be a number");
  const rawKey = (process.env.PIXABAY_API_KEY || "");
  const key = rawKey.replace(/['"]/g, '').trim();
  if (!key) throw new Error("PIXABAY_API_KEY missing");

  // One global file per id, shared by every account: reuse it rather than
  // download over a file another render may be reading (#112).
  const outDir = OUTPUT_DIR;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `pixabay-${id}.mp4`);
  const existing = existingStockFile(outFile);
  if (existing) return existing;

  const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&id=${encodeURIComponent(id)}`;
  const resp = await _fetch(url);
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Pixabay download error (${resp.status}): ${errText}`);
  }
  const data = await resp.json();
  const hit = (data.hits || [])[0];
  if (!hit || !hit.videos) throw new Error("No video found");
  const files = hit.videos;
  const pick = files.large || files.medium || files.small || files.tiny;
  if (!pick?.url) throw new Error("No downloadable link found");

  const dl = await _fetch(pick.url);
  if (!dl.ok) throw new Error(`Download failed: ${dl.status}`);
  return await writeStockFile(dl.body, outFile);
}
