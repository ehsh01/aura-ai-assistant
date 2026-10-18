import { readdir, readFile } from "node:fs/promises";

const html = await readFile(
  new URL("../dist/public/index.html", import.meta.url),
  "utf8",
);

if (/fonts\.googleapis\.com/i.test(html)) {
  throw new Error("Built index.html must not reference fonts.googleapis.com");
}

const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
const inline = scripts.filter((match) => !/\bsrc\s*=/.test(match[1] ?? ""));
if (inline.length > 0) {
  throw new Error("Built index.html must not contain inline script tags");
}

const assets = await readdir(
  new URL("../dist/public/assets/", import.meta.url),
);
const wakeRuntimeName = assets.find((name) =>
  /^wake-word-runtime-.*\.js$/.test(name),
);
if (!wakeRuntimeName) {
  throw new Error("Wake-word runtime must remain a separately gated chunk");
}
const wakeRuntime = await readFile(
  new URL(`../dist/public/assets/${wakeRuntimeName}`, import.meta.url),
  "utf8",
);
if (!wakeRuntime.includes("mic-worklet.js")) {
  throw new Error(
    "Wake-word microphone worklet must use its same-origin asset",
  );
}

const serviceWorker = await readFile(
  new URL("../dist/public/sw.js", import.meta.url),
  "utf8",
);
if (serviceWorker.includes("wake-word-runtime-")) {
  throw new Error(
    "Wake-word runtime must not be precached while the server switch is off",
  );
}
if (serviceWorker.includes("wakeword/")) {
  throw new Error(
    "Wake-word static assets must not be precached while the server switch is off",
  );
}
