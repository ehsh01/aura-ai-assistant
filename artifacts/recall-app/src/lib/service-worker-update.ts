export type BuildReloadDecision =
  | "reload"
  | "same-build"
  | "already-reloaded"
  | "defer-for-input";

export function buildReloadGuardKey(buildId: string): string {
  return `recall:reloaded-build:${buildId}`;
}

export function decideBuildReload(input: {
  currentBuildId: string;
  nextBuildId: string;
  alreadyReloaded: boolean;
  hasUnsafeInput: boolean;
}): BuildReloadDecision {
  if (!input.nextBuildId || input.nextBuildId === input.currentBuildId) {
    return "same-build";
  }
  if (input.alreadyReloaded) return "already-reloaded";
  if (input.hasUnsafeInput) return "defer-for-input";
  return "reload";
}

function isTextEntry(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(element.type);
}

function showReloadToast(onReload: () => void): void {
  const existing = document.querySelector<HTMLElement>(
    "[data-recall-update-toast]",
  );
  if (existing) return;
  const toast = document.createElement("div");
  toast.dataset.recallUpdateToast = "true";
  toast.setAttribute("role", "status");
  toast.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 32px);padding:10px 12px;border:1px solid rgba(125,255,217,.32);border-radius:12px;background:#07110f;color:#e8fff7;box-shadow:0 12px 40px rgba(0,0,0,.38);font:500 13px Inter,system-ui,sans-serif";
  const label = document.createElement("span");
  label.textContent = "New version ready";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Reload";
  button.style.cssText =
    "border:0;border-radius:999px;padding:6px 10px;background:#7dffd9;color:#04100d;font:600 12px Inter,system-ui,sans-serif;cursor:pointer";
  button.addEventListener("click", onReload);
  toast.append(label, button);
  document.body.append(toast);
}

export function startServiceWorkerUpdateCoordinator(input: {
  currentBuildId: string;
  buildMetadataUrl: string;
  reload?: () => void;
  fetchBuild?: () => Promise<string>;
}): () => void {
  if (!("serviceWorker" in navigator)) return () => {};

  const dirtyEntries = new Set<HTMLElement>();
  let pendingBuildId: string | null = null;
  let checking: Promise<void> | null = null;
  const reload = input.reload ?? (() => window.location.reload());
  const fetchBuild =
    input.fetchBuild ??
    (async () => {
      const response = await fetch(input.buildMetadataUrl, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) return "";
      const body = (await response.json()) as { buildId?: unknown };
      return typeof body.buildId === "string" ? body.buildId : "";
    });

  const hasUnsafeInput = () => {
    for (const entry of dirtyEntries) {
      if (!entry.isConnected) dirtyEntries.delete(entry);
    }
    return isTextEntry(document.activeElement) || dirtyEntries.size > 0;
  };

  const alreadyReloaded = (buildId: string) => {
    try {
      return sessionStorage.getItem(buildReloadGuardKey(buildId)) === "1";
    } catch {
      return false;
    }
  };

  const markReloaded = (buildId: string) => {
    try {
      sessionStorage.setItem(buildReloadGuardKey(buildId), "1");
    } catch {
      // A blocked sessionStorage must not turn controllerchange into a loop.
      return false;
    }
    return true;
  };

  const attemptReload = (buildId: string) => {
    const decision = decideBuildReload({
      currentBuildId: input.currentBuildId,
      nextBuildId: buildId,
      alreadyReloaded: alreadyReloaded(buildId),
      hasUnsafeInput: hasUnsafeInput(),
    });
    if (decision === "defer-for-input") {
      pendingBuildId = buildId;
      showReloadToast(() => attemptReload(buildId));
      return;
    }
    if (decision !== "reload") return;
    if (!markReloaded(buildId)) {
      pendingBuildId = buildId;
      showReloadToast(() => attemptReload(buildId));
      return;
    }
    reload();
  };

  const onControllerChange = () => {
    if (checking) return;
    checking = fetchBuild()
      .then((buildId) => {
        if (buildId) attemptReload(buildId);
      })
      .catch(() => {
        // A failed metadata read is safer than a speculative reload.
      })
      .finally(() => {
        checking = null;
      });
  };
  const onInput = (event: Event) => {
    if (isTextEntry(event.target as Element | null)) {
      dirtyEntries.add(event.target as HTMLElement);
    }
  };
  const onSubmitOrReset = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    for (const entry of dirtyEntries) {
      if (entry.closest("form") === form) dirtyEntries.delete(entry);
    }
    if (pendingBuildId) queueMicrotask(() => attemptReload(pendingBuildId!));
  };
  const onBlur = () => {
    if (pendingBuildId && !hasUnsafeInput()) attemptReload(pendingBuildId);
  };

  navigator.serviceWorker.addEventListener(
    "controllerchange",
    onControllerChange,
  );
  document.addEventListener("input", onInput, true);
  document.addEventListener("submit", onSubmitOrReset, true);
  document.addEventListener("reset", onSubmitOrReset, true);
  document.addEventListener("focusout", onBlur, true);

  return () => {
    navigator.serviceWorker.removeEventListener(
      "controllerchange",
      onControllerChange,
    );
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("submit", onSubmitOrReset, true);
    document.removeEventListener("reset", onSubmitOrReset, true);
    document.removeEventListener("focusout", onBlur, true);
  };
}
