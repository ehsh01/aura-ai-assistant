import { readFile } from "node:fs/promises";

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
