import type { EvidenceInput, NormalizedSourceRecord, RecallConnector } from "./types";

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
] as const;

export type GoogleRawRecord = {
  externalId: string;
  recordType: "gmail_message" | "calendar_event" | "google_contact" | "drive_file";
  recordTitle: string;
  recordText: string;
  sourceUrl?: string | null;
  sourceCreatedAt?: string | null;
  metadata?: Record<string, unknown>;
};

function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
    "https://recall-app.net/api/connectors/google/oauth/callback";
  if (!clientId || !clientSecret) {
    const err = new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured") as Error & {
      status?: number;
    };
    err.status = 503;
    throw err;
  }
  return { clientId, clientSecret, redirectUri };
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function buildGoogleAuthUrl(state: string): string {
  const { clientId, redirectUri } = googleConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGoogleCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  email: string;
  name: string | null;
}> {
  const { clientId, clientSecret, redirectUri } = googleConfig();
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${tokenRes.status} ${body.slice(0, 200)}`);
  }
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token) throw new Error("Google did not return an access token");

  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) {
    throw new Error(`Google profile fetch failed: ${profileRes.status}`);
  }
  const profile = (await profileRes.json()) as { email?: string; name?: string };
  if (!profile.email) throw new Error("Google account has no email");

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresIn: tokens.expires_in ?? 3600,
    email: profile.email,
    name: profile.name ?? null,
  };
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const { clientId, clientSecret } = googleConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token refresh failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google refresh did not return an access token");
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 };
}

async function googleGet<T>(accessToken: string, url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google API ${res.status}: ${body.slice(0, 180)}`);
  }
  return res.json() as Promise<T>;
}

function headerValue(
  headers: { name?: string; value?: string }[] | undefined,
  name: string,
): string | null {
  const hit = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return hit?.value ?? null;
}

/** Max decoded email body length we surface to Ask (keeps context bounded). */
const MAX_EMAIL_BODY_CHARS = 4000;

type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};

