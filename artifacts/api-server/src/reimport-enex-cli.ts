import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv(): void {
  const envPath = path.join(__dirname, "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const userId = process.argv[2];
const filePath = process.argv[3];
const fileName = process.argv[4] ?? path.basename(filePath ?? "import.enex");

if (!userId || !filePath) {
  console.error(
    "Usage: node dist/reimport-enex-cli.mjs <userId> <filePath> [fileName]",
  );
  process.exit(1);
}

const { importEnexFileForUser } = await import("./services/enex-import-runner.js");
const result = await importEnexFileForUser(userId, filePath, fileName);
console.log(
  JSON.stringify(
    {
      parsed: result.parsed,
      imported: result.imported,
      skipped: result.skipped,
      notebook: result.notebook.name,
      noteCount: result.notebook.noteCount,
      errors: result.errors.slice(0, 10),
    },
    null,
    2,
  ),
);
