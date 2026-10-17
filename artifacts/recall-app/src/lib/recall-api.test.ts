import { afterEach, describe, expect, it, vi } from "vitest";
import { testEvernoteConnector } from "./recall-api";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("testEvernoteConnector", () => {
  it("aborts after 20 seconds with the reconnect message", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    const request = testEvernoteConnector("evernote-1");
    const rejection = expect(request).rejects.toThrow(
      "Evernote didn't respond — reconnect Evernote",
    );
    await vi.advanceTimersByTimeAsync(20_000);

    await rejection;
    expect(signal?.aborted).toBe(true);
  });
});
