import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const LIBRARY_FILE = path.join(DATA_DIR, "library.json");

function ensure() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(LIBRARY_FILE)) {
        fs.writeFileSync(LIBRARY_FILE, JSON.stringify({ items: [] }, null, 2));
    }
}

export function readLibrary() {
    ensure();
    try {
        return JSON.parse(fs.readFileSync(LIBRARY_FILE, "utf-8"));
    } catch (e) {
        return { items: [] };
    }
}

export function writeLibrary(data) {
    ensure();
    fs.writeFileSync(LIBRARY_FILE, JSON.stringify(data, null, 2));
}

export function addToLibrary(item) {
    const lib = readLibrary();
    const exists = lib.items.find(x => x.id === item.id);
    if (exists) return exists;

    lib.items.unshift({
        ...item,
        savedAt: new Date().toISOString()
    });
    writeLibrary(lib);
    return item;
}

export function removeFromLibrary(id) {
    const lib = readLibrary();
    lib.items = lib.items.filter(x => x.id !== id);
    writeLibrary(lib);
}
