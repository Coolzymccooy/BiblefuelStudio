// Build the scene-script Remotion composition once, at image build time, so a
// render never runs webpack on the production server (no swap there). Prints
// the bundle folder; the Dockerfile points REMOTION_SERVE_URL at it.
import path from "path";
import { fileURLToPath } from "url";
import { bundle } from "@remotion/bundler";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2] || path.join(here, "..", "remotion-bundle"));
const serveUrl = await bundle({ entryPoint: path.join(here, "..", "remotion", "src", "index.ts"), outDir });
console.log(serveUrl);
