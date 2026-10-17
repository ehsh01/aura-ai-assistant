import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completionCreate: vi.fn(),
  embeddingCreate: vi.fn(),
  claimNextJobOfTypes: vi.fn().mockResolvedValue(null),
}));

vi.hoisted(() => {
  process.env.UPLOAD_DIR = "/tmp/recall-startup-test/uploads";
  process.env.ATTACHMENTS_DIR = "/tmp/recall-startup-test/attachments";
});

vi.mock("openai", () => ({
  default: class OpenAI {
    chat = { completions: { create: mocks.completionCreate } };
    embeddings = { create: mocks.embeddingCreate };
  },
  toFile: vi.fn(),
}));

vi.mock("./services/job-queue", () => ({
  JOB_TYPE_ATTACHMENT_EXTRACT: "attachment_extract",
  JOB_TYPE_ATTENTION_SCAN: "attention_scan",
  JOB_TYPE_CAPTURE_EXTRACTION: "capture_extraction",
  JOB_TYPE_CONNECTOR_SYNC: "connector_sync",
  JOB_TYPE_DIGEST_REGEN: "digest_regen",
  JOB_TYPE_ENEX_IMPORT: "enex_import",
  JOB_TYPE_WAITING_SCAN: "waiting_scan",
  attachmentIdFromPayload: vi.fn(),
  captureIdFromPayload: vi.fn(),
  claimJobById: vi.fn().mockResolvedValue(null),
  claimNextJobOfTypes: mocks.claimNextJobOfTypes,
  completeJob: vi.fn(),
  connectorSyncFromPayload: vi.fn(),
  continueJob: vi.fn(),
  enexImportFromPayload: vi.fn(),
  failJob: vi.fn(),
  heartbeatJob: vi.fn(),
  recoverStaleProcessingJobs: vi.fn().mockResolvedValue(0),
}));

import app from "./app";
import { startJobWorker, stopJobWorker } from "./services/job-worker";

afterEach(() => {
  stopJobWorker();
  vi.clearAllMocks();
});

describe("server and worker startup", () => {
  it("make zero OpenAI calls", async () => {
    expect(app).toBeDefined();
    startJobWorker();
    await vi.waitFor(() => {
      expect(mocks.claimNextJobOfTypes).toHaveBeenCalled();
    });

    expect(mocks.completionCreate).not.toHaveBeenCalled();
    expect(mocks.embeddingCreate).not.toHaveBeenCalled();
    expect(mocks.claimNextJobOfTypes).toHaveBeenCalledWith(expect.any(String), [
      "attachment_extract",
    ]);
  });
});
