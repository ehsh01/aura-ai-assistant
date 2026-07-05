import { getStoredToken } from "@/lib/auth-storage";
import { ApiError } from "@workspace/api-client-react";

/** Stay under Cloudflare's ~100MB proxy upload limit per request. */
const CHUNK_SIZE = 48 * 1024 * 1024;
const SINGLE_UPLOAD_MAX = 90 * 1024 * 1024;

export type EnexUploadResult = {
  parsed: number;
  imported: number;
  updated?: number;
  skipped: number;
  notebook: {
    id: string;
    name: string;
    source: string;
    noteCount: number;
    date: string;
  };
  notes: Array<{
    id: string;
    title: string;
    content: string;
    preview: string;
    tags: string[];
    date: string;
    pinned: boolean;
    notebookId?: string | null;
  }>;
  errors: string[];
};

async function authHeaders(): Promise<HeadersInit> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseUploadResponse(res: Response): Promise<EnexUploadResult | ImportJobPending> {
  const raw = await res.text();
  let data: unknown = null;

  if (raw.trim()) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as { message: unknown }).message)
        : typeof data === "string"
          ? data.slice(0, 300)
          : `HTTP ${res.status}`;
    throw new ApiError(res, data, { method: "POST", url: res.url || "/api/notes/import" });
  }

  if (!data || typeof data !== "object") {
    throw new Error(
      typeof data === "string" && data.trim()
        ? data.slice(0, 300)
        : "Server returned an empty response during import",
    );
  }

  if ("status" in data && (data as { status: string }).status === "processing" && "jobId" in data) {
    return data as ImportJobPending;
  }

  return data as EnexUploadResult;
}

type ImportJobPending = {
  jobId: string;
  status: "processing";
  message?: string;
};

async function pollImportJob(
  jobId: string,
  onProgress?: (percent: number) => void,
): Promise<EnexUploadResult> {
  const started = Date.now();
  const maxWaitMs = 2 * 60 * 60 * 1000; // 2 hours
  let notFoundRetries = 0;

  while (Date.now() - started < maxWaitMs) {
    const res = await fetch(`/api/notes/import/enex/status/${encodeURIComponent(jobId)}`, {
      headers: await authHeaders(),
    });

    const raw = await res.text();
    let data: Record<string, unknown> | null = null;
    if (raw.trim()) {
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new Error(raw.slice(0, 300) || `HTTP ${res.status}`);
      }
    }

    if (res.status === 404) {
      notFoundRetries += 1;
      if (notFoundRetries <= 20) {
        onProgress?.(99);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw new Error(
        "Import status unavailable — refresh Notebooks; your notes may already be there.",
      );
    }

    if (!res.ok) {
      const message =
        data && typeof data.message === "string"
          ? data.message
          : `Import failed (HTTP ${res.status})`;
      throw new Error(message);
    }

    notFoundRetries = 0;

    if (data?.status === "processing") {
      onProgress?.(99);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    if (data?.status === "complete") {
      onProgress?.(100);
      return data as unknown as EnexUploadResult;
    }

    throw new Error("Unexpected import status response");
  }

  throw new Error("Import timed out — check Notebooks in a few minutes; large files may still be processing");
}

async function resolveImportResponse(
  res: Response,
  onProgress?: (percent: number) => void,
): Promise<EnexUploadResult> {
  const parsed = await parseUploadResponse(res);
  if ("jobId" in parsed && parsed.status === "processing") {
    return pollImportJob(parsed.jobId, onProgress);
  }
  if ("parsed" in parsed) {
    return parsed;
  }
  throw new Error("Unexpected import response");
}

async function uploadSingleFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<EnexUploadResult> {
  onProgress?.(0);
  const form = new FormData();
  form.append("file", file, file.name);

  const res = await fetch("/api/notes/import/enex-file", {
    method: "POST",
    headers: await authHeaders(),
    body: form,
  });

  onProgress?.(100);
  return resolveImportResponse(res, onProgress);
}

async function uploadChunkedFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<EnexUploadResult> {
  const uploadId = crypto.randomUUID();
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let result: EnexUploadResult | null = null;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const blob = file.slice(start, end);

    const form = new FormData();
    form.append("chunk", blob, `${file.name}.part${i}`);
    form.append("uploadId", uploadId);
    form.append("chunkIndex", String(i));
    form.append("totalChunks", String(totalChunks));
    form.append("fileName", file.name);

    const res = await fetch("/api/notes/import/enex/chunk", {
      method: "POST",
      headers: await authHeaders(),
      body: form,
    });

    onProgress?.(Math.round(((i + 1) / totalChunks) * 100));

    if (i === totalChunks - 1) {
      result = await resolveImportResponse(res, onProgress);
    } else if (!res.ok) {
      await parseUploadResponse(res);
    }
  }

  if (!result) {
    throw new Error("Chunked upload did not return import result");
  }
  return result;
}

export async function uploadEnexFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<EnexUploadResult> {
  if (file.size <= SINGLE_UPLOAD_MAX) {
    return uploadSingleFile(file, onProgress);
  }
  return uploadChunkedFile(file, onProgress);
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
