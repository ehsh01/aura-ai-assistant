import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Hourglass, Target } from "lucide-react";
import type { DailyBriefing, FocusNow, WaitingItem } from "@/lib/home-briefing";
import { peoplePath } from "@/lib/recall-nav";

export type MorningAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  kind: "focus" | "waiting" | "critical" | "suggested";
};

type Props = {
  focus: FocusNow | null;
  waiting: WaitingItem[];
  briefing: DailyBriefing;
};

function buildActions(
  focus: FocusNow | null,
  waiting: WaitingItem[],
  briefing: DailyBriefing,
): MorningAction[] {
  const out: MorningAction[] = [];
  const seen = new Set<string>();

  const push = (a: MorningAction) => {
    if (seen.has(a.id) || seen.has(a.href + a.label)) return;
    seen.add(a.id);
    seen.add(a.href + a.label);
    out.push(a);
  };

  if (focus) {
    push({
      id: `focus:${focus.href}`,
      label: focus.title,
      detail: focus.actionLabel,
      href: focus.href,
      kind: "focus",
    });
  }

  for (const w of waiting.slice(0, 2)) {
    push({
      id: `wait:${w.id}`,
      label: `Follow up with ${w.person}`,
      detail: w.item,
      href: w.personId ? peoplePath({ personId: w.personId }) : w.href,
      kind: "waiting",
    });
  }

  for (const c of briefing.critical.slice(0, 2)) {
    push({
      id: `crit:${c.id}`,
      label: c.label,
      detail: "Needs attention",
      href: c.href,
      kind: "critical",
    });
  }

  if (briefing.suggestedAction) {
    push({
      id: `sug:${briefing.suggestedAction.href}`,
      label: briefing.suggestedAction.label,
      detail: "Suggested",
      href: briefing.suggestedAction.href,
      kind: "suggested",
    });
  }

  return out.slice(0, 3);
}

const KIND_ICON = {
  focus: Target,
  waiting: Hourglass,
  critical: CheckCircle2,
  suggested: ArrowRight,
} as const;

export function MorningActions({ focus, waiting, briefing }: Props) {
  const actions = buildActions(focus, waiting, briefing);
  if (actions.length === 0) return null;

  return (
    <section aria-label="Top actions">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
          Start here
        </h2>
        <span className="text-[11px] text-white/30">{actions.length} next</span>
      </div>
      <ol className="space-y-2">
        {actions.map((action, i) => {
          const Icon = KIND_ICON[action.kind];
          return (
            <li key={action.id}>
              <Link
                href={action.href}
                className="nebula-glass group flex items-center gap-3 rounded-2xl px-4 py-3 no-underline transition-colors hover:bg-white/[0.04]"
              >
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-xs font-semibold text-indigo-200">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white/90">{action.label}</p>
                  <p className="truncate text-xs text-white/40">{action.detail}</p>
                </div>
                <Icon
                  size={16}
                  className="flex-shrink-0 text-white/25 transition-colors group-hover:text-indigo-300"
                />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
