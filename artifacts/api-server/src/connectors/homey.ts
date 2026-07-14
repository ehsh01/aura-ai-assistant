import { createHash, randomBytes } from "node:crypto";
import type { EvidenceInput, NormalizedSourceRecord, RecallConnector } from "./types";

/**
 * Athom Homey Web API OAuth + Homey session helpers.
 * @see https://api.developer.homey.app/http-and-socket.io/http-specification
 */

export type HomeyRawRecord = {
  externalId: string;
  recordType: "homey_device" | "homey_flow" | "homey_alert";
  recordTitle: string;
  recordText: string;
  sourceUrl?: string | null;
  sourceCreatedAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type HomeyDeviceSummary = {
  id: string;
  name: string;
  zoneName: string | null;
  className: string | null;
  capabilities: string[];
  /** capabilityId → current value (best-effort) */
  values: Record<string, unknown>;
};

export type HomeyFlowSummary = {
  id: string;
  name: string;
  enabled: boolean;
};

export type HomeyAlertSeverity = "info" | "warn" | "emergency";

export type HomeyAlertPayload = {
  title: string;
  message?: string | null;
  severity?: HomeyAlertSeverity | string | null;
  deviceName?: string | null;
  kind?: string | null;
  homeyDeviceId?: string | null;
};

function homeyConfig() {
  const clientId = process.env.HOMEY_CLIENT_ID?.trim();
  const clientSecret = process.env.HOMEY_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.HOMEY_OAUTH_REDIRECT_URI?.trim() ||
    "https://recall-app.net/api/connectors/homey/oauth/callback";
  if (!clientId || !clientSecret) {
    const err = new Error(
      "HOMEY_CLIENT_ID and HOMEY_CLIENT_SECRET are not configured",
    ) as Error & { status?: number };
    err.status = 503;
    throw err;
  }
  return { clientId, clientSecret, redirectUri };
}

export function isHomeyOAuthConfigured(): boolean {
  return Boolean(
    process.env.HOMEY_CLIENT_ID?.trim() && process.env.HOMEY_CLIENT_SECRET?.trim(),
  );
}

export function generateHomeyWebhookSecret(): string {
  return `hwk_${randomBytes(24).toString("base64url")}`;
}

function webhookSecretHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function verifyHomeyWebhookSecret(
  provided: string | null | undefined,
  expectedPlainOrHash: string | null | undefined,
): boolean {
  if (!provided || !expectedPlainOrHash) return false;
  const providedHash = webhookSecretHash(provided.trim());
  const expected = expectedPlainOrHash.trim();
  // Settings may store plain secret (sealed) or a hash for compare-only fields.
  if (expected === provided.trim()) return true;
  if (expected === providedHash) return true;
  if (webhookSecretHash(expected) === providedHash) return true;
  return false;
}

export function buildHomeyAuthUrl(state: string): string {
  const { clientId, redirectUri } = homeyConfig();
  // Athom's JS SDK + accounts.athom.com expect standard OAuth `response_type=code`.
  // Docs mention `authorization_type`, but that yields: response_type Invalid value.
  const url = new URL("https://api.athom.com/oauth2/authorise");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export async function exchangeHomeyCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  email: string;
  name: string | null;
  homeyId: string | null;
  homeyName: string | null;
  remoteUrl: string | null;
}> {
  const { clientId, clientSecret } = homeyConfig();
  const tokenRes = await fetch("https://api.athom.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(clientId, clientSecret),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      // Official Athom SDK uses `code` (docs sometimes say authorization_code).
      code,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Homey token exchange failed: ${tokenRes.status} ${body.slice(0, 200)}`);
  }
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token?: string;
  };
  const accessToken = tokens.access_token ?? tokens.token;
  if (!accessToken) throw new Error("Homey did not return an access token");

  const profile = await athomGet<{
    email?: string;
    firstname?: string;
    lastname?: string;
    homeys?: Array<{
      id?: string;
      name?: string;
      remoteUrl?: string;
      localUrl?: string;
      localUrlSecure?: string;
    }>;
  }>(accessToken, "/user/me");

  const email = (profile.email ?? "").trim().toLowerCase() || "homey-user";
  const name = [profile.firstname, profile.lastname].filter(Boolean).join(" ").trim() || null;
  const homey = profile.homeys?.[0] ?? null;

  return {
    accessToken,
    refreshToken: tokens.refresh_token ?? null,
    // Athom tokens are often long-lived; treat missing expiry as 30 days.
    expiresIn: tokens.expires_in ?? 30 * 24 * 3600,
    email,
    name,
    homeyId: homey?.id ?? null,
    homeyName: homey?.name ?? null,
    remoteUrl: homey?.remoteUrl ?? null,
  };
}

export async function refreshHomeyAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
  refreshToken?: string | null;
}> {
  const { clientId, clientSecret } = homeyConfig();
  const res = await fetch("https://api.athom.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(clientId, clientSecret),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Homey token refresh failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const tokens = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token?: string;
  };
  const accessToken = tokens.access_token ?? tokens.token;
  if (!accessToken) throw new Error("Homey refresh did not return access token");
  return {
    accessToken,
    expiresIn: tokens.expires_in ?? 30 * 24 * 3600,
    refreshToken: tokens.refresh_token ?? null,
  };
}

async function athomGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`https://api.athom.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Athom ${path} failed: ${res.status} ${body.slice(0, 160)}`);
  }
  return res.json() as Promise<T>;
}

async function getDelegationToken(accessToken: string): Promise<string> {
  const res = await fetch("https://api.athom.com/delegation/token?audience=homey", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Homey delegation token failed: ${res.status} ${body.slice(0, 160)}`);
  }
  // API may return raw JWT string or JSON { token }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await res.json()) as { token?: string };
    if (typeof json.token === "string" && json.token) return json.token;
    throw new Error("Homey delegation response missing token");
  }
  const text = (await res.text()).trim().replace(/^"|"$/g, "");
  if (!text) throw new Error("Homey delegation response empty");
  return text;
}

async function createHomeySession(
  remoteUrl: string,
  delegationToken: string,
): Promise<string> {
  const base = remoteUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/api/manager/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: delegationToken }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Homey session login failed: ${res.status} ${body.slice(0, 160)}`);
  }
  const json = (await res.json()) as { token?: string } | string;
  if (typeof json === "string" && json) return json;
  if (typeof json === "object" && typeof json.token === "string") return json.token;
  throw new Error("Homey session response missing token");
}