function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf-8",
    );
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Walk a Gmail payload tree and extract readable body text (prefer text/plain). */
function extractGmailBody(payload: GmailPart | undefined): string {
  if (!payload) return "";
  const plains: string[] = [];
  const htmls: string[] = [];

  const walk = (part: GmailPart) => {
    const mime = part.mimeType ?? "";
    // Skip attachments (they have a filename) — we only want the message body.
    if (!part.filename && part.body?.data) {
      if (mime === "text/plain") plains.push(decodeBase64Url(part.body.data));
      else if (mime === "text/html") htmls.push(decodeBase64Url(part.body.data));
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);

  const plain = plains.join("\n").trim();
  if (plain) return plain.slice(0, MAX_EMAIL_BODY_CHARS);
  const html = htmls.join("\n").trim();
  if (html) return stripHtml(html).slice(0, MAX_EMAIL_BODY_CHARS);
  return "";
}

async function fetchGmailMessageDetails(
  accessToken: string,
  messageId: string,
  opts?: { full?: boolean },
): Promise<GoogleRawRecord | null> {
  try {
    const wantFull = opts?.full === true;
    const detailUrl = wantFull
      ? `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`
      : `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`;
    const full = await googleGet<{
      id: string;
      snippet?: string;
      internalDate?: string;
      payload?: GmailPart & { headers?: { name?: string; value?: string }[] };
    }>(accessToken, detailUrl);
    const subject = headerValue(full.payload?.headers, "Subject") ?? "(no subject)";
    const from = headerValue(full.payload?.headers, "From") ?? "";
    const to = headerValue(full.payload?.headers, "To") ?? "";
    const date = headerValue(full.payload?.headers, "Date");
    const snippet = (full.snippet ?? "").slice(0, 800);
    const body = wantFull ? extractGmailBody(full.payload) : "";
    const fromParsed = (() => {
      const angle = from.match(/^(.*?)\s*<([^>]+)>/);
      if (angle) {
        return {
          name: angle[1]!.replace(/^["']|["']$/g, "").trim(),
          email: angle[2]!.trim().toLowerCase(),
        };
      }
      if (from.includes("@")) return { name: "", email: from.toLowerCase() };
      return { name: from, email: "" };
    })();
    return {
      externalId: `gmail:${full.id}`,
      recordType: "gmail_message",
      recordTitle: subject.slice(0, 400),
      recordText: [
        "Email message",
        `From: ${from}`,
        to ? `To: ${to}` : null,
        fromParsed.name ? `sender_name: ${fromParsed.name}` : null,
        fromParsed.email ? `sender_email: ${fromParsed.email}` : null,
        `Subject: ${subject}`,
        body || snippet,
      ]
        .filter(Boolean)
        .join("\n"),
      sourceUrl: `https://mail.google.com/mail/u/0/#inbox/${full.id}`,
      sourceCreatedAt: full.internalDate
        ? new Date(Number(full.internalDate)).toISOString()
        : date,
      metadata: {
        from,
        to,
        subject,
        senderName: fromParsed.name || null,
        senderEmail: fromParsed.email || null,
        hasFullBody: Boolean(body),
      },
    };
  } catch {
    return null;
  }
}

async function fetchGmail(accessToken: string): Promise<GoogleRawRecord[]> {
  // Broader inbox window so Ask has more than the last ~100 messages.
  const list = await googleGet<{ messages?: { id: string }[] }>(
    accessToken,
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=300&q=newer_than:365d",
  );
  const out: GoogleRawRecord[] = [];
  for (const msg of (list.messages ?? []).slice(0, 300)) {
    const row = await fetchGmailMessageDetails(accessToken, msg.id);
    if (row) out.push(row);
  }
  return out;
}

/**
 * Live Gmail search (used when Ask asks for mail from/about someone not in the sync cache).
 * Gmail's `q` already searches full message bodies server-side; we then fetch the full
 * decoded body for the top `fullBodyCount` hits so Ask can read/quote real content.
 */
export async function searchGmailMessages(
  accessToken: string,
  query: string,
  maxResults = 25,
  opts?: { fullBodyCount?: number },
): Promise<GoogleRawRecord[]> {
  const q = query.trim();
  if (!q) return [];
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("maxResults", String(Math.min(Math.max(maxResults, 1), 50)));
  url.searchParams.set("q", q);
  const list = await googleGet<{ messages?: { id: string }[] }>(accessToken, url.toString());
  const ids = (list.messages ?? []).map((m) => m.id);
  const fullBodyCount = Math.max(0, opts?.fullBodyCount ?? 8);
  const rows = await Promise.all(
    ids.map((id, idx) =>
      fetchGmailMessageDetails(accessToken, id, { full: idx < fullBodyCount }),
    ),
  );
  return rows.filter((r): r is GoogleRawRecord => r !== null);
}

async function fetchCalendar(accessToken: string): Promise<GoogleRawRecord[]> {
  const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "100");

  const data = await googleGet<{
    items?: {
      id?: string;
      summary?: string;
      description?: string;
      location?: string;
      htmlLink?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      attendees?: { email?: string; displayName?: string }[];
    }[];
  }>(accessToken, url.toString());

  return (data.items ?? [])
    .filter((e) => e.id)
    .map((e) => {
      const start = e.start?.dateTime ?? e.start?.date ?? "";
      const end = e.end?.dateTime ?? e.end?.date ?? "";
      const who = (e.attendees ?? [])
        .map((a) => a.displayName || a.email)
        .filter(Boolean)
        .slice(0, 8)
        .join(", ");
      const title = e.summary ?? "(no title)";
      return {
        externalId: `gcal:${e.id}`,
        recordType: "calendar_event" as const,
        recordTitle: title.slice(0, 400),
        recordText: [
          `Event: ${title}`,
          start ? `Start: ${start}` : null,
          end ? `End: ${end}` : null,
          e.location ? `Location: ${e.location}` : null,
          who ? `Attendees: ${who}` : null,
          e.description ? e.description.slice(0, 600) : null,
        ]
          .filter(Boolean)
          .join("\n"),
        sourceUrl: e.htmlLink ?? null,
        sourceCreatedAt: start || null,
        metadata: { start, end, location: e.location ?? null },
      };
    });
}

async function fetchContacts(accessToken: string): Promise<GoogleRawRecord[]> {
  const url = new URL("https://people.googleapis.com/v1/people/me/connections");
  url.searchParams.set("personFields", "names,emailAddresses,phoneNumbers,organizations");
  url.searchParams.set("pageSize", "200");

  const data = await googleGet<{
    connections?: {
      resourceName?: string;
      names?: { displayName?: string; givenName?: string; familyName?: string }[];
      emailAddresses?: { value?: string }[];
      phoneNumbers?: { value?: string }[];
      organizations?: { name?: string; title?: string }[];
    }[];
  }>(accessToken, url.toString());

  return (data.connections ?? [])
    .filter((p) => p.resourceName)
    .map((p) => {
      const name =
        p.names?.[0]?.displayName ||
        [p.names?.[0]?.givenName, p.names?.[0]?.familyName].filter(Boolean).join(" ") ||
        "Unknown contact";
      const emails = (p.emailAddresses ?? []).map((e) => e.value).filter(Boolean).join(", ");
      const phones = (p.phoneNumbers ?? []).map((e) => e.value).filter(Boolean).join(", ");
      const org = p.organizations?.[0];
      return {
        externalId: `gcontact:${p.resourceName}`,
        recordType: "google_contact" as const,
        recordTitle: name.slice(0, 400),
        recordText: [
          `Contact: ${name}`,
          emails ? `Email: ${emails}` : null,
          phones ? `Phone: ${phones}` : null,
          org?.name ? `Org: ${org.name}` : null,
          org?.title ? `Title: ${org.title}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        sourceUrl: null,
        sourceCreatedAt: null,
        metadata: {
          givenName: p.names?.[0]?.givenName ?? null,
          familyName: p.names?.[0]?.familyName ?? null,
          emails,
        },
      };
    });
}

async function fetchDrive(accessToken: string): Promise<GoogleRawRecord[]> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set(
    "fields",
    "files(id,name,mimeType,modifiedTime,webViewLink,description)",
  );
  url.searchParams.set("pageSize", "50");
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("q", "trashed=false");

  const data = await googleGet<{
    files?: {
      id?: string;
      name?: string;
      mimeType?: string;
      modifiedTime?: string;
      webViewLink?: string;
      description?: string;
    }[];
  }>(accessToken, url.toString());

  const out: GoogleRawRecord[] = [];
  for (const f of data.files ?? []) {
    if (!f.id) continue;
    let extra = "";
    // Cheap text export for Google Docs only (bounded).
    if (f.mimeType === "application/vnd.google-apps.document") {
      try {
        const exportRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/plain`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (exportRes.ok) {
          extra = (await exportRes.text()).slice(0, 1500);
        }
      } catch {
        // metadata-only fallback
      }
    }
    const title = f.name ?? "Untitled";
    out.push({
      externalId: `gdrive:${f.id}`,
      recordType: "drive_file",
      recordTitle: title.slice(0, 400),
      recordText: [
        `Drive file: ${title}`,
        f.mimeType ? `Type: ${f.mimeType}` : null,
        f.modifiedTime ? `Modified: ${f.modifiedTime}` : null,
        f.description ? f.description.slice(0, 400) : null,
        extra || null,
      ]
        .filter(Boolean)
        .join("\n"),
      sourceUrl: f.webViewLink ?? null,
      sourceCreatedAt: f.modifiedTime ?? null,
      metadata: { mimeType: f.mimeType ?? null },
    });
  }
  return out;
}

/** Max text we pull per Drive file (Docs/Sheets/Slides/text) for the top hits. */
const MAX_DRIVE_TEXT_CHARS = 4000;

const DRIVE_EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};

const DRIVE_DOWNLOADABLE_TEXT =
  /^(text\/|application\/(json|xml|rtf|csv))/i;

/**
 * Pull readable text for a single Drive file (top-hit enrichment only).
 * Google-native docs are exported to text; small text files are downloaded.
 * PDFs/images are intentionally skipped — Google's index already searched their
 * content, but the raw OCR text is not retrievable via the read-only API.
 */
export async function fetchDriveFileText(
  accessToken: string,
  fileId: string,
  mimeType: string | null | undefined,
): Promise<string> {
  const mime = mimeType ?? "";
  try {
    const exportMime = DRIVE_EXPORT_MIME[mime];
    if (exportMime) {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (res.ok) return (await res.text()).slice(0, MAX_DRIVE_TEXT_CHARS);
      return "";
    }
    if (DRIVE_DOWNLOADABLE_TEXT.test(mime)) {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (res.ok) return (await res.text()).slice(0, MAX_DRIVE_TEXT_CHARS);
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Live Drive search across a single account. Uses Drive's own full-text index
 * (`fullText contains`) which matches content inside Docs, Sheets, Slides, PDFs,
 * and scanned images Google has OCR'd — no size or scannability limits.
 * The top `fullTextCount` non-folder hits are enriched with exportable text.
 */
export async function searchDriveFiles(
  accessToken: string,
  query: string,
  maxResults = 25,
  opts?: { fullTextCount?: number },
): Promise<GoogleRawRecord[]> {
  const q = query.trim();
  if (!q) return [];
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set(
    "fields",
    "files(id,name,mimeType,modifiedTime,createdTime,webViewLink,description,owners(emailAddress,displayName),size)",
  );
  url.searchParams.set("pageSize", String(Math.min(Math.max(maxResults, 1), 50)));
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("q", q);
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("corpora", "allDrives");
  url.searchParams.set("spaces", "drive");

  const data = await googleGet<{
    files?: {
      id?: string;
      name?: string;
      mimeType?: string;
      modifiedTime?: string;
      createdTime?: string;
      webViewLink?: string;
      description?: string;
      owners?: { emailAddress?: string; displayName?: string }[];
      size?: string;
    }[];
  }>(accessToken, url.toString());

  const files = (data.files ?? []).filter((f) => f.id);
  const fullTextCount = Math.max(0, opts?.fullTextCount ?? 6);
  let enriched = 0;

  const out: GoogleRawRecord[] = [];
  for (const f of files) {
    const isFolder = f.mimeType === "application/vnd.google-apps.folder";
    let extra = "";
    if (!isFolder && enriched < fullTextCount) {
      extra = await fetchDriveFileText(accessToken, f.id!, f.mimeType);
      if (extra) enriched += 1;
    }
    const title = f.name ?? "Untitled";
    const owner = f.owners?.[0]?.emailAddress ?? f.owners?.[0]?.displayName ?? null;
    out.push({
      externalId: `gdrive:${f.id}`,
      recordType: "drive_file",
      recordTitle: title.slice(0, 400),
      recordText: [
        `Drive file: ${title}`,
        f.mimeType ? `Type: ${f.mimeType}` : null,
        f.modifiedTime ? `Modified: ${f.modifiedTime}` : null,
        owner ? `Owner: ${owner}` : null,
        f.description ? f.description.slice(0, 400) : null,
        extra || null,
      ]
        .filter(Boolean)
        .join("\n"),
      sourceUrl: f.webViewLink ?? null,
      sourceCreatedAt: f.modifiedTime ?? f.createdTime ?? null,
      metadata: {
        mimeType: f.mimeType ?? null,
        owner,
        size: f.size ?? null,
        isFolder,
      },
    });
  }
  return out;
}

/** Fetch a bounded Google data bundle for sync. */
export async function fetchGoogleBundle(
  accessToken: string,
  mailboxEmail?: string | null,
): Promise<GoogleRawRecord[]> {
  const settled = await Promise.allSettled([
    fetchGmail(accessToken),
    fetchCalendar(accessToken),
    fetchContacts(accessToken),
    fetchDrive(accessToken),
  ]);
  const out: GoogleRawRecord[] = [];
  const errors: string[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") out.push(...result.value);
    else errors.push(result.reason instanceof Error ? result.reason.message : "fetch failed");
  }
  if (out.length === 0 && errors.length > 0) {
    throw new Error(`Google sync failed: ${errors[0]}`);
  }
  const mailbox = mailboxEmail?.trim().toLowerCase() || null;
  if (mailbox) {
    for (const r of out) {
      r.metadata = { ...(r.metadata ?? {}), mailbox };
      if (r.recordType === "gmail_message") {
        r.recordText = `Mailbox: ${mailbox}\n${r.recordText}`;
      }
    }
  }
  return out;
}

export const googleConnector: RecallConnector = {
  id: "google",
  type: "google",
  sourceOfTruth: "read_only_external",
  async normalize(records: unknown[]): Promise<NormalizedSourceRecord[]> {
    return (records as GoogleRawRecord[]).map((r) => ({
      externalId: r.externalId.slice(0, 255),
      recordType: r.recordType,
      recordTitle: r.recordTitle,
      recordText: r.recordText,
      recordMetadata: r.metadata ?? {},
      sourceUrl: r.sourceUrl ?? null,
      sourceCreatedAt: r.sourceCreatedAt ?? null,
    }));
  },
  mapEvidence(record: NormalizedSourceRecord): EvidenceInput[] {
    return [
      {
        claimType: "source_excerpt",
        evidenceText: record.recordText?.slice(0, 1200) ?? null,
        sourceRecordExternalId: record.externalId,
        url: record.sourceUrl ?? null,
      },
    ];
  },
};
