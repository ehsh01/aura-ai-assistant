export type ConnectorTestErrorResponse = {
  status: number;
  body: {
    error: "AUTH_FAILED" | "RATE_LIMITED" | "UPSTREAM_TIMEOUT" | "UPSTREAM_ERROR";
    message: string;
  };
};

export function connectorTestErrorResponse(error: unknown): ConnectorTestErrorResponse {
  const status =
    error && typeof error === "object" && "status" in error && typeof error.status === "number"
      ? error.status
      : 502;
  const responseStatus = status === 401 || status === 429 || status === 504 ? status : 502;
  return {
    status: responseStatus,
    body: {
      error:
        responseStatus === 401
          ? "AUTH_FAILED"
          : responseStatus === 429
            ? "RATE_LIMITED"
            : responseStatus === 504
              ? "UPSTREAM_TIMEOUT"
              : "UPSTREAM_ERROR",
      message: error instanceof Error ? error.message : "Connector test failed",
    },
  };
}
