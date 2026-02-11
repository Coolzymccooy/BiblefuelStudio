import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";

export async function pexelsSearchVideos(query, perPage = 24) {
  const rawKey = (process.env.PEXELS_API_KEY || "");
  const key = rawKey.replace(/['"]/g, '').trim();
  if (!key) throw new Error("PEXELS_API_KEY missing");

  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=portrait`;

  // Diagnostic log (masked for security)
  console.log(`[PEXELS] Searching: ${url}`);
  console.log(`[PEXELS] Using Key: ${key.substring(0, 4)}... (Len: ${key.length})`);

  const resp = await fetch(url, { headers: { Authorization: key } });
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

export async function pexelsDownloadVideoById(id) {
  const rawKey = (process.env.PEXELS_API_KEY || "");
  const key = rawKey.replace(/['"]/g, '').trim();
  if (!key) throw new Error("PEXELS_API_KEY missing");

  const url = `https://api.pexels.com/videos/videos/${id}`;
  const resp = await fetch(url, { headers: { Authorization: key } });
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

  const outDir = process.env.OUTPUT_DIR || "./outputs";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `pexels-${id}.mp4`);

  const dl = await fetch(pick.link);
  if (!dl.ok) throw new Error(`Download failed: ${dl.status}`);
  await pipeline(dl.body, fs.createWriteStream(outFile));
  return outFile;
}
