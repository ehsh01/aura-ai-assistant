import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Hourglass } from "lucide-react";
import type { WaitingItem } from "@/lib/home-briefing";
import { createWaitingFollowUp } from "@/lib/recall-api";
import { peoplePath } from "@/lib/recall-nav";
import { toast } from "@/hooks/use-toast";

type Props = {
  items: WaitingItem[];
};

function waitLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function WaitingOnSection({ items }: Props) {
  const [, navigate] = useLocation();
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const followUp = async (item: WaitingItem) => {
    if (creatingId) return;
    setCreatingId(item.id);
    try {
      const res = await createWaitingFollowUp(item.id);
      toast({ title: "Follow-up task created", description: res.task.title });
      navigate(`/tasks?task=${encodeURIComponent(res.task.id)}`);
    } catch (err) {
      toast({
        title: "Could not create follow-up",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setCreatingId(null);
    }
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3 px-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/50">
          <Hourglass className="h-4 w-4 text-sky-400" /> Waiting on
        </h2>
        <Link href={peoplePath()} className="text-xs text-indigo-300 no-underline hover:underline">
          All people
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="nebula-glass rounded-2xl p-4 text-sm text-white/40">
          You&apos;re not waiting on anyone right now.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="nebula-glass flex items-center gap-3 rounded-2xl p-4"
            >
              <Link
                href={
                  item.personId
                    ? peoplePath({ personId: item.personId })
                    : item.href
                }
                className="flex min-w-0 flex-1 items-center gap-4 no-underline"
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
              </Link>
              <button
                type="button"
                onClick={() => void followUp(item)}
                disabled={creatingId === item.id}
                className="flex-shrink-0 rounded-full bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
              >
                {creatingId === item.id ? "…" : "Follow up"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
