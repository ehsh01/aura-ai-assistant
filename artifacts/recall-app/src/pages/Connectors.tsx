import React, { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import {
  createConnector,
  getFinanceSummary,
  getHomeyWebhookInfo,
  listConnectors,
  listFinanceSubscriptions,
  rotateHomeyWebhookSecret,
  startGoogleOAuth,
  startHomeyOAuth,
  startMicrosoftOAuth,
  syncConnector,
  testHomeyWebhook,
  type FinanceSummary,
} from "@/lib/recall-api";
import {
  createExtensionToken,
  listExtensionTokens,
  revokeExtensionToken,
  type ExtensionToken,
} from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import { readSearchParam } from "@/lib/recall-nav";

type ConnectorRow = {
  id: string;
  name: string;
  type: string;
  syncStatus: string;
  enabled: boolean;
};

const STATUS_STYLES: Record<string, string> = {
  connected: "text-emerald-300 bg-emerald-500/10",
  partial_success: "text-amber-300 bg-amber-500/10",
  sync_failed: "text-red-300 bg-red-500/10",
  disconnected: "text-white/50 bg-white/5",
};

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function Connectors() {
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [googleOAuthConfigured, setGoogleOAuthConfigured] = useState(false);
  const [microsoftOAuthConfigured, setMicrosoftOAuthConfigured] = useState(false);
  const [homeyOAuthConfigured, setHomeyOAuthConfigured] = useState(false);
  const [homeyWebhook, setHomeyWebhook] = useState<{
    connectorId: string;
    url: string;
    secret: string;
  } | null>(null);
  const [csvText, setCsvText] = useState("");
  const [ticketHost, setTicketHost] = useState("");
  const [ticketUser, setTicketUser] = useState("");
  const [ticketPassword, setTicketPassword] = useState("");
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ connectorId: string; data: FinanceSummary } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [subscriptions, setSubscriptions] = useState<
    {
      payee: string;
      occurrenceCount: number;
      avgAmountFormatted: string;
      lastDate: string;
      cadenceDays: number | null;
      confidence: string;
    }[]
  >([]);
  const [extensionTokens, setExtensionTokens] = useState<ExtensionToken[]>([]);
  const [creatingExtensionToken, setCreatingExtensionToken] = useState(false);
  const [newExtensionToken, setNewExtensionToken] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      void listFinanceSubscriptions()
        .then((r) => setSubscriptions(r.subscriptions))
        .catch(() => setSubscriptions([]));
      const res = await listConnectors();
      setConnectors(res.connectors);
      setGoogleOAuthConfigured(Boolean(res.googleOAuthConfigured));
      setMicrosoftOAuthConfigured(Boolean(res.microsoftOAuthConfigured));
      setHomeyOAuthConfigured(Boolean(res.homeyOAuthConfigured));
      const tokenRes = await listExtensionTokens().catch(() => null);
      if (tokenRes) setExtensionTokens(tokenRes.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const status = readSearchParam("google");
    if (!status) return;
    const reason = readSearchParam("reason");
    if (status === "connected") {
      toast({
        title: "Google connected",
        description: "Click Sync on the Google connector to pull mail, calendar, contacts, and Drive.",
      });
    } else if (status === "error") {
      const detail =
        reason === "already_connected"
          ? "That Google account is already linked."
          : reason === "not_configured"
            ? "Google OAuth is not configured on the server yet."
            : "Could not complete Google sign-in. Try again.";
      toast({ title: "Google connect failed", description: detail, variant: "destructive" });
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("google");
    url.searchParams.delete("reason");
    url.searchParams.delete("connectorId");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    void load();
  }, []);

  useEffect(() => {
    const status = readSearchParam("microsoft");
    if (!status) return;
    const reason = readSearchParam("reason");
    if (status === "connected") {
      toast({
        title: "Microsoft connected",
        description: "Click Sync to pull Outlook mail and Teams chat snippets.",
      });
    } else if (status === "error") {
      const detail =
        reason === "already_connected"
          ? "That Microsoft account is already linked."
          : reason === "not_configured"
            ? "Microsoft OAuth is not configured on the server yet."
            : "Could not complete Microsoft sign-in. Try again.";
      toast({ title: "Microsoft connect failed", description: detail, variant: "destructive" });
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("microsoft");
    url.searchParams.delete("reason");
    url.searchParams.delete("connectorId");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    void load();
  }, []);

  useEffect(() => {
    const status = readSearchParam("homey");
    if (!status) return;
    const reason = readSearchParam("reason");
    const connectorId = readSearchParam("connectorId");
    if (status === "connected") {
      toast({
        title: "Homey connected",
        description: "Sync devices, then copy the webhook URL into Homey Flows for important alerts.",
      });
      if (connectorId) {
        void getHomeyWebhookInfo(connectorId)
          .then((info) => setHomeyWebhook(info))
          .catch(() => undefined);
      }
    } else if (status === "error") {
      const detail =
        reason === "already_connected"
          ? "That Homey account is already linked."
          : reason === "not_configured"
            ? "Homey OAuth is not configured on the server yet."
            : "Could not complete Homey sign-in. Try again.";
      toast({ title: "Homey connect failed", description: detail, variant: "destructive" });
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("homey");
    url.searchParams.delete("reason");
    url.searchParams.delete("connectorId");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    void load();
  }, []);

  const addTicketEmailConnector = async () => {
    setCreatingTicket(true);
    try {
      await createConnector({
        name: `Ticket email · ${ticketUser || ticketHost}`,
        type: "ticket_email",
        description: "IMAP inbox for ticket notification emails.",
        settings: {
          host: ticketHost.trim(),
          user: ticketUser.trim(),
          password: ticketPassword,
          port: 993,
          secure: true,
          mailbox: "INBOX",
        },
      });
      setTicketPassword("");
      toast({
        title: "Ticket email connector added",
        description: "Click Sync to pull recent messages and parse ticket fields.",
      });
      await load();
    } catch (err) {
      toast({
        title: "Could not add ticket email connector",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setCreatingTicket(false);
    }
  };

  const runSync = async (connector: ConnectorRow) => {
    setSyncingId(connector.id);
    try {
      const res = await syncConnector(
        connector.id,
        connector.type === "csv_import" && csvText.trim() ? { csvText } : undefined,
      );
      toast({
        title: "Sync complete",
        description: `${connector.name}: ${res.result.recordsFetched ?? 0} fetched, ${
          res.result.recordsCreated ?? 0
        } new`,
      });
      await load();
      if (connector.type === "finance_api") await loadSummary(connector.id);
    } catch (err) {
      toast({
        title: "Sync failed",
        description: err instanceof Error ? err.message : "Could not sync connector",
        variant: "destructive",
      });
    } finally {
      setSyncingId(null);
    }
  };

  const loadSummary = async (connectorId: string) => {
    setSummaryLoading(true);
    try {
      const data = await getFinanceSummary(connectorId);
      setSummary({ connectorId, data });
    } catch (err) {
      toast({
        title: "Could not load spending summary",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSummaryLoading(false);
    }
  };

  const generateExtensionToken = async () => {
    setCreatingExtensionToken(true);
    try {
      const created = await createExtensionToken({
        name: "Recall browser extension",
        expiresInDays: 90,
      });
      setExtensionTokens((items) => [created.item, ...items]);
      setNewExtensionToken(created.token);
      try {
        await navigator.clipboard.writeText(created.token);
        toast({
          title: "Capture-only token copied",
          description: "Paste it into the Recall extension. It cannot access notes, Ask, or account data.",
        });
      } catch {
        toast({
          title: "Token created",
          description: "Copy the one-time token shown below.",
        });
      }
    } catch (err) {
      toast({
        title: "Could not create extension token",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setCreatingExtensionToken(false);
    }
  };

  const revokeToken = async (tokenId: string) => {
    try {
      await revokeExtensionToken(tokenId);
      setExtensionTokens((items) =>
        items.map((item) =>
          item.id === tokenId ? { ...item, revokedAt: new Date().toISOString() } : item,
        ),
      );
      toast({ title: "Extension token revoked" });
    } catch (err) {
      toast({
        title: "Could not revoke extension token",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const hasGoogle = connectors.some((c) => c.type === "google");
  const hasMicrosoft = connectors.some((c) => c.type === "microsoft");
  const homeyConnector = connectors.find((c) => c.type === "homey") ?? null;

  const showHomeyWebhook = async (connectorId: string) => {
    try {
      const info = await getHomeyWebhookInfo(connectorId);
      setHomeyWebhook(info);
      toast({ title: "Webhook details loaded", description: "Copy the URL and secret into Homey Flows." });
    } catch (err) {
      toast({
        title: "Could not load Homey webhook",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#0a0a0f] p-4 md:p-8 text-white">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">Integrations</p>
          <h1 className="mt-2 text-3xl font-semibold">Connectors</h1>
          <p className="mt-2 text-white/50">External sources feeding Recall with evidence-backed records.</p>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-lg font-semibold">Google</h2>
            <p className="mt-2 text-sm text-white/55">
              Connect one Google account to sync Gmail, Calendar, Contacts, and Drive (read-only).
              You can add another account later with the same button.
            </p>
            <button
              type="button"
              onClick={() => startGoogleOAuth()}
              disabled={!googleOAuthConfigured}
              className="mt-4 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {hasGoogle ? "Connect another Google account" : "Connect Google"}
            </button>
            {!googleOAuthConfigured && (
              <p className="mt-3 text-xs text-amber-200/80">
                Google OAuth is not configured on the server yet (needs GOOGLE_CLIENT_ID / SECRET).
              </p>
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-lg font-semibold">Microsoft (Outlook / Teams)</h2>
            <p className="mt-2 text-sm text-white/55">
              Optional Graph sync for Outlook mail and Teams chats (read-only). Browser extension
              capture still works without this when Graph is blocked by policy.
            </p>
            <button
              type="button"
              onClick={() => startMicrosoftOAuth()}
              disabled={!microsoftOAuthConfigured}
              className="mt-4 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {hasMicrosoft ? "Connect another Microsoft account" : "Connect Microsoft"}
            </button>
            {!microsoftOAuthConfigured && (
              <p className="mt-3 text-xs text-amber-200/80">
                Microsoft OAuth is not configured yet (needs MICROSOFT_CLIENT_ID / SECRET).
              </p>
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-lg font-semibold">Homey Pro</h2>
            <p className="mt-2 text-sm text-white/55">
              Connect Homey for Ask device status/control. Important alerts come from Homey Flows
              posting to a Recall webhook (door open too long, leak, smoke, etc.).
            </p>
            <button
              type="button"
              onClick={() => startHomeyOAuth()}
              disabled={!homeyOAuthConfigured}
              className="mt-4 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {homeyConnector ? "Reconnect Homey" : "Connect Homey"}
            </button>
            {!homeyOAuthConfigured && (
              <p className="mt-3 text-xs text-amber-200/80">
                Homey OAuth is not configured yet (needs HOMEY_CLIENT_ID / SECRET from Athom Developer Tools).
              </p>
            )}
            {homeyConnector && (
              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void showHomeyWebhook(homeyConnector.id)}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/5"
                  >
                    Show webhook
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const info = await rotateHomeyWebhookSecret(homeyConnector.id);
                        setHomeyWebhook(info);
                        toast({ title: "Webhook secret rotated" });
                      } catch (err) {
                        toast({
                          title: "Rotate failed",
                          description: err instanceof Error ? err.message : undefined,
                          variant: "destructive",
                        });
                      }
                    }}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/5"
                  >
                    Rotate secret
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await testHomeyWebhook(homeyConnector.id);
                        toast({
                          title: "Test alert sent",
                          description: "Check Today for “Recall Homey test alert”.",
                        });
                      } catch (err) {
                        toast({
                          title: "Test failed",
                          description: err instanceof Error ? err.message : undefined,
                          variant: "destructive",
                        });
                      }
                    }}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/5"
                  >
                    Send test alert
                  </button>
                </div>
                {homeyWebhook && homeyWebhook.connectorId === homeyConnector.id && (
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/70 space-y-2">
                    <p>
                      <span className="text-white/40">URL</span>
                      <br />
                      <code className="break-all text-emerald-200/90">{homeyWebhook.url}</code>
                    </p>
                    <p>
                      <span className="text-white/40">Secret (Authorization: Bearer …)</span>
                      <br />
                      <code className="break-all text-emerald-200/90">{homeyWebhook.secret}</code>
                    </p>
                    <p className="text-white/45">
                      Homey Flow: When [door open 5 min / smoke / leak] → Then HTTP POST JSON to the
                      URL with header Authorization: Bearer &lt;secret&gt;. Body example:{" "}
                      {`{"title":"Front door open","severity":"warn","kind":"door_open_too_long","deviceName":"Front door"}`}
                      . Full recipes are in docs/Homey_Flow_Cookbook.md.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-lg font-semibold">Ticket email (IMAP)</h2>
            <p className="mt-2 text-sm text-white/55">
              Pull ticket notification mail from an IMAP inbox and parse ticket number, priority,
              requester, and link.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <input
                value={ticketHost}
                onChange={(e) => setTicketHost(e.target.value)}
                placeholder="imap.example.com"
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
              />
              <input
                value={ticketUser}
                onChange={(e) => setTicketUser(e.target.value)}
                placeholder="tickets@example.com"
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
              />
              <input
                type="password"
                value={ticketPassword}
                onChange={(e) => setTicketPassword(e.target.value)}
                placeholder="IMAP password / app password"
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => void addTicketEmailConnector()}
              disabled={creatingTicket || !ticketHost.trim() || !ticketUser.trim() || !ticketPassword}
              className="mt-4 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {creatingTicket ? "Adding…" : "Add ticket email connector"}
            </button>
          </div>

          {loading && <p className="mt-8 text-white/40">Loading connectors…</p>}
          <div className="mt-8 space-y-3">
            {connectors.map((c) => (
              <article
                key={c.id}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 flex items-center justify-between gap-4"
              >
                <div>
                  <h2 className="font-semibold">{c.name}</h2>
                  <div className="mt-1 flex items-center gap-2 text-sm text-white/45">
                    <span>{c.type.replace(/_/g, " ")}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        STATUS_STYLES[c.syncStatus] ?? "text-white/50 bg-white/5"
                      }`}
                    >
                      {c.syncStatus.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {c.type === "finance_api" && (
                    <button
                      type="button"
                      onClick={() => void loadSummary(c.id)}
                      className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white/70 hover:bg-white/5"
                    >
                      Spending
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void runSync(c)}
                    disabled={syncingId === c.id}
                    className="rounded-xl bg-indigo-500/20 px-3 py-2 text-sm text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-50"
                  >
                    {syncingId === c.id ? "Syncing…" : "Sync"}
                  </button>
                </div>
              </article>
            ))}
          </div>

          {(summaryLoading || summary) && (
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="text-lg font-semibold">Spending summary</h2>
              {summaryLoading && (
                <p className="mt-3 text-white/40">Refreshing the synced finance snapshot…</p>
              )}
              {summary && !summaryLoading && (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-wider text-white/40">
                        Spent this month
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-red-300">
                        {formatUsd(summary.data.total)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-wider text-white/40">Transactions</p>
                      <p className="mt-1 text-2xl font-semibold">{summary.data.transactionCount}</p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-1.5">
                    {summary.data.transactions.slice(0, 10).map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-white/80">{tx.payee ?? "Unknown"}</p>
                          <p className="text-xs text-white/40">
                            {tx.date}
                            {tx.category ? ` · ${tx.category}` : ""}
                          </p>
                        </div>
                        <span className={tx.amount < 0 ? "text-red-300" : "text-emerald-300"}>
                          {formatUsd(tx.amount)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <p className="mt-4 border-t border-white/10 pt-3 text-xs text-white/40">
                    {summary.data.evidenceNote}
                  </p>
                  <p className="mt-2 text-xs text-white/35">
                    Spent means purchases and bills only — bank transfers and credit-card
                    payments are excluded so the same purchase is not counted twice.
                  </p>
                </>
              )}
            </div>
          )}

          {subscriptions.length > 0 && (
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="text-lg font-semibold">Likely subscriptions</h2>
              <p className="mt-1 text-sm text-white/45">
                Recurring expenses (~monthly) detected from synced transactions.
              </p>
              <ul className="mt-4 space-y-2">
                {subscriptions.slice(0, 12).map((s) => (
                  <li
                    key={s.payee}
                    className="flex items-center justify-between gap-3 text-sm text-white/75"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{s.payee}</p>
                      <p className="text-xs text-white/40">
                        {s.occurrenceCount}× · every ~{s.cadenceDays ?? "?"}d · last {s.lastDate} ·{" "}
                        {s.confidence}
                      </p>
                    </div>
                    <span className="shrink-0 text-white/60">{s.avgAmountFormatted}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm font-medium text-white/70">CSV import payload (for csv_import connectors)</p>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={6}
              placeholder="title,vendor,amount,date&#10;Drywall,ABC Drywall,4200,2025-05-12"
              className="mt-3 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm font-mono"
            />
          </div>

          <div className="mt-8 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5">
            <h2 className="text-lg font-semibold">Browser extension</h2>
            <p className="mt-2 text-sm text-white/55">
              Load the unpacked extension from <code className="text-indigo-200">artifacts/recall-extension</code>,
              then create and paste a capture-only token into the popup. The token cannot read your
              notes, Ask history, connectors, finances, or account settings.
            </p>
            <button
              type="button"
              onClick={() => void generateExtensionToken()}
              disabled={creatingExtensionToken}
              className="mt-4 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
            >
              {creatingExtensionToken ? "Creating…" : "Create and copy token"}
            </button>
            {newExtensionToken && (
              <div className="mt-4 rounded-xl border border-indigo-400/20 bg-black/20 p-3">
                <p className="text-xs text-indigo-200">
                  One-time token — copy it now. Recall cannot show it again.
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    readOnly
                    value={newExtensionToken}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white/70"
                  />
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(newExtensionToken)}
                    className="rounded-lg bg-white/10 px-3 text-xs hover:bg-white/15"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewExtensionToken(null)}
                    className="px-2 text-xs text-white/45 hover:text-white/70"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
            {extensionTokens.length > 0 && (
              <div className="mt-5 space-y-2 border-t border-white/10 pt-4">
                <p className="text-xs font-medium uppercase tracking-wider text-white/40">
                  Issued tokens
                </p>
                {extensionTokens.map((item) => {
                  const inactive =
                    Boolean(item.revokedAt) || new Date(item.expiresAt).getTime() <= Date.now();
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-black/15 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white/75">{item.name}</p>
                        <p className="text-xs text-white/40">
                          {inactive ? "Inactive" : `Expires ${new Date(item.expiresAt).toLocaleDateString()}`}
                        </p>
                      </div>
                      {!inactive && (
                        <button
                          type="button"
                          onClick={() => void revokeToken(item.id)}
                          className="text-xs text-red-300 hover:text-red-200"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
