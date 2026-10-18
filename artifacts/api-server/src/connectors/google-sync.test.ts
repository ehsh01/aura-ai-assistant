import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchGoogleBundle,
  GoogleNeedsReauthError,
  refreshGoogleAccessToken,
} from "./google";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function driveFiles(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `file-${start + index}`,
    name: `File ${start + index}`,
    mimeType: "application/pdf",
    modifiedTime: "2026-10-01T00:00:00.000Z",
  }));
}

describe("fetchGoogleBundle", () => {
  it("pages Drive past 50 rows, enforces the cap, and resumes from its cursor", async () => {
    const driveRequests: URL[] = [];
    globalThis.fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("www.googleapis.com");
      expect(url.pathname).toBe("/drive/v3/files");
      driveRequests.push(url);
      const token = url.searchParams.get("pageToken");
      if (!token) {
        return jsonResponse({
          files: driveFiles(0, 50),
          nextPageToken: "page-2",
        });
      }
      if (token === "page-2") {
        return jsonResponse({
          files: driveFiles(50, 10),
          nextPageToken: "page-3",
        });
      }
      return jsonResponse({ files: driveFiles(60, 5) });
    }) as typeof fetch;

    const first = await fetchGoogleBundle("token", "me@example.com", {
      since: "2026-09-01T00:00:00.000Z",
      cursor: { source: "drive", pageToken: null },
      maxRows: 60,
    });
    expect(first.records).toHaveLength(60);
    expect(first.complete).toBe(false);
    expect(first.nextCursor).toEqual({
      source: "drive",
      pageToken: "page-3",
    });
    expect(driveRequests).toHaveLength(2);
    expect(driveRequests[0]?.searchParams.get("pageSize")).toBe("60");
    expect(driveRequests[1]?.searchParams.get("pageSize")).toBe("10");
    expect(driveRequests[0]?.searchParams.get("q")).toContain(
      "modifiedTime > '2026-09-01T00:00:00.000Z'",
    );

    const second = await fetchGoogleBundle("token", "me@example.com", {
      since: "2026-09-01T00:00:00.000Z",
      cursor: first.nextCursor,
      maxRows: 60,
    });
    expect(second.records).toHaveLength(5);
    expect(second.complete).toBe(true);
    expect(driveRequests[2]?.searchParams.get("pageToken")).toBe("page-3");
  });

  it("keeps a source-specific error when the other sources succeed", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "gmail.googleapis.com") {
        return jsonResponse({ error: { message: "Gmail disabled" } }, 403);
      }
      if (
        url.hostname === "www.googleapis.com" &&
        url.pathname.includes("calendar")
      ) {
        return jsonResponse({ items: [] });
      }
      if (url.hostname === "people.googleapis.com") {
        return jsonResponse({ connections: [] });
      }
      if (
        url.hostname === "www.googleapis.com" &&
        url.pathname === "/drive/v3/files"
      ) {
        return jsonResponse({ files: [] });
      }
      throw new Error(`Unexpected Google URL: ${url}`);
    }) as typeof fetch;

    const result = await fetchGoogleBundle("token", null, { maxRows: 500 });
    expect(result.complete).toBe(true);
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "gmail",
          ok: false,
          error: expect.stringContaining("Google API 403"),
        }),
        expect.objectContaining({ source: "drive", ok: true }),
      ]),
    );
  });
});

describe("refreshGoogleAccessToken", () => {
  it("classifies invalid_grant as a reauthorization requirement", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(
        { error: "invalid_grant", error_description: "revoked" },
        400,
      ),
    ) as typeof fetch;

    await expect(refreshGoogleAccessToken("revoked")).rejects.toBeInstanceOf(
      GoogleNeedsReauthError,
    );
  });
});
