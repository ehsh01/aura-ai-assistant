import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { logger } from "../lib/logger";

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
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
    500 * 1024 * 1024,
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
): Promise<{ data: Buffer; sha256: string }> {
  if (!response.ok) {
    throw new Error(`Evernote attachment download failed with HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Evernote attachment exceeds ${maxBytes} byte limit`);
  }
  if (!response.body) throw new Error("Evernote attachment response has no body");

  const chunks: Buffer[] = [];
  const hash = createHash("sha256");
  let total = 0;
  for await (const value of response.body as unknown as AsyncIterable<Uint8Array>) {
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(`Evernote attachment exceeds ${maxBytes} byte limit`);
    }
    hash.update(chunk);
    chunks.push(chunk);
  }
  return { data: Buffer.concat(chunks, total), sha256: hash.digest("hex") };
}

export async function extractPdfTextInMemory(data: Buffer): Promise<string> {
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
) => ChildProcessWithoutNullStreams;

export async function extractImageTextInMemory(
  data: Buffer,
  run: SpawnTesseract = (command, args) =>
    spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] }),
): Promise<string> {
  if (data.length < MIN_IMAGE_BYTES) return "";
  return serializedTesseract(
    () =>
      new Promise<string>((resolve) => {
        let child: ChildProcessWithoutNullStreams;
        try {
          // Reuse PR #9's host-wide flock while feeding bytes over stdin, so
          // Evernote never writes an attachment copy and all PM2 processes
          // still share a single Tesseract slot.
          child = run("flock", [
            "-x",
            "-F",
            "/tmp/recall-tesseract.lock",
            "tesseract",
            "stdin",
            "stdout",
          ]);
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
      }),
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
  input: { mime: string | null; fileName: string | null },
  deps?: {
    fetch?: typeof fetch;
    tesseract?: (data: Buffer) => Promise<string>;
  },
): Promise<EvernoteAttachmentExtraction> {
  // Download immediately: Evernote's signed URL expires after about 300s.
  const response = await (deps?.fetch ?? fetch)(downloadUrl);
  const { data, sha256 } = await responseBytesInMemory(response);
  const mime = (input.mime ?? "").toLowerCase();
  const name = (input.fileName ?? "").toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return {
      sha256,
      extractedText: await extractPdfTextInMemory(data),
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
