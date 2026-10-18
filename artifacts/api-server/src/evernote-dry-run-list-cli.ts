import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  connectors,
  sourceRecords,
  syncRuns,
} from "@workspace/db/schema";

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

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  const queue: unknown[] = [value];
  const seen = new Set<object>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const row = current as Record<string, unknown>;
    output.push(row);
    queue.push(...Object.values(row));
  }
  return output;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function configuredBytes(
  name: string,
  fallback: number,
  maximum: number,
): number {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured)
    ? Math.min(maximum, Math.max(1, configured))
    : fallback;
}

function listedGuid(value: unknown): string | null {
  const row = record(value);
  return (
    text(row.id) ??
    text(row.guid) ??
    text(row.noteId) ??
    text(row.noteGuid)
  );
}

function listedTitle(value: unknown): string {
  return text(record(value).title) ?? "Untitled";
}

function noteDryRunMetadata(
  value: unknown,
  thresholds: { attachmentMaxBytes: number; pdfMaxBytes: number },
): {
  notebookGuid: string | null;
  title: string;
  visibleTags: string[];
  attachmentsOver20Mb: number;
  pdfsOver15Mb: number;
} {
  const graph = records(value);
  const root = record(value);
  const notebookGuid =
    text(root.notebookGuid) ??
    text(root.notebookId) ??
    graph.map((row) => text(row.notebookGuid ?? row.notebookId)).find(Boolean) ??
    null;
  const title =
    text(root.title) ??
    graph.map((row) => text(row.title)).find(Boolean) ??
    "Untitled";
  const tags = new Set<string>();
  const attachments = new Map<string, Record<string, unknown>>();
  for (const row of graph) {
    for (const key of ["tagNames", "tags"]) {
      if (!Array.isArray(row[key])) continue;
      for (const candidate of row[key]) {
        const tag =
          text(candidate) ??
          text(record(candidate).name) ??
          text(record(candidate).label);
        if (
          tag &&
          !tag.toLowerCase().startsWith("notebook:") &&
          !/^year:\d{4}$/i.test(tag)
        ) {
          tags.add(tag);
        }
      }
    }
    for (const key of ["attachments", "resources"]) {
      if (!Array.isArray(row[key])) continue;
      for (const candidate of row[key]) {
        const attachment = record(candidate);
        const id =
          text(attachment.id) ??
          text(attachment.guid) ??
          text(attachment.resourceId);
        if (id) attachments.set(id, attachment);
      }
    }
  }
  let attachmentsOver20Mb = 0;
  let pdfsOver15Mb = 0;
  for (const attachment of attachments.values()) {
    const size = numberValue(attachment.sizeBytes ?? attachment.size) ?? 0;
    const mime = text(attachment.mime ?? attachment.mimeType)?.toLowerCase();
    const name = text(attachment.name ?? attachment.fileName)?.toLowerCase();
    if (size > thresholds.attachmentMaxBytes) attachmentsOver20Mb += 1;
    if (
      size > thresholds.pdfMaxBytes &&
      (mime === "application/pdf" || name?.endsWith(".pdf"))
    ) {
      pdfsOver15Mb += 1;
    }
  }
  return {
    notebookGuid,
    title,
    visibleTags: [...tags],
    attachmentsOver20Mb,
    pdfsOver15Mb,
  };
}

loadDotEnv();

