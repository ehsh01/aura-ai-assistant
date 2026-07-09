import React, { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { listConnectors, syncConnector } from "@/lib/recall-api";
import { toast } from "@/hooks/use-toast";

type ConnectorRow = {
  id: string;
  name: string;
  type: string;
  syncStatus: string;
  enabled: boolean;
};

export function Connectors() {
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [csvText, setCsvText] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listConnectors();
      setConnectors(res.connectors);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const runSync = async (connector: ConnectorRow) => {
    try {
      await syncConnector(
        connector.id,
        connector.type === "csv_import" && csvText.trim() ? { csvText } : undefined,
      );
      toast({ title: "Sync started", description: connector.name });
      await load();
    } catch (err) {
      toast({
        title: "Sync failed",
        description: err instanceof Error ? err.message : "Could not sync connector",
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

          {loading && <p className="mt-8 text-white/40">Loading connectors…</p>}
          <div className="mt-8 space-y-3">
            {connectors.map((c) => (
              <article key={c.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold">{c.name}</h2>
                  <p className="text-sm text-white/45">{c.type} · {c.syncStatus}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void runSync(c)}
                  className="rounded-xl bg-indigo-500/20 px-3 py-2 text-sm text-indigo-200 hover:bg-indigo-500/30"
                >
                  Sync
                </button>
              </article>
            ))}
          </div>

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
        </div>
      </div>
    </AppLayout>
  );
}
