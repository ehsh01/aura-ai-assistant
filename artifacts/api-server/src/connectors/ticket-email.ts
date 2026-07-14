import { ImapFlow } from "imapflow";
import type { EvidenceInput, NormalizedSourceRecord, RecallConnector } from "./types";

export type TicketEmailRaw = {
  externalId: string;
  subject: string;
  from: string;
  receivedAt?: string | null;
  bodyText: string;
  sourceUrl?: string | null;
};

export type ParsedTicketFields = {
  ticketNumber: string | null;
  title: string | null;
  requester: string | null;
  priority: string | null;
  ticketLink: string | null;
  description: string | null;
};

/** Extract structured ticket fields from subject + body (vendor-agnostic heuristics). */
export function parseTicketEmailFields(subject: string, body: string, from: string): ParsedTicketFields {
  const hay = `${subject}\n${body}`;

  const ticketNumber =
    subject.match(/\[([A-Z]{2,}[-_]?\d[\w-]*)\]/i)?.[1] ??
    hay.match(/\b((?:INC|REQ|SR|CASE|TKT)[-_]?\d[\w-]*)\b/i)?.[1] ??
    hay.match(/\b(?:ticket|case|incident|request)[#:\s-]+([A-Z0-9][\w-]{2,})\b/i)?.[1] ??
    null;

  const priority =
    hay.match(/\bpriority\s*[:=]\s*(critical|high|medium|low|p[1-4])\b/i)?.[1] ??
    hay.match(/\b(critical|high|medium|low)\s+priority\b/i)?.[1] ??
    null;

  const ticketLink =
    hay.match(/https?:\/\/[^\s<>"]+(?:ticket|case|incident|request)[^\s<>"]*/i)?.[0] ??
    hay.match(/https?:\/\/[^\s<>"]+/i)?.[0] ??
    null;

  const fromFallback = from.includes("<")
    ? from.replace(/.*</, "").replace(/>.*/, "").trim()
    : from.trim();
  const requester =
    hay.match(/\b(?:requester|requested by|from)\s*[:=]\s*(.+)$/im)?.[1]?.trim() ||
    fromFallback ||
    null;

  let title = subject.trim() || null;
  if (title) {
    const cleaned = title
      .replace(/^(re|fw|fwd)\s*:\s*/gi, "")
      .replace(/\[[^\]]+\]\s*/g, "")
      .trim();
    title = cleaned || title;
  }

  const descriptionBlock = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .find((p) => p.length > 40 && !/^from:/i.test(p));
  const description = (descriptionBlock?.slice(0, 1200) || body.slice(0, 800) || null) as
    | string
    | null;

  return { ticketNumber, title, requester, priority, ticketLink, description };
}

export const ticketEmailConnector: RecallConnector = {
  id: "ticket_email",
  type: "ticket_email",
  sourceOfTruth: "read_only_external",
  async normalize(records: unknown[]): Promise<NormalizedSourceRecord[]> {
    return (records as TicketEmailRaw[]).map((row) => {
      const parsed = parseTicketEmailFields(row.subject ?? "", row.bodyText ?? "", row.from ?? "");
      const bits = [
        parsed.ticketNumber ? `Ticket: ${parsed.ticketNumber}` : null,
        parsed.requester ? `Requester: ${parsed.requester}` : null,
        parsed.priority ? `Priority: ${parsed.priority}` : null,
        parsed.ticketLink ? `Link: ${parsed.ticketLink}` : null,
        "",
        row.bodyText?.slice(0, 4000) ?? "",
      ].filter((x) => x !== null);
      return {
        externalId: row.externalId,
        recordType: "ticket_email",
        recordTitle: parsed.title ?? row.subject ?? "Ticket email",
        recordText: bits.join("\n"),
        recordMetadata: { ...parsed, from: row.from, subject: row.subject },
        sourceUrl: parsed.ticketLink ?? row.sourceUrl ?? null,
        sourceCreatedAt: row.receivedAt ?? null,
      };
    });
  },
  mapEvidence(record: NormalizedSourceRecord): EvidenceInput[] {
    return [
      {
        claimType: "summary_based_on",
        evidenceText: record.recordText ?? null,
        sourceRecordExternalId: record.externalId,
        url: record.sourceUrl ?? null,
      },
    ];
  },
};

export type TicketImapSettings = {
  host: string;
  port?: number;
  secure?: boolean;
  user: string;
  password: string;
  mailbox?: string;
  /** Max messages to scan per sync (newest first). */
  limit?: number;
};

function decodeMailboxPart(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (typeof value === "object" && value !== null && "text" in value) {
    return String((value as { text?: string }).text ?? "");
  }
  return String(value);
}

/**
 * Fetch recent mailbox messages over IMAP (env-gated by caller having credentials).
 * Uses IMAP SEARCH ALL + newest UIDs — suitable for shared ticket inboxes.
 */
export async function fetchTicketEmailsViaImap(
  settings: TicketImapSettings,
): Promise<TicketEmailRaw[]> {
  const host = settings.host?.trim();
  const user = settings.user?.trim();
  const password = settings.password;
  if (!host || !user || !password) {
    throw new Error("ticket_email connector requires host, user, and password");
  }

  const port = settings.port ?? 993;
  const secure = settings.secure !== false;
  const mailbox = settings.mailbox?.trim() || "INBOX";
  const limit = Math.min(Math.max(settings.limit ?? 40, 1), 200);

  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass: password },
    logger: false,
  });

  const out: TicketEmailRaw[] = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock(mailbox);
    try {
      const uids = await client.search({ all: true }, { uid: true });
      const list = Array.isArray(uids) ? uids : [];
      const recent = list.slice(-limit).reverse();
      for (const uid of recent) {
        const msg = await client.fetchOne(
          String(uid),
          { uid: true, envelope: true, source: true },
          { uid: true },
        );
        if (!msg || typeof msg === "boolean") continue;
        const envelope = msg.envelope;
        const subject = envelope?.subject ?? "(no subject)";
        const fromAddr = envelope?.from?.[0];
        const from = fromAddr
          ? `${fromAddr.name ?? ""} <${fromAddr.address ?? ""}>`.trim()
          : "";
        const receivedAt = envelope?.date ? new Date(envelope.date).toISOString() : null;
        const bodyText = decodeMailboxPart(msg.source).slice(0, 20000);
        out.push({
          externalId: `imap-${mailbox}-${uid}`,
          subject,
          from,
          receivedAt,
          bodyText,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
  return out;
}
