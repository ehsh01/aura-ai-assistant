/**
 * PM2 — Recall API on DigitalOcean
 *
 * Default port 5008 (does not conflict with other apps on this droplet).
 * From repo root:
 *   pm2 start artifacts/api-server/ecosystem.config.cjs
 *   pm2 save
 */

const fs = require("fs");
const path = require("path");

/** @param {string} filePath */
function loadDotEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  let text = fs.readFileSync(filePath, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let key = trimmed.slice(0, eq).trim();
    if (key.startsWith("export ")) key = key.slice(7).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const envPath = path.join(__dirname, ".env");
const fileEnv = loadDotEnv(envPath);
const { PORT: _drop, ...fileEnvNoPort } = fileEnv;

module.exports = {
  apps: [
    {
      name: "recall-api",
      script: "dist/index.mjs",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1024M",
      env: {
        ...fileEnvNoPort,
        NODE_ENV: "production",
        HOST: fileEnv.HOST || "127.0.0.1",
        PORT: fileEnv.API_PORT || fileEnv.API_PORT_PROD || "5008",
      },
    },
  ],
};
