import { Link } from "wouter";
import { Wallet } from "lucide-react";

type FinanceSnapshot = {
  total: number;
  transactionCount: number;
  rangeLabel: string;
  topPayee: { payee: string; total: number } | null;
  href: string;
  needsSync: boolean;
};

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function FinanceSnapshotCard({ finance }: { finance: FinanceSnapshot | null }) {
  if (!finance) return null;

  return (
    <Link
      href={finance.href}
      className="nebula-glass block rounded-2xl border border-emerald-500/15 px-5 py-4 no-underline transition-colors hover:border-emerald-500/30"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
          <Wallet size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-300/70">
            Spending · {finance.rangeLabel}
          </p>
          {finance.needsSync ? (
            <p className="mt-1 text-sm text-white/60">
              Finance connected — sync once on Connectors to see this month&apos;s total.
            </p>
          ) : (
            <>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-300">
                {formatUsd(Math.abs(finance.total))}
              </p>
              <p className="mt-1 text-sm text-white/45">
                {finance.transactionCount} transaction{finance.transactionCount === 1 ? "" : "s"}
                {finance.topPayee
                  ? ` · top: ${finance.topPayee.payee} (${formatUsd(finance.topPayee.total)})`
                  : ""}
              </p>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