async function resolveHomeyRemoteUrl(
  accessToken: string,
  preferredHomeyId?: string | null,
): Promise<{ homeyId: string; homeyName: string | null; remoteUrl: string }> {
  const profile = await athomGet<{
    homeys?: Array<{
      id?: string;
      name?: string;
      remoteUrl?: string;
    }>;
  }>(accessToken, "/user/me");
  const list = profile.homeys ?? [];
  const match =
    (preferredHomeyId
      ? list.find((h) => h.id === preferredHomeyId)
      : null) ?? list[0];
  if (!match?.id || !match.remoteUrl) {
    throw new Error("No Homey with remote URL found on this Athom account");
  }
  return {
    homeyId: match.id,
    homeyName: match.name ?? null,
    remoteUrl: match.remoteUrl,
  };
}

/** Authenticate to Athom + Homey and return a session for API calls. */
export async function openHomeyApiSession(input: {
  accessToken: string;
  homeyId?: string | null;
  remoteUrl?: string | null;
}): Promise<{
  baseUrl: string;
  sessionToken: string;
  homeyId: string;
  homeyName: string | null;
}> {
  const resolved =
    input.remoteUrl && input.homeyId
      ? {
          homeyId: input.homeyId,
          homeyName: null as string | null,
          remoteUrl: input.remoteUrl,
        }
      : await resolveHomeyRemoteUrl(input.accessToken, input.homeyId);
  const delegation = await getDelegationToken(input.accessToken);
  const sessionToken = await createHomeySession(resolved.remoteUrl, delegation);
  return {
    baseUrl: resolved.remoteUrl.replace(/\/$/, ""),
    sessionToken,
    homeyId: resolved.homeyId,
    homeyName: resolved.homeyName,
  };
}

async function homeyGet<T>(baseUrl: string, sessionToken: string, path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Homey ${path} failed: ${res.status} ${body.slice(0, 160)}`);
  }
  return res.json() as Promise<T>;
}

async function homeyPut(
  baseUrl: string,
  sessionToken: string,
  path: string,
  body: unknown,
): Promise<void> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Homey PUT ${path} failed: ${res.status} ${text.slice(0, 160)}`);
  }
}

