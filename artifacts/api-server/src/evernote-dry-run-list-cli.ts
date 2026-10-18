import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq } from "drizzle-orm";
import { connectors } from "@workspace/db/schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv(): void {
  const envPath = path.join(__dirname, "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function connectorIdArgument(): string | null {
  const index = process.argv.indexOf("--connector-id");
  if (index < 0) return null;
  const value = process.argv[index + 1]?.trim();
  if (!value) {
    throw new Error("--connector-id requires a value");
  }
  return value;
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : "";
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

loadDotEnv();

const { getDb, closeDb } = await import("./lib/db.js");
const { openConnectorSettings } = await import("./lib/secret-box.js");
const {
  fetchEvernoteNoteListingPage,
  evernoteNotebookRangeQuery,
  planEvernoteNotebookRanges,
  withEvernoteMcpClient,
} = await import("./connectors/evernote-mcp.js");

try {
  const connectorId = connectorIdArgument();
  const rows = await getDb()
    .select({
      id: connectors.id,
      settings: connectors.settings,
    })
    .from(connectors)
    .where(
      connectorId
        ? and(
            eq(connectors.id, connectorId),
            eq(connectors.type, "evernote"),
          )
        : and(
            eq(connectors.type, "evernote"),
            eq(connectors.enabled, true),
          ),
    )
    .orderBy(desc(connectors.updatedAt))
    .limit(connectorId ? 1 : 2);
  if (rows.length === 0) {
    throw new Error("No matching Evernote connector was found");
  }
  if (!connectorId && rows.length > 1) {
    throw new Error(
      "Multiple enabled Evernote connectors found; pass --connector-id <id>",
    );
  }
  const settings = openConnectorSettings(
    (rows[0]!.settings ?? {}) as Record<string, unknown>,
  );
  if (settings.authTransport !== "mcp") {
    throw new Error("The selected Evernote connector does not use MCP");
  }
  const notebookGuid = requiredArgument("--notebook-guid");
  const notebookName =
    process.argv.includes("--notebook-name")
      ? requiredArgument("--notebook-name")
      : notebookGuid;

  // Deliberately omit the persistence callback: OAuth refresh can occur in
  // memory for this connection, but the dry-run never stores tokens or DB state.
  const result = await withEvernoteMcpClient(settings, async (client) => {
    const scope = { notebookGuid, notebookName };
    const ranges = await planEvernoteNotebookRanges(client, scope);
    const output: Array<{
      query: string;
      expected: number;
      rows: number;
      from: string | null;
      before: string | null;
    }> = [];
    let totalRows = 0;
    for (const range of ranges) {
      let startIndex = 0;
      let rows = 0;
      while (startIndex < range.expectedTotal) {
        const page = await fetchEvernoteNoteListingPage(client, {
          query: evernoteNotebookRangeQuery(scope, range),
          maxResults: 100,
          startIndex,
        });
        if (page.rows.length === 0) {
          throw new Error(
            `Dry-run range ended early at ${startIndex} of ${range.expectedTotal}`,
          );
        }
        rows += page.rows.length;
        startIndex += page.rows.length;
      }
      totalRows += rows;
      output.push({
        query: evernoteNotebookRangeQuery(scope, range),
        expected: range.expectedTotal,
        rows,
        from: range.from,
        before: range.before,
      });
    }
    return {
      notebookGuid,
      notebookName,
      ranges: output,
      totalRows,
      rowsBeyondFirst2000: Math.max(0, totalRows - 2_000),
    };
  });
  console.log(
    JSON.stringify(result.value, null, 2),
  );
} finally {
  await closeDb();
}
