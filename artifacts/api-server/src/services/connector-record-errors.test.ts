import { describe, expect, it } from "vitest";
import {
  isSkippableConnectorRecordError,
  safeConnectorErrorMessage,
} from "./connector-record-errors";

describe("connector record database errors", () => {
  it("isolates data and constraint errors to one record", () => {
    expect(isSkippableConnectorRecordError({ code: "22P02" })).toBe(true);
    expect(isSkippableConnectorRecordError({ code: "23505" })).toBe(true);
    expect(
      isSkippableConnectorRecordError({
        cause: { code: "22P02" },
      }),
    ).toBe(true);
    expect(isSkippableConnectorRecordError({ code: "40P01" })).toBe(false);
  });

  it("does not repeat source content from database errors", () => {
    const error = Object.assign(
      new Error("invalid JSON contains private message text"),
      { code: "22P02" },
    );
    expect(safeConnectorErrorMessage(error)).toBe(
      "Connector sync database error (22P02)",
    );
  });
});
