import React, { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import {
  getFinanceSummary,
  listConnectors,
  startGoogleOAuth,
  syncConnector,
  type FinanceSummary,
} from "@/lib/recall-api";
import { getStoredToken } from "@/lib/auth-storage";
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
  const [csvText, setCsvText] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ connectorId: string; data: FinanceSummary } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listConnectors();
      setConnectors(res.connectors);
      setGoogleOAuthConfigured(Boolean(res.googleOAuthConfigured));
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

  const hasGoogle = connectors.some((c) => c.type === "google");

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
              {summaryLoading && <p className="mt-3 text-white/40">Loading from your finance app…</p>}
              {summary && !summaryLoading && (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-wider text-white/40">Net total</p>
                      <p
                        className={`mt-1 text-2xl font-semibold ${
                          summary.data.total < 0 ? "text-red-300" : "text-emerald-300"
                        }`}
                      >
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
                </>
              )}
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
              then paste your session token into the popup. One click captures the current tab into AI Inbox.
            </p>
            <button
              type="button"
              onClick={async () => {
                const token = getStoredToken();
                if (!token) {
                  toast({ title: "No session token found — sign in again", variant: "destructive" });
                  return;
                }
                try {
                  await navigator.clipboard.writeText(token);
                  toast({ title: "Extension token copied" });
                } catch {
                  toast({ title: "Could not copy token", variant: "destructive" });
                }
              }}
              className="mt-4 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
            >
              Copy extension token
            </button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
