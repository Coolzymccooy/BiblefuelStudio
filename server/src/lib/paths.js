import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, "../..");

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(SERVER_ROOT, "data"));
export const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(SERVER_ROOT, "outputs"));

