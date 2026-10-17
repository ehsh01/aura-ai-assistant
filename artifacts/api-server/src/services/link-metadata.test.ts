import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  fetchLinkMetadata,
  isPrivateAddress,
  parseLinkMetadata,
  type LinkMetadataDeps,
} from "./link-metadata";

const publicLookup: NonNullable<LinkMetadataDeps["lookup"]> = async () => [
  { address: "93.184.216.34", family: 4 },
];

describe("link metadata", () => {
  it("extracts title, description, domain, and a relative og:image without AI", () => {
    const metadata = parseLinkMetadata(
      `<html><head>
        <title>Fallback</title>
        <meta content="A useful page" name="description">
        <meta property="og:title" content="Recall &amp; Research">
        <meta content="/preview.jpg" property="og:image">
      </head></html>`,
      new URL("https://www.example.com/articles/one"),
    );
    expect(metadata).toEqual({
      title: "Recall & Research",
      description: "A useful page",
      domain: "example.com",
      imageUrl: "https://www.example.com/preview.jpg",
      canonicalUrl: "https://www.example.com/articles/one",
    });
  });

  it("follows only validated public redirects", async () => {
    const seen: string[] = [];
    const metadata = await fetchLinkMetadata("https://example.com/start", {
      lookup: publicLookup,
      request: async (url) => {
        seen.push(url.toString());
        return seen.length === 1
          ? { status: 302, headers: { location: "/final" }, body: Buffer.alloc(0) }
          : {
              status: 200,
              headers: { "content-type": "text/html" },
              body: Buffer.from("<title>Final page</title>"),
            };
      },
    });
    expect(seen).toEqual(["https://example.com/start", "https://example.com/final"]);
    expect(metadata.title).toBe("Final page");
  });

  it("blocks private, loopback, link-local, and mixed DNS answers", async () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.1.1", "::1", "fd00::1"]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);

    await expect(
      fetchLinkMetadata("http://example.com", {
        lookup: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
        request: async () => {
          throw new Error("must not request");
        },
      }),
    ).rejects.toThrow("Private network");
  });

  it("enforces the body size cap and strips tracking parameters", async () => {
    await expect(
      fetchLinkMetadata("https://example.com", {
        lookup: publicLookup,
        maxBytes: 10,
        request: async () => ({
          status: 200,
          headers: { "content-type": "text/html" },
          body: Buffer.from("<title>This response is too large</title>"),
        }),
      }),
    ).rejects.toThrow("size cap");

    expect(
      canonicalizeUrl("HTTPS://Example.com:443/path?utm_source=x&b=2&a=1#section"),
    ).toBe("https://example.com/path?a=1&b=2");
  });
});
