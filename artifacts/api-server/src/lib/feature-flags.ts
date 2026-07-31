/**
 * Environment-backed feature flag. Flags default on unless explicitly set to
 * "false" (case-insensitive), which keeps existing deployments unchanged.
 */
export function isEnabled(name: string, defaultTrue = true): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw == null || raw === "") return defaultTrue;
  return raw !== "false";
}
