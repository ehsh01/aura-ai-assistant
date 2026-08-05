/**
 * Map a structured capture candidate into the Recall POST /captures body.
 */

import { classifyHost } from "./hosts.js";

/**
 * @param {"outlook" | "teams" | null | undefined} source
 * @param {"automatic" | "manual"} mode
 */
export function sourceLabelFor(source, mode) {
  const automatic = mode === "automatic";
  if (source === "outlook") {
    return automatic ? "Outlook Web — automatic" : "Outlook Web";
  }
  if (source === "teams") {
    return automatic ? "Teams Web — automatic" : "Teams Web";
  }
  return automatic ? "Browser — automatic" : "Browser";
}

/**
 * @param {"outlook" | "teams" | null | undefined} source
 */
export function collectorFor(source) {
  if (source === "outlook") return "outlook_web";
  if (source === "teams") return "teams_web";
  return "generic";
}

/**
 * @param {{
 *   source?: "outlook" | "teams" | null;
 *   url?: string | null;
 *   hostname?: string | null;
 *   title?: string | null;
 *   subject?: string | null;
 *   channel?: string | null;
 *   sender?: string | null;
 *   body?: string | null;
 *   selectedText?: string | null;
 *   timestamp?: string | null;
 *   fingerprint?: string | null;
 * }} candidate
 * @param {"automatic" | "manual"} mode
 */
export function buildCaptureBody(candidate, mode) {
  const source =
    candidate.source ||
    classifyHost(candidate.hostname) ||
    null;
  const subjectOrChat = candidate.subject || candidate.channel || "";
  const bodyText = (candidate.selectedText || candidate.body || "").trim();
  const bits = [];
  if (subjectOrChat) {
    bits.push(
      source === "teams" ? `Channel: ${subjectOrChat}` : `Subject: ${subjectOrChat}`,
    );
  }
  if (candidate.sender) bits.push(`From: ${candidate.sender}`);

  const title =
    (candidate.title || subjectOrChat || sourceLabelFor(source, mode)).slice(0, 500);

  const rawText = [
    title,
    bits.join("\n"),
    "",
    bodyText,
  ]
    .join("\n")
    .trim()
    .slice(0, 100_000);

  const capturedAt =
    candidate.timestamp && !Number.isNaN(Date.parse(candidate.timestamp))
      ? new Date(candidate.timestamp).toISOString()
      : new Date().toISOString();

  return {
    rawText,
    sourceType: "browser_extension",
    sourceName: sourceLabelFor(source, mode),
    sourceUrl: candidate.url || null,
    title,
    capturedAt,
    rawMetadata: {
      collector: collectorFor(source),
      captureMode: mode,
      fingerprint: candidate.fingerprint || null,
      hostname: candidate.hostname || null,
      subject: candidate.subject || null,
      channel: candidate.channel || null,
      sender: candidate.sender || null,
      // Never include screenshots or full DOM dumps.
    },
  };
}
