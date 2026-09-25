// Local dev stack under pm2 so it outlives any single terminal / Claude
// session — for testing from a phone while away from the laptop.
//
//   pm2 start ecosystem.dev.config.cjs          # api + client + ngrok tunnel
//   pm2 logs biblefuel-ngrok --nostream         # find the public URL (or :4040)
//   pm2 stop ecosystem.dev.config.cjs
//
// This file contains ONLY BibleFuel apps. Chatterbox is started separately
// from tiwa/persona-overseer's laptop-bridge ecosystem with
// `--only chatterbox-server` (never the bare ecosystem — that starts the
// MT5 sidecar too).
//
// The API reloads on source changes (pm2 watch scoped to source, matching
// server/package.json "dev"), and Vite serves the client with HMR, so code
// changes land on the tunnel without a rebuild.
const path = require("path");

const root = __dirname;
const server = path.join(root, "server");
const client = path.join(root, "client");

module.exports = {
  apps: [
    {
      name: "biblefuel-api",
      script: "index.js",
      cwd: server,
      interpreter: "node",
      // pm2's fork wrapper is incompatible with node --watch (it restart-loops
      // on its own container script), so source reloads use pm2's watcher,
      // scoped to source the same way server/package.json "dev" is.
      watch: ["index.js", "src", "services"],
      ignore_watch: ["**/*.test.js", "**/node_modules/**"],
      watch_delay: 1500,
      windowsHide: true,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      env: {
        NODE_ENV: "development",
        PORT: "5051",
        CORS_ORIGIN: "http://localhost:5174",
      },
    },
    {
      name: "biblefuel-client",
      script: path.join(client, "node_modules", "vite", "bin", "vite.js"),
      args: "--host",
      cwd: client,
      interpreter: "node",
      windowsHide: true,
      watch: false,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      env: { VITE_EXPOSE: "1" },
    },
    {
      // Public HTTPS tunnel to the Vite dev server; Vite proxies /api and
      // /outputs to the API, so one tunnel covers everything. Requires an
      // ngrok authtoken in %LOCALAPPDATA%\ngrok\ngrok.yml.
      name: "biblefuel-ngrok",
      script: path.join(process.env.APPDATA || "", "npm", "node_modules", "ngrok", "bin", "ngrok.exe"),
      args: "http 5174 --log stdout --log-format logfmt",
      interpreter: "none",
      windowsHide: true,
      watch: false,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
    },
  ],
};
