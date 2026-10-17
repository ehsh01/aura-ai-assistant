export const APP_PATHS = [
  "/",
  "/today",
  "/everything",
  "/ask",
  "/notes",
  "/notebooks",
  "/inbox",
  "/documents",
  "/memory",
  "/knowledge",
  "/people",
  "/activity",
  "/connectors",
  "/settings",
  "/projects",
  "/waiting",
  "/tasks",
  "/canvas",
  "/vehicles",
  "/organizations",
  "/deadlines",
  "/privacy",
  "/terms",
  "/login",
] as const;

/** Detail routes with dynamic segments, allowed alongside APP_PATHS. */
const APP_PATH_PREFIXES = [
  "/projects/",
  "/waiting/",
  "/today/",
  "/everything/",
  "/people/",
] as const;

export type AppPath = (typeof APP_PATHS)[number];

export function pathnameOnly(): string {
  return window.location.pathname.split("?")[0]?.split("#")[0] ?? "/";
}

export function normalizedAppPath(pathname: string): string {
  let path = pathname;
  if (path.endsWith("/index.html")) {
    path = path.slice(0, -"/index.html".length) || "/";
  }
  return isAppPath(path) ? path : "/";
}

/** Fix /index.html and other unknown paths in the address bar (safe before React mounts). */
export function normalizeBrowserPath(): void {
  const path = normalizedAppPath(pathnameOnly());
  const next = path + window.location.search + window.location.hash;
  const current =
    window.location.pathname + window.location.search + window.location.hash;
  if (next !== current) {
    window.history.replaceState(null, "", next);
  }
}

export function isAppPath(path: string): path is AppPath {
  return (
    (APP_PATHS as readonly string[]).includes(path) ||
    APP_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}
