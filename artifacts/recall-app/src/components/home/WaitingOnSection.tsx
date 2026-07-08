import { Link } from "wouter";
import { Hourglass, ArrowUpRight } from "lucide-react";
import type { WaitingItem } from "@/lib/home-briefing";

type Props = {
  items: WaitingItem[];
};

function waitLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function WaitingOnSection({ items }: Props) {
  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 px-1 text-sm font-semibold uppercase tracking-wider text-white/50">
        <Hourglass className="h-4 w-4 text-sky-400" /> Waiting on
      </h2>

      {items.length === 0 ? (
        <div className="nebula-glass rounded-2xl p-4 text-sm text-white/40">
          You&apos;re not waiting on anyone right now.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="nebula-glass group flex items-center gap-4 rounded-2xl p-4 no-underline transition-transform hover:translate-x-0.5"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sm font-semibold text-sky-300">
                {item.person.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-100">
                  {item.person} <span className="text-white/40">·</span>{" "}
                  <span className="font-normal text-zinc-300">{item.item}</span>
                </p>
                <p className="text-xs text-white/40">Waiting {waitLabel(item.days)}</p>
              </div>
              <span className="flex flex-shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-indigo-200 transition-colors group-hover:border-indigo-400/30 group-hover:bg-indigo-500/15">
                {item.followUp}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
