import fs from "fs";
import path from "path";

function getStorePath() {
  const dir = path.resolve(process.env.DATA_DIR || "./data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "social.json");
}

export function readSocialStore() {
  try {
    const file = getStorePath();
    if (!fs.existsSync(file)) {
      return { buffer: { accessToken: "", profileIds: [] }, webhooks: [], direct: { youtube: {}, instagram: {}, tiktok: {} } };
    }
    const raw = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(raw);
    return {
      buffer: {
        accessToken: data?.buffer?.accessToken || "",
        profileIds: Array.isArray(data?.buffer?.profileIds) ? data.buffer.profileIds : [],
      },
      webhooks: Array.isArray(data?.webhooks) ? data.webhooks : [],
      direct: {
        youtube: data?.direct?.youtube || {},
        instagram: data?.direct?.instagram || {},
        tiktok: data?.direct?.tiktok || {},
      },
    };
  } catch {
    return { buffer: { accessToken: "", profileIds: [] }, webhooks: [], direct: { youtube: {}, instagram: {}, tiktok: {} } };
  }
}

export function writeSocialStore(next) {
  const file = getStorePath();
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
}
