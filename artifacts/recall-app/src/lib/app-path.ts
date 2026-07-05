export const APP_PATHS = ["/", "/notes", "/notebooks", "/inbox", "/projects", "/tasks", "/canvas"] as const;

export type AppPath = (typeof APP_PATHS)[number];

export function pathnameOnly(): string {
  return window.location.pathname.split("?")[0]?.split("#")[0] ?? "/";
}

/** Fix /index.html and other unknown paths in the address bar (safe before React mounts). */
export function normalizeBrowserPath(): void {
  let path = pathnameOnly();
  if (path.endsWith("/index.html")) {
    path = path.slice(0, -"/index.html".length) || "/";
  }
  if (!APP_PATHS.includes(path as AppPath) && !path.startsWith("/projects/")) {
    path = "/";
  }
  const next = path + window.location.search + window.location.hash;
  const current =
    window.location.pathname + window.location.search + window.location.hash;
  if (next !== current) {
    window.history.replaceState(null, "", next);
  }
}

export function isAppPath(path: string): path is AppPath {
  return (APP_PATHS as readonly string[]).includes(path);
}
