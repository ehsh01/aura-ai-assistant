import { createHash } from "node:crypto";
import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { logger } from "../lib/logger";
import { isEvernoteNightWindow } from "./evernote-runtime-policy";
import {
  assertEvernoteImportSafe,
  evernoteDeferredError,
  requiredMemoryMbForBytes,
} from "./evernote-watchdog";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const HARD_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_PDF_PARSE_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_TESSERACT_TIMEOUT_MS = 30_000;
const MIN_IMAGE_BYTES = 20 * 1024;
const MAX_TEXT_CHARS = 500_000;

let tesseractQueue: Promise<void> = Promise.resolve();
let missingTesseractLogged = false;

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function evernoteAttachmentMaxBytes(): number {
  return envNumber(
    "EVERNOTE_ATTACHMENT_MAX_BYTES",
    DEFAULT_MAX_BYTES,
    1,
    HARD_MAX_BYTES,
  );
}

export function evernotePdfParseMaxBytes(): number {
  return envNumber(
    "EVERNOTE_PDF_PARSE_MAX_BYTES",
    DEFAULT_PDF_PARSE_MAX_BYTES,
    1,
    DEFAULT_PDF_PARSE_MAX_BYTES,
  );
}

export function evernoteTesseractTimeoutMs(): number {
  return envNumber(
    "EVERNOTE_TESSERACT_TIMEOUT_MS",
    DEFAULT_TESSERACT_TIMEOUT_MS,
    1_000,
    120_000,
  );
}

function cleanText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .slice(0, MAX_TEXT_CHARS)
    .trim();
}

function serializedTesseract<T>(work: () => Promise<T>): Promise<T> {
  const run = tesseractQueue.then(work, work);
  tesseractQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function responseBytesInMemory(
  response: Response,
  maxBytes = evernoteAttachmentMaxBytes(),
  _expectedSizeBytes?: number | null,
): Promise<{ data: Buffer; sha256: string }> {
  if (!response.ok) {
    throw new Error(`Evernote attachment download failed with HTTP ${response.status}`);
  }
  const header = response.headers.get("content-length");
  const declared = header == null ? null : Number(header);
  if (declared != null && Number.isFinite(declared) && declared > maxBytes) {
    throw new EvernoteAttachmentTooLargeError(declared, maxBytes);
  }
  if (!response.body) throw new Error("Evernote attachment response has no body");

  const expected =
    declared != null && Number.isFinite(declared) && declared >= 0
      ? declared
      : maxBytes;
  // One allocation only. Unknown-length responses reserve the bounded maximum
  // so returning a contiguous Buffer never requires Buffer.concat.
  const data = Buffer.allocUnsafe(Math.max(1, expected));
  const hash = createHash("sha256");
  let total = 0;
  for await (const value of response.body as unknown as AsyncIterable<Uint8Array>) {
    const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    const nextTotal = total + chunk.length;
    if (nextTotal > maxBytes || nextTotal > data.length) {
      throw new EvernoteAttachmentTooLargeError(nextTotal, maxBytes);
    }
    hash.update(chunk);
    chunk.copy(data, total);
    total = nextTotal;
  }
  return { data: data.subarray(0, total), sha256: hash.digest("hex") };
}

export class EvernoteAttachmentTooLargeError extends Error {
  constructor(
    public readonly sizeBytes: number,
    public readonly maxBytes: number,
  ) {
    super(`Evernote attachment exceeds ${maxBytes} byte limit`);
    this.name = "EvernoteAttachmentTooLargeError";
  }
}

type LoadCheck = (sizeBytes: number) => Promise<void>;

async function defaultLoadCheck(sizeBytes: number): Promise<void> {
  await assertEvernoteImportSafe({
    minimumMemoryMb: requiredMemoryMbForBytes(sizeBytes),
    requireMemoryMeasurement: true,
  });
}

export async function extractPdfTextInMemory(
  data: Buffer,
  loadCheck: LoadCheck = defaultLoadCheck,
): Promise<string> {
  if (data.length > evernotePdfParseMaxBytes()) return "";
  await loadCheck(data.length);
  const module = await import("pdf-parse");
  const parser =
    (module as { default?: (input: Buffer) => Promise<{ text?: string }> }).default ??
    module;
  const result = await (
    parser as unknown as (input: Buffer) => Promise<{ text?: string }>
  )(data);
  return cleanText(result.text ?? "");
}

type SpawnTesseract = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio & {
    stdio: ["pipe", "pipe", "pipe"];
  },
) => ChildProcessWithoutNullStreams;

