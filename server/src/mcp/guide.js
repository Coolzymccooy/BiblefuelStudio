import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * docs/mcp.md is one file in two parts (#121). The agent part comes first and is the MCP resource
 * biblefuel://guide: first calls, the job handle, pipelines, costs, errors and troubleshooting. A
 * marker line ends it; the human setup after it (keys, client config, the tool table, resources,
 * prompts) is biblefuel://guide/setup. The Help page renders the whole file and strips the marker
 * (an HTML comment line). Both parts are served with LF line endings, whatever the
 * checkout uses.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUIDE_FILE = path.resolve(__dirname, "../../../docs/mcp.md");
const MIME = "text/markdown";

export const GUIDE_URI = "biblefuel://guide";
export const SETUP_URI = "biblefuel://guide/setup";
export const GUIDE_MARKER = "<!-- biblefuel://guide ends here. Everything below is biblefuel://guide/setup. -->";
export const SETUP_TITLE = "# Connect an agent to BibleFuel: setup and reference";

const MISSING = "# Connect an agent to BibleFuel\n\nThe guide is not available on this server.\n";
const NO_SETUP = "The setup part is not available on this server.\n";

/**
 * The agent part and the setup part of the guide's markdown, both with LF line endings. Without
 * the marker the whole file is the agent part.
 *
 * @param {string} markdown
 * @returns {{ agent: string, setup: string }}
 */
export function guideParts(markdown) {
  const text = String(markdown ?? "").replace(/\r\n?/g, "\n");
  const at = text.indexOf(GUIDE_MARKER);
  if (at < 0) return { agent: text, setup: `${SETUP_TITLE}\n\n${NO_SETUP}` };
  const rest = text.slice(at + GUIDE_MARKER.length).trimStart();
  return { agent: `${text.slice(0, at).trimEnd()}\n`, setup: `${SETUP_TITLE}\n\n${rest}` };
}

/** Both parts read from docs/mcp.md now; a file that cannot be read is a short notice, logged. */
function readParts() {
  try {
    return guideParts(fs.readFileSync(GUIDE_FILE, "utf-8"));
  } catch (err) {
    console.warn("[MCP] guide not readable:", err?.message || String(err));
    return { agent: MISSING, setup: `${SETUP_TITLE}\n\n${NO_SETUP}` };
  }
}

const markdown = (uri, text) => ({ contents: [{ uri: uri.href, mimeType: MIME, text }] });

/** Registers biblefuel://guide and biblefuel://guide/setup on one McpServer. */
export function registerGuideResources(server) {
  server.registerResource(
    "guide",
    GUIDE_URI,
    {
      title: "Connect an agent to BibleFuel",
      description: "How to use the BibleFuel tools: first calls, job handles, pipelines, costs and troubleshooting. Read it first.",
      mimeType: MIME,
    },
    async (uri) => markdown(uri, readParts().agent),
  );
  server.registerResource(
    "guide-setup",
    SETUP_URI,
    {
      title: "BibleFuel agent setup and reference",
      description: "For the person setting an agent up: keys, client config, the full tool table, getting media in, resources and prompts.",
      mimeType: MIME,
    },
    async (uri) => markdown(uri, readParts().setup),
  );
}