async function homeyPost(
  baseUrl: string,
  sessionToken: string,
  path: string,
  body?: unknown,
): Promise<void> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Homey POST ${path} failed: ${res.status} ${text.slice(0, 160)}`);
  }
}

type HomeyDeviceApi = {
  id?: string;
  name?: string;
  zoneName?: string;
  class?: string;
  capabilities?: string[];
  capabilitiesObj?: Record<string, { value?: unknown }>;
};

type HomeyZoneApi = { id?: string; name?: string };

function deviceToSummary(
  d: HomeyDeviceApi,
  zones: Map<string, string>,
): HomeyDeviceSummary | null {
  const id = d.id;
  if (!id) return null;
  const values: Record<string, unknown> = {};
  for (const [cap, obj] of Object.entries(d.capabilitiesObj ?? {})) {
    if (obj && "value" in obj) values[cap] = obj.value;
  }
  const zoneId =
    typeof (d as { zone?: string }).zone === "string"
      ? (d as { zone?: string }).zone!
      : null;
  return {
    id,
    name: d.name ?? id,
    zoneName: d.zoneName ?? (zoneId ? zones.get(zoneId) ?? null : null),
    className: d.class ?? null,
    capabilities: d.capabilities ?? Object.keys(d.capabilitiesObj ?? {}),
    values,
  };
}

export async function listHomeyDevices(
  baseUrl: string,
  sessionToken: string,
): Promise<HomeyDeviceSummary[]> {
  const [devicesRaw, zonesRaw] = await Promise.all([
    homeyGet<Record<string, HomeyDeviceApi> | HomeyDeviceApi[]>(
      baseUrl,
      sessionToken,
      "/api/manager/devices/device",
    ),
    homeyGet<Record<string, HomeyZoneApi> | HomeyZoneApi[]>(
      baseUrl,
      sessionToken,
      "/api/manager/zones/zone",
    ).catch(() => ({})),
  ]);

  const zones = new Map<string, string>();
  const zoneList = Array.isArray(zonesRaw) ? zonesRaw : Object.values(zonesRaw ?? {});
  for (const z of zoneList) {
    if (z?.id && z.name) zones.set(z.id, z.name);
  }

  const list = Array.isArray(devicesRaw) ? devicesRaw : Object.values(devicesRaw ?? {});
  return list
    .map((d) => deviceToSummary(d, zones))
    .filter((d): d is HomeyDeviceSummary => Boolean(d));
}

export async function listHomeyFlows(
  baseUrl: string,
  sessionToken: string,
): Promise<HomeyFlowSummary[]> {
  const raw = await homeyGet<
    Record<string, { id?: string; name?: string; enabled?: boolean }> | Array<{
      id?: string;
      name?: string;
      enabled?: boolean;
    }>
  >(baseUrl, sessionToken, "/api/manager/flow/flow").catch(() => ({}));
  const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return list
    .filter((f) => f?.id && f.name)
    .map((f) => ({
      id: f.id!,
      name: f.name!,
      enabled: f.enabled !== false,
    }));
}

export async function getHomeyCapabilityValue(
  baseUrl: string,
  sessionToken: string,
  deviceId: string,
  capabilityId: string,
): Promise<unknown> {
  return homeyGet(
    baseUrl,
    sessionToken,
    `/api/manager/devices/device/${encodeURIComponent(deviceId)}/capability/${encodeURIComponent(capabilityId)}`,
  );
}

export async function setHomeyCapabilityValue(
  baseUrl: string,
  sessionToken: string,
  deviceId: string,
  capabilityId: string,
  value: string | number | boolean,
): Promise<void> {
  await homeyPut(
    baseUrl,
    sessionToken,
    `/api/manager/devices/device/${encodeURIComponent(deviceId)}/capability/${encodeURIComponent(capabilityId)}`,
    { value },
  );
}

export async function triggerHomeyFlow(
  baseUrl: string,
  sessionToken: string,
  flowId: string,
): Promise<void> {
  await homeyPost(
    baseUrl,
    sessionToken,
    `/api/manager/flow/flow/${encodeURIComponent(flowId)}/trigger`,
    {},
  );
}

function formatCapabilityValues(values: Record<string, unknown>): string {
  return Object.entries(values)
    .slice(0, 24)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join("; ");
}

/** Sync inventory: devices + named Flows for Ask resolution. */
export async function fetchHomeyBundle(
  accessToken: string,
  opts?: { homeyId?: string | null; remoteUrl?: string | null },
): Promise<HomeyRawRecord[]> {
  const session = await openHomeyApiSession({
    accessToken,
    homeyId: opts?.homeyId,
    remoteUrl: opts?.remoteUrl,
  });
  const [devices, flows] = await Promise.all([
    listHomeyDevices(session.baseUrl, session.sessionToken),
    listHomeyFlows(session.baseUrl, session.sessionToken).catch(() => [] as HomeyFlowSummary[]),
  ]);

  const now = new Date().toISOString();
  const deviceRecords: HomeyRawRecord[] = devices.map((d) => ({
    externalId: `homey-device:${d.id}`,
    recordType: "homey_device",
    recordTitle: d.name,
    recordText: [
      "homey smart home device source=homey_device",
      `name: ${d.name}`,
      d.zoneName ? `zone: ${d.zoneName}` : null,
      d.className ? `class: ${d.className}` : null,
      d.capabilities.length ? `capabilities: ${d.capabilities.join(", ")}` : null,
      Object.keys(d.values).length
        ? `state: ${formatCapabilityValues(d.values)}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
    sourceCreatedAt: now,
    metadata: {
      homeyDeviceId: d.id,
      zoneName: d.zoneName,
      className: d.className,
      capabilities: d.capabilities,
      values: d.values,
      homeyId: session.homeyId,
    },
  }));

  const flowRecords: HomeyRawRecord[] = flows.map((f) => ({
    externalId: `homey-flow:${f.id}`,
    recordType: "homey_flow",
    recordTitle: f.name,
    recordText: [
      "homey smart home flow automation source=homey_flow",
      `name: ${f.name}`,
      `enabled: ${f.enabled}`,
    ].join("\n"),
    sourceCreatedAt: now,
    metadata: {
      homeyFlowId: f.id,
      enabled: f.enabled,
      homeyId: session.homeyId,
    },
  }));

  return [...deviceRecords, ...flowRecords];
}

