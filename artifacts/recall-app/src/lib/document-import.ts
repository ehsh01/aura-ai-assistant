/** Helpers for client-side document / CSV import into Documents. */

const TEXT_EXT = /\.(txt|md|csv|json|log|tsv)$/i;
const TEXT_MIME = /^(text\/|application\/json|application\/csv)/;

export function isReadableTextFile(file: File): boolean {
  return TEXT_MIME.test(file.type) || TEXT_EXT.test(file.name);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export type CsvPreview = {
  headers: string[];
  rowCount: number;
  sampleRows: string[][];
  /** Flattened text suitable for search / AI summary. */
  searchableText: string;
};

/**
 * Lightweight CSV parse (handles quoted fields with commas).
 * Not a full RFC 4180 parser — good enough for typical exports.
 */
export function parseCsvPreview(raw: string, maxSample = 5): CsvPreview {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { headers: [], rowCount: 0, sampleRows: [], searchableText: "" };
  }

  const rows = lines.map(splitCsvLine);
  const headers = rows[0] ?? [];
  const data = rows.slice(1);
  const sampleRows = data.slice(0, maxSample);

  const searchableText = [
    `CSV columns: ${headers.join(", ")}`,
    `Rows: ${data.length}`,
    "",
    ...data.slice(0, 200).map((row) =>
      headers.map((h, i) => `${h}: ${row[i] ?? ""}`).join(" | "),
    ),
    data.length > 200 ? `\n…and ${data.length - 200} more rows` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    headers,
    rowCount: data.length,
    sampleRows,
    searchableText: searchableText.slice(0, 200_000),
  };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export async function readImportFile(file: File): Promise<{
  fileName: string;
  text: string;
  csv: CsvPreview | null;
  binaryOnly: boolean;
}> {
  const fileName = file.name;
  if (!isReadableTextFile(file)) {
    return { fileName, text: "", csv: null, binaryOnly: true };
  }
  const raw = (await file.text()).slice(0, 200_000);
  const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
  if (isCsv) {
    const csv = parseCsvPreview(raw);
    return { fileName, text: csv.searchableText, csv, binaryOnly: false };
  }
  return { fileName, text: raw, csv: null, binaryOnly: false };
}