export async function extractImageTextInMemory(
  data: Buffer,
  run: SpawnTesseract = (command, args, options) =>
    spawn(command, args, options),
  options?: { now?: Date; loadCheck?: LoadCheck },
): Promise<string> {
  if (data.length < MIN_IMAGE_BYTES) return "";
  if (!isEvernoteNightWindow(options?.now)) {
    throw evernoteDeferredError(
      "image OCR is outside the Evernote night window",
      60 * 60_000,
    );
  }
  return serializedTesseract(
    async () => {
      await (options?.loadCheck ?? defaultLoadCheck)(data.length);
      return new Promise<string>((resolve) => {
        let child: ChildProcessWithoutNullStreams;
        try {
          // Reuse PR #9's host-wide flock while feeding bytes over stdin, so
          // Evernote never writes an attachment copy and all PM2 processes
          // still share a single Tesseract slot.
          child = run(
            "nice",
            [
              "-n",
              "19",
              "flock",
              "-x",
              "-F",
              "/tmp/recall-tesseract.lock",
              "tesseract",
              "stdin",
              "stdout",
            ],
            {
              stdio: ["pipe", "pipe", "pipe"],
              env: { ...process.env, OMP_THREAD_LIMIT: "1" },
            },
          );
        } catch (error) {
          logger.warn({ error }, "Could not start Tesseract");
          resolve("");
          return;
        }
        const stdout: Buffer[] = [];
        let stdoutBytes = 0;
        let stderr = "";
        let settled = false;
        const finish = (text: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(cleanText(text));
        };
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          finish("");
        }, evernoteTesseractTimeoutMs());
        timeout.unref?.();
        child.stdout.on("data", (chunk: Buffer) => {
          if (stdoutBytes >= 2 * 1024 * 1024) return;
          const bounded = Buffer.from(chunk).subarray(
            0,
            2 * 1024 * 1024 - stdoutBytes,
          );
          stdoutBytes += bounded.length;
          stdout.push(bounded);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = `${stderr}${String(chunk)}`.slice(-2_000);
        });
        child.on("error", (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT" && !missingTesseractLogged) {
            missingTesseractLogged = true;
            logger.warn(
              "flock/tesseract is unavailable; Evernote image OCR is disabled",
            );
          }
          finish("");
        });
        child.on("close", (code) => {
          if (code !== 0) {
            logger.warn({ code, stderr }, "Tesseract could not read Evernote attachment");
            finish("");
            return;
          }
          finish(Buffer.concat(stdout, stdoutBytes).toString("utf8"));
        });
        child.stdin.on("error", () => undefined);
        child.stdin.end(data);
      });
    },
  );
}

export type EvernoteAttachmentExtraction = {
  sha256: string;
  extractedText: string;
  textEngine: "pdf-parse" | "tesseract" | null;
  sizeBytes: number;
};

export async function fetchAndExtractEvernoteAttachment(
  downloadUrl: string,
  input: { mime: string | null; fileName: string | null; sizeBytes?: number | null },
  deps?: {
    fetch?: typeof fetch;
    tesseract?: (data: Buffer) => Promise<string>;
    loadCheck?: LoadCheck;
  },
): Promise<EvernoteAttachmentExtraction> {
  // Download immediately: Evernote's signed URL expires after about 300s.
  const maxBytes = evernoteAttachmentMaxBytes();
  if (input.sizeBytes != null && input.sizeBytes > maxBytes) {
    throw new EvernoteAttachmentTooLargeError(input.sizeBytes, maxBytes);
  }
  await (deps?.loadCheck ?? defaultLoadCheck)(input.sizeBytes ?? maxBytes);
  const response = await (deps?.fetch ?? fetch)(downloadUrl);
  const header = Number(response.headers.get("content-length"));
  if (Number.isFinite(header) && header > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new EvernoteAttachmentTooLargeError(header, maxBytes);
  }
  await (deps?.loadCheck ?? defaultLoadCheck)(
    Number.isFinite(header) && header > 0
      ? header
      : input.sizeBytes ?? maxBytes,
  );
  const { data, sha256 } = await responseBytesInMemory(
    response,
    maxBytes,
    input.sizeBytes,
  );
  const mime = (input.mime ?? "").toLowerCase();
  const name = (input.fileName ?? "").toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    if (data.length > evernotePdfParseMaxBytes()) {
      return { sha256, extractedText: "", textEngine: null, sizeBytes: data.length };
    }
    return {
      sha256,
      extractedText: await extractPdfTextInMemory(
        data,
        deps?.loadCheck ?? defaultLoadCheck,
      ),
      textEngine: "pdf-parse",
      sizeBytes: data.length,
    };
  }
  if (mime.startsWith("image/") || /\.(?:jpe?g|png|gif|webp|bmp|tiff?|heic)$/i.test(name)) {
    if (data.length < MIN_IMAGE_BYTES) {
      return { sha256, extractedText: "", textEngine: null, sizeBytes: data.length };
    }
    return {
      sha256,
      extractedText: await (deps?.tesseract ?? extractImageTextInMemory)(data),
      textEngine: "tesseract",
      sizeBytes: data.length,
    };
  }
  return { sha256, extractedText: "", textEngine: null, sizeBytes: data.length };
}
