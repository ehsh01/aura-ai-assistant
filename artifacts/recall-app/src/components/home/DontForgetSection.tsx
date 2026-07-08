import { Link } from "wouter";
import { Pin } from "lucide-react";
import type { BriefingItem } from "@/lib/home-briefing";

type Props = {
  items: BriefingItem[];
};

export function DontForgetSection({ items }: Props) {
  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 px-1 text-sm font-semibold uppercase tracking-wider text-white/50">
        <Pin className="h-4 w-4 text-violet-400" /> Don&apos;t forget
      </h2>

      {items.length === 0 ? (
        <div className="nebula-glass rounded-2xl p-4 text-sm text-white/40">
          Nothing slipping through the cracks.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="nebula-glass rounded-full px-4 py-2 text-sm text-zinc-200 no-underline transition-transform hover:-translate-y-0.5"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