const { getDb, closeDb } = await import("./lib/db.js");
const { openConnectorSettings, sealConnectorSettings } = await import(
  "./lib/secret-box.js"
);
const {
  callEvernoteReadTool,
  discoverEvernoteNotebooks,
  fetchEvernoteNoteListingPage,
  fetchEvernoteNoteListingPageWithRetry,
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
  const selectedConnectorId = rows[0]!.id;
  const fullDiscovery =
    hasFlag("--full-discovery") || !process.argv.includes("--notebook-guid");
  const persistTokenRefresh = hasFlag("--persist-token-refresh");
  const printNotebookShape = hasFlag("--print-notebook-shape");
  const attachmentMaxBytes = configuredBytes(
    "EVERNOTE_ATTACHMENT_MAX_BYTES",
    20 * 1024 * 1024,
    50 * 1024 * 1024,
  );
  const pdfMaxBytes = configuredBytes(
    "EVERNOTE_PDF_PARSE_MAX_BYTES",
    15 * 1024 * 1024,
    15 * 1024 * 1024,
  );
  if (!persistTokenRefresh) {
    throw new Error(
      "Pass --persist-token-refresh before connecting so any rotated OAuth state is saved exactly as it is in the worker.",
    );
  }
  const existingRows = await getDb()
    .select({
      externalId: sourceRecords.externalId,
      title: sourceRecords.recordTitle,
      notebookGuid: sql<string | null>`${sourceRecords.recordMetadata}->>'notebookGuid'`,
      notebookName: sql<string | null>`${sourceRecords.recordMetadata}->>'notebookName'`,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.connectorId, selectedConnectorId),
        eq(sourceRecords.recordType, "evernote_note"),
      ),
    );
  const sourceRecordCountBefore = existingRows.length;
  const existingIds = new Set(existingRows.map((row) => row.externalId));
  const recentRuns = await getDb()
    .select({
      id: syncRuns.id,
      recordsFailed: syncRuns.recordsFailed,
      errorMessage: syncRuns.errorMessage,
      metadata: syncRuns.metadata,
      startedAt: syncRuns.startedAt,
    })
    .from(syncRuns)
    .where(eq(syncRuns.connectorId, selectedConnectorId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(25);
  const priorFailedRun = recentRuns.find((run) => {
    const checkpoint = record(run.metadata?.evernoteCheckpoint);
    return (
      run.recordsFailed > 0 &&
      checkpoint.version !== 2 &&
      (numberValue(checkpoint.startIndex) ?? 0) > 0
    );
  });
  let tokenWrites = 0;
  const persistMcpState = async (next: Record<string, unknown>) => {
    await getDb()
      .update(connectors)
      .set({
        settings: sealConnectorSettings({ ...settings, ...next }),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, selectedConnectorId));
    tokenWrites += 1;
  };

  const result = await withEvernoteMcpClient(
    settings,
    async (client) => {
      if (!fullDiscovery) {
        const notebookGuid = requiredArgument("--notebook-guid");
        const notebookName =
          process.argv.includes("--notebook-name")
            ? requiredArgument("--notebook-name")
            : notebookGuid;
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
          let listed = 0;
          while (startIndex < range.expectedTotal) {
            const page = await fetchEvernoteNoteListingPageWithRetry(
              client,
              {
                query: evernoteNotebookRangeQuery(scope, range),
                maxResults: 100,
                startIndex,
                sortBy: "created",
                ascending: true,
              },
              { phase: "dry-run", notebookGuid },
            );
            if (page.rows.length === 0) {
              throw new Error(
                `Dry-run range ended early at ${startIndex} of ${range.expectedTotal}`,
              );
            }
            listed += page.rows.length;
            startIndex += page.rows.length;
          }
          totalRows += listed;
          output.push({
            query: evernoteNotebookRangeQuery(scope, range),
            expected: range.expectedTotal,
            rows: listed,
            from: range.from,
            before: range.before,
          });
        }
        return {
          mode: "single-notebook" as const,
          notebookGuid,
          notebookName,
          ranges: output,
          totalRows,
          rowsBeyondFirst2000: Math.max(0, totalRows - 2_000),
        };
      }

      const cachedNotebookNames = new Map<string, string>();
      for (const row of existingRows) {
        if (row.notebookGuid && row.notebookName) {
          cachedNotebookNames.set(row.notebookGuid, row.notebookName);
        }
      }
      const notebookDiscovery = await discoverEvernoteNotebooks(
        client,
        [...cachedNotebookNames].map(([id, name]) => ({
          id,
          name,
          parentId: null,
          stack: null,
          spaceId: null,
          access: null,
          metadata: { dryRunCache: true },
        })),
      );
      if (!notebookDiscovery.totalWasReported) {
        throw new Error(
          `Evernote notebook discovery did not report a total; refusing full dry-run after ${notebookDiscovery.notebooks.length} notebooks`,
        );
      }
      const resolvedByGuid = new Map(
        notebookDiscovery.notebooks.map((notebook) => [
          notebook.id,
          notebook.name,
        ]),
      );
      const globalPage = await fetchEvernoteNoteListingPageWithRetry(
        client,
        { query: "", maxResults: 1, startIndex: 0 },
        { phase: "dry-run-global-count" },
      );
      if (globalPage.totalResultCount == null) {
        throw new Error("Evernote global note listing did not report a total");
      }
      const globalTotal = globalPage.totalResultCount;
      const listedByGuid = new Map<
        string,
        { title: string; notebookGuid: string | null; notebookName: string }
      >();
      const notebookTable: Array<{
        name: string;
        guid: string;
        expected: number;
        listed: number;
        diff: number;
        alreadyInRecall: number;
        new: number;
      }> = [];
      const splitTable: Array<{
        notebook: string;
        guid: string;
        field: string;
        from: string;
        before: string;
        expected: number;
        listed: number;
      }> = [];

      const enumerateScope = async (scope: {
        notebookGuid: string | null;
        notebookName: string;
      }) => {
        const ranges = await planEvernoteNotebookRanges(client, scope);
        let notebookListed = 0;
        let notebookExpected = 0;
        let notebookAlready = 0;
        let notebookNew = 0;
        const notebookIds = new Set<string>();
        for (const range of ranges) {
          if (range.expectedTotal >= 2_000) {
            throw new Error(
              `Unsafe dry-run range for ${scope.notebookName}: ${range.expectedTotal} rows`,
            );
          }
          notebookExpected += range.expectedTotal;
          let startIndex = 0;
          let rangeListed = 0;
          while (startIndex < range.expectedTotal) {
            const page = await fetchEvernoteNoteListingPageWithRetry(
              client,
              {
                query: evernoteNotebookRangeQuery(scope, range),
                maxResults: 100,
                startIndex,
                sortBy: "created",
                ascending: true,
              },
              {
                phase: "dry-run-full-listing",
                notebookGuid: scope.notebookGuid,
              },
            );
            if (page.rows.length === 0) {
              throw new Error(
                `Dry-run listing ended early for ${scope.notebookName} at ${startIndex} of ${range.expectedTotal}`,
              );
            }
            for (const item of page.rows) {
              const guid = listedGuid(item);
              if (!guid) {
                throw new Error(
                  `Dry-run listing returned a note without a GUID in ${scope.notebookName}`,
                );
              }
              notebookIds.add(guid);
              listedByGuid.set(guid, {
                title: listedTitle(item),
                notebookGuid: scope.notebookGuid,
                notebookName: scope.notebookName,
              });
            }
            rangeListed += page.rows.length;
            startIndex += page.rows.length;
          }
          if (rangeListed !== range.expectedTotal) {
            throw new Error(
              `Dry-run range mismatch for ${scope.notebookName}: expected ${range.expectedTotal}, listed ${rangeListed}`,
            );
          }
          splitTable.push({
            notebook: scope.notebookName,
            guid: scope.notebookGuid
              ? `${scope.notebookGuid.slice(0, 8)}…${scope.notebookGuid.slice(-4)}`
              : "(none)",
            field: range.field,
            from: range.from ?? "*",
            before: range.before ?? "*",
            expected: range.expectedTotal,
            listed: rangeListed,
          });
        }
        notebookListed = notebookIds.size;
        for (const guid of notebookIds) {
          if (existingIds.has(guid)) notebookAlready += 1;
          else notebookNew += 1;
        }
        const diff = notebookExpected - notebookListed;
        notebookTable.push({
          name: scope.notebookName,
          guid: scope.notebookGuid
            ? `${scope.notebookGuid.slice(0, 8)}…${scope.notebookGuid.slice(-4)}`
            : "(none)",
          expected: notebookExpected,
          listed: notebookListed,
          diff,
          alreadyInRecall: notebookAlready,
          new: notebookNew,
        });
        if (diff !== 0) {
          throw new Error(
            `Dry-run notebook mismatch for ${scope.notebookName}: expected ${notebookExpected}, listed ${notebookListed}`,
          );
        }
        return notebookExpected;
      };

      let expectedAcrossNotebooks = 0;
      for (const notebook of notebookDiscovery.notebooks) {
        expectedAcrossNotebooks += await enumerateScope({
          notebookGuid: notebook.id,
          notebookName: notebook.name,
        });
      }
      if (expectedAcrossNotebooks < globalTotal) {
        expectedAcrossNotebooks += await enumerateScope({
          notebookGuid: null,
          notebookName: "No notebook",
        });
      }
      if (expectedAcrossNotebooks !== globalTotal) {
        throw new Error(
          `Evernote notebook totals do not match global total: ${expectedAcrossNotebooks} vs ${globalTotal}`,
        );
      }
      if (listedByGuid.size !== globalTotal) {
        throw new Error(
          `Evernote unique GUID total does not match global total: ${listedByGuid.size} vs ${globalTotal}`,
        );
      }

      const guidNamedNotebookIds = new Set(
        existingRows
          .filter(
            (row) =>
              row.notebookGuid &&
              (!row.notebookName || row.notebookName === row.notebookGuid) &&
              resolvedByGuid.get(row.notebookGuid) &&
              resolvedByGuid.get(row.notebookGuid) !== row.notebookGuid,
          )
          .map((row) => row.notebookGuid!),
      );
      const unresolvedNotebookIds = new Set(
        notebookDiscovery.notebooks
          .filter((notebook) => notebook.name === notebook.id)
          .map((notebook) => notebook.id),
      );
      for (const row of existingRows) {
        if (row.notebookGuid && !resolvedByGuid.has(row.notebookGuid)) {
          unresolvedNotebookIds.add(row.notebookGuid);
        }
      }
      if (unresolvedNotebookIds.size > 0) {
        throw new Error(
          `Evernote notebook names remain unresolved after discovery: ${unresolvedNotebookIds.size}`,
        );
      }

      const checkpoint = record(priorFailedRun?.metadata?.evernoteCheckpoint);
      const legacyPrefixEnd = Math.min(
        globalTotal,
        2_000,
        Math.max(0, Math.floor(numberValue(checkpoint.startIndex) ?? 0)),
      );
      const priorPrefixMissing: Array<{ guid: string; title: string }> = [];
      for (let startIndex = 0; startIndex < legacyPrefixEnd; ) {
        const page = await fetchEvernoteNoteListingPageWithRetry(
          client,
          {
            query: "",
            maxResults: Math.min(100, legacyPrefixEnd - startIndex),
            startIndex,
            sortBy: "updated",
            ascending: false,
          },
          { phase: "dry-run-legacy-failure-scan" },
        );
        if (page.rows.length === 0) {
          throw new Error(
            `Dry-run legacy failure scan ended at ${startIndex} of ${legacyPrefixEnd}`,
          );
        }
        for (const item of page.rows) {
          const guid = listedGuid(item);
          if (guid && !existingIds.has(guid)) {
            priorPrefixMissing.push({ guid, title: listedTitle(item) });
          }
        }
        startIndex += page.rows.length;
      }
      const storedFailedNotes = Array.isArray(
        priorFailedRun?.metadata?.evernoteFailedNotes,
      )
        ? priorFailedRun.metadata.evernoteFailedNotes
            .map((value) => record(value))
            .map((value) => ({
              guid: text(value.guid),
              title: text(value.title) ?? "Untitled",
              error: text(value.error),
            }))
            .filter(
              (
                value,
              ): value is {
                guid: string;
                title: string;
                error: string | null;
              } => Boolean(value.guid),
            )
        : [];
      const storedFailed = storedFailedNotes[0] ?? null;
      const failedNote = storedFailed
        ? { guid: storedFailed.guid, title: storedFailed.title }
        : (priorPrefixMissing[0] ?? null);
      const errors = Array.isArray(priorFailedRun?.metadata?.errors)
        ? priorFailedRun.metadata.errors.filter(
            (error): error is string => typeof error === "string",
          )
        : [];
      const previousFailureReason =
        storedFailed?.error ??
        errors.find((error) => !/listing ended early/i.test(error)) ??
        priorFailedRun?.errorMessage ??
        "Previous note fetch failed; no per-note reason was stored";

      const newGuids = [...listedByGuid.keys()].filter(
        (guid) => !existingIds.has(guid),
      );
      const newGuidSet = new Set(newGuids);
      const sampleExtraGuids: string[] = [];
      const sampleNotebookCandidates = new Set(
        newGuids.map(
          (guid) => listedByGuid.get(guid)?.notebookGuid ?? "(none)",
        ),
      );
      for (const [guid, listed] of listedByGuid) {
        if (sampleNotebookCandidates.size >= 5) break;
        const notebookKey = listed.notebookGuid ?? "(none)";
        if (
          existingIds.has(guid) &&
          !sampleNotebookCandidates.has(notebookKey)
        ) {
          sampleNotebookCandidates.add(notebookKey);
          sampleExtraGuids.push(guid);
        }
      }
      const orderedFetchGuids = [
        ...(failedNote && newGuids.includes(failedNote.guid)
          ? [failedNote.guid]
          : []),
        ...newGuids.filter((guid) => guid !== failedNote?.guid),
        ...sampleExtraGuids,
      ];
      let attachmentsOver20Mb = 0;
      let pdfsOver15Mb = 0;
      const metadataSamples: Array<{
        title: string;
        guid: string;
        notebook: string;
        visibleTags: number;
      }> = [];
      const sampledNotebooks = new Set<string>();
      for (const guid of orderedFetchGuids) {
        const note = await callEvernoteReadTool(client, "get_note", {
          noteId: guid,
        });
        const metadata = noteDryRunMetadata(note, {
          attachmentMaxBytes,
          pdfMaxBytes,
        });
        if (newGuidSet.has(guid)) {
          attachmentsOver20Mb += metadata.attachmentsOver20Mb;
          pdfsOver15Mb += metadata.pdfsOver15Mb;
        }
        const listed = listedByGuid.get(guid)!;
        const notebookGuid = metadata.notebookGuid ?? listed.notebookGuid;
        const resolvedName =
          (notebookGuid ? resolvedByGuid.get(notebookGuid) : null) ??
          listed.notebookName;
        if (
          metadataSamples.length < 5 &&
          !sampledNotebooks.has(notebookGuid ?? "(none)")
        ) {
          sampledNotebooks.add(notebookGuid ?? "(none)");
          metadataSamples.push({
            title: metadata.title,
            guid: `${guid.slice(0, 8)}…${guid.slice(-4)}`,
            notebook: resolvedName,
            visibleTags: metadata.visibleTags.length,
          });
        }
      }
      const distinctListedNotebooks = new Set(
        [...listedByGuid.values()].map(
          (listed) => listed.notebookGuid ?? "(none)",
        ),
      ).size;
      const requiredMetadataSamples = Math.min(5, distinctListedNotebooks);
      if (metadataSamples.length < requiredMetadataSamples) {
        throw new Error(
          `Dry-run get_note sample covered only ${metadataSamples.length} distinct notebooks; expected ${requiredMetadataSamples}`,
        );
      }

      return {
        mode: "full-discovery" as const,
        notebookDiscovery,
        globalTotal,
        expectedAcrossNotebooks,
        uniqueListed: listedByGuid.size,
        alreadyInRecall: [...listedByGuid.keys()].filter((guid) =>
          existingIds.has(guid),
        ).length,
        toFetch: newGuids.length,
        notebookTable,
        splitTable,
        nameBackfill: {
          wouldRenameGuidNamedNotebooks: guidNamedNotebookIds.size,
          unresolved: unresolvedNotebookIds.size,
          samples: notebookDiscovery.notebooks.slice(0, 10).map((notebook) => ({
            guid: `${notebook.id.slice(0, 8)}…${notebook.id.slice(-4)}`,
            name: notebook.name,
          })),
        },
        previousFailedNote: failedNote
          ? {
              ...failedNote,
              guid: `${failedNote.guid.slice(0, 8)}…${failedNote.guid.slice(-4)}`,
              reason: previousFailureReason,
              metadataFetched: orderedFetchGuids.includes(failedNote.guid),
            }
          : null,
        metadataSamples,
        skipCounts: {
          attachmentMaxBytes,
          pdfMaxBytes,
          attachmentsOverLimit: attachmentsOver20Mb,
          pdfsOverParseLimit: pdfsOver15Mb,
        },
      };
    },
    persistMcpState,
  );

  const sourceRecordCountAfter = (
    await getDb()
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.connectorId, selectedConnectorId),
          eq(sourceRecords.recordType, "evernote_note"),
        ),
      )
  )[0]?.count ?? 0;
  if (sourceRecordCountAfter !== sourceRecordCountBefore) {
    throw new Error(
      `Dry-run changed source_records: ${sourceRecordCountBefore} before, ${sourceRecordCountAfter} after`,
    );
  }
  if (result.value.mode === "full-discovery") {
    console.log(
      `Discovery: ${result.value.notebookDiscovery.notebooks.length}/${result.value.notebookDiscovery.totalResultCount} notebooks across ${result.value.notebookDiscovery.pages} query partitions`,
    );
    if (printNotebookShape) {
      console.log("Sanitized search_notebooks response shapes:");
      console.dir(result.value.notebookDiscovery.pageShapes, { depth: null });
    }
    console.log("Notebook names (dry-run backfill samples):");
    console.table(result.value.nameBackfill.samples);
    console.log(
      `GUID-named notebooks that would be renamed: ${result.value.nameBackfill.wouldRenameGuidNamedNotebooks}; unresolved: ${result.value.nameBackfill.unresolved}`,
    );
    console.log("Date ranges used:");
    console.table(result.value.splitTable);
    console.log("Per-notebook completeness:");
    console.table(result.value.notebookTable);
    console.log("Read-only get_note samples (different notebooks):");
    console.table(result.value.metadataSamples);
    console.log(
      `Totals: Evernote=${result.value.globalTotal}, expected=${result.value.expectedAcrossNotebooks}, unique listed=${result.value.uniqueListed}, already in Recall=${result.value.alreadyInRecall}, to fetch=${result.value.toFetch}`,
    );
    console.log(
      `Attachment skips from notes to fetch: over ${Math.round(result.value.skipCounts.attachmentMaxBytes / 1024 / 1024)} MB=${result.value.skipCounts.attachmentsOverLimit}, PDFs over ${Math.round(result.value.skipCounts.pdfMaxBytes / 1024 / 1024)} MB=${result.value.skipCounts.pdfsOverParseLimit}`,
    );
    console.log("Previous failed note retry:");
    console.dir(result.value.previousFailedNote, { depth: null });
  } else {
    console.log(JSON.stringify(result.value, null, 2));
  }
  console.log(
    `DB write guard: source_records before=${sourceRecordCountBefore}, after=${sourceRecordCountAfter}; OAuth token-state writes=${tokenWrites}`,
  );
} finally {
  await closeDb();
}