export function normalizeHomeyAlert(
  payload: HomeyAlertPayload,
  opts?: { connectorId?: string },
): HomeyRawRecord {
  const severity = normalizeSeverity(payload.severity);
  const kind = (payload.kind ?? "other").toString().trim().toLowerCase() || "other";
  const title = (payload.title || "Homey alert").trim().slice(0, 400);
  const message = (payload.message ?? "").toString().trim();
  const deviceName = (payload.deviceName ?? "").toString().trim();
  const now = new Date();
  const stamp = now.toISOString();
  const externalId = `homey-alert:${opts?.connectorId ?? "x"}:${severity}:${kind}:${deviceName || title}:${Math.floor(now.getTime() / 60_000)}`;

  return {
    externalId,
    recordType: "homey_alert",
    recordTitle: title,
    recordText: [
      "homey smart home alert notification source=homey_alert",
      `severity: ${severity}`,
      `kind: ${kind}`,
      deviceName ? `device: ${deviceName}` : null,
      payload.homeyDeviceId ? `homeyDeviceId: ${payload.homeyDeviceId}` : null,
      message ? `message: ${message}` : null,
      `Date: ${stamp}`,
    ]
      .filter(Boolean)
      .join("\n"),
    sourceCreatedAt: stamp,
    metadata: {
      severity,
      kind,
      deviceName: deviceName || null,
      homeyDeviceId: payload.homeyDeviceId ?? null,
      acknowledgedAt: null,
    },
  };
}

export function normalizeSeverity(value: unknown): HomeyAlertSeverity {
  const s = String(value ?? "warn").toLowerCase();
  if (s === "emergency" || s === "critical" || s === "alarm") return "emergency";
  if (s === "info" || s === "low") return "info";
  return "warn";
}

/** Capabilities that should require Ask confirmation before write. */
export function isRiskyHomeyCapability(capabilityId: string): boolean {
  return /^(locked|lock_state|alarm_|homealarm|garagedoor_closed)/i.test(capabilityId);
}

export const homeyConnector: RecallConnector = {
  id: "homey",
  type: "homey",
  sourceOfTruth: "bidirectional",
  async normalize(records: unknown[]): Promise<NormalizedSourceRecord[]> {
    return (records as HomeyRawRecord[]).map((r) => ({
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
