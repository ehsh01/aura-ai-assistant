import type { EvidenceInput, NormalizedSourceRecord, RecallConnector } from "./types";

/** Microsoft Graph scopes for read-only Outlook mail + Teams chats. */
export const MICROSOFT_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Chat.Read",
] as const;

export type MicrosoftRawRecord = {
  externalId: string;
  recordType: "outlook_message" | "teams_chat_message";
  recordTitle: string;
  recordText: string;
  sourceUrl?: string | null;
  sourceCreatedAt?: string | null;
  metadata?: Record<string, unknown>;
};

function microsoftConfig() {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  const tenant = process.env.MICROSOFT_TENANT_ID?.trim() || "common";
  const redirectUri =
    process.env.MICROSOFT_OAUTH_REDIRECT_URI?.trim() ||
    "https://recall-app.net/api/connectors/microsoft/oauth/callback";
  if (!clientId || !clientSecret) {
    const err = new Error(
      "MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are not configured",
    ) as Error & { status?: number };
    err.status = 503;
    throw err;
  }
  return { clientId, clientSecret, tenant, redirectUri };
}

export function isMicrosoftOAuthConfigured(): boolean {
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID?.trim() && process.env.MICROSOFT_CLIENT_SECRET?.trim(),
  );
}

export function buildMicrosoftAuthUrl(state: string): string {
  const { clientId, tenant, redirectUri } = microsoftConfig();
  const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function exchangeMicrosoftCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  email: string;
  name: string | null;
}> {
  const { clientId, clientSecret, tenant, redirectUri } = microsoftConfig();
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: MICROSOFT_OAUTH_SCOPES.join(" "),
      }),
    },
  );
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Microsoft token exchange failed: ${tokenRes.status} ${body.slice(0, 200)}`);
  }
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token) throw new Error("Microsoft did not return an access token");

  const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) {
    throw new Error(`Microsoft profile fetch failed: ${profileRes.status}`);
  }
  const profile = (await profileRes.json()) as {
    mail?: string;
    userPrincipalName?: string;
    displayName?: string;
  };
  const email = (profile.mail || profile.userPrincipalName || "").trim().toLowerCase();
  if (!email) throw new Error("Microsoft account has no email");

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresIn: tokens.expires_in ?? 3600,
    email,
    name: profile.displayName ?? null,
  };
}

export async function refreshMicrosoftAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
  refreshToken?: string | null;
}> {
  const { clientId, clientSecret, tenant } = microsoftConfig();
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: MICROSOFT_OAUTH_SCOPES.join(" "),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Microsoft token refresh failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const tokens = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token) throw new Error("Microsoft refresh did not return access token");
  return {
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in ?? 3600,
    refreshToken: tokens.refresh_token ?? null,
  };
}

async function graphGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph ${path} failed: ${res.status} ${body.slice(0, 160)}`);
  }
  return res.json() as Promise<T>;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchOutlookMessages(
  accessToken: string,
  mailbox: string | null,
  limit = 40,
): Promise<MicrosoftRawRecord[]> {
  type Msg = {
    id?: string;
    subject?: string;
    bodyPreview?: string;
    body?: { contentType?: string; content?: string };
    from?: { emailAddress?: { name?: string; address?: string } };
    receivedDateTime?: string;
    webLink?: string;
  };
  const data = await graphGet<{ value?: Msg[] }>(
    accessToken,
    `/me/messages?$top=${limit}&$orderby=receivedDateTime desc&$select=id,subject,bodyPreview,body,from,receivedDateTime,webLink`,
  );
  return (data.value ?? []).map((m) => {
    const fromName = m.from?.emailAddress?.name ?? "";
    const fromAddr = m.from?.emailAddress?.address ?? "";
    const body =
      m.body?.contentType === "html"
        ? stripHtml(m.body.content ?? "")
        : (m.body?.content ?? m.bodyPreview ?? "");
    return {
      externalId: `outlook-${m.id ?? "unknown"}`,
      recordType: "outlook_message" as const,
      recordTitle: m.subject ?? "(no subject)",
      recordText: [
        mailbox ? `Mailbox: ${mailbox}` : null,
        fromAddr ? `From: ${fromName} <${fromAddr}>` : null,
        "",
        body.slice(0, 6000),
      ]
        .filter(Boolean)
        .join("\n"),
      sourceUrl: m.webLink ?? null,
      sourceCreatedAt: m.receivedDateTime ?? null,
      metadata: { fromAddress: fromAddr, fromName },
    };
  });
}

async function fetchTeamsChatMessages(
  accessToken: string,
  limit = 30,
): Promise<MicrosoftRawRecord[]> {
  type Chat = { id?: string; topic?: string; chatType?: string };
  type ChatMsg = {
    id?: string;
    createdDateTime?: string;
    body?: { content?: string };
    from?: { user?: { displayName?: string } };
    webUrl?: string;
  };

  const chats = await graphGet<{ value?: Chat[] }>(
    accessToken,
    `/me/chats?$top=10&$select=id,topic,chatType`,
  );
  const out: MicrosoftRawRecord[] = [];
  for (const chat of chats.value ?? []) {
    if (!chat.id) continue;
    try {
      const msgs = await graphGet<{ value?: ChatMsg[] }>(
        accessToken,
        `/me/chats/${encodeURIComponent(chat.id)}/messages?$top=8`,
      );
      for (const m of msgs.value ?? []) {
        if (!m.id) continue;
        const text = stripHtml(m.body?.content ?? "").slice(0, 4000);
        if (!text || text === "<systemEventMessage/>") continue;
        out.push({
          externalId: `teams-${chat.id}-${m.id}`,
          recordType: "teams_chat_message",
          recordTitle: chat.topic || `Teams ${chat.chatType ?? "chat"}`,
          recordText: [
            m.from?.user?.displayName ? `From: ${m.from.user.displayName}` : null,
            "",
            text,
          ]
            .filter(Boolean)
            .join("\n"),
          sourceUrl: m.webUrl ?? null,
          sourceCreatedAt: m.createdDateTime ?? null,
          metadata: { chatId: chat.id, chatType: chat.chatType },
        });
        if (out.length >= limit) return out;
      }
    } catch {
      // Chat.Read may be denied by tenant policy — skip quietly.
    }
  }
  return out;
}

/** Pull recent Outlook mail + Teams chat snippets for connector sync. */
export async function fetchMicrosoftBundle(
  accessToken: string,
  mailbox: string | null,
): Promise<MicrosoftRawRecord[]> {
  const [mail, teams] = await Promise.all([
    fetchOutlookMessages(accessToken, mailbox).catch(() => [] as MicrosoftRawRecord[]),
    fetchTeamsChatMessages(accessToken).catch(() => [] as MicrosoftRawRecord[]),
  ]);
  return [...mail, ...teams];
}

export const microsoftConnector: RecallConnector = {
  id: "microsoft",
  type: "microsoft",
  sourceOfTruth: "read_only_external",
  async normalize(records: unknown[]): Promise<NormalizedSourceRecord[]> {
    return (records as MicrosoftRawRecord[]).map((r) => ({
      externalId: r.externalId,
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
        claimType: "summary_based_on",
        evidenceText: record.recordText ?? null,
        sourceRecordExternalId: record.externalId,
        url: record.sourceUrl ?? null,
      },
    ];
  },
};
