import { Link, useLocation } from "wouter";
import {
  CalendarDays,
  CircleHelp,
  Diamond,
  Ellipsis,
  NotebookPen,
  Check,
  UserRound,
} from "lucide-react";

type Props = {
  onMore: () => void;
};

const topItems = [
  { href: "/today", label: "Today", icon: CalendarDays },
  { href: "/ask", label: "Ask", icon: CircleHelp },
  { href: "/inbox", label: "Inbox", icon: Diamond },
];

const workspaceItems = [
  { href: "/notes", label: "Notes", icon: NotebookPen },
  { href: "/tasks", label: "Tasks", icon: Check },
  { href: "/people", label: "People", icon: UserRound },
];

function isActive(location: string, href: string): boolean {
  if (href === "/today") {
    return location === "/" || location === "/today" || location.startsWith("/today/");
  }
  return location === href || location.startsWith(`${href}/`);
}

export function TodayDesktopSidebar({ onMore }: Props) {
  const [location] = useLocation();

  return (
    <aside className="hidden w-[164px] flex-shrink-0 flex-col border-r border-white/[0.055] bg-[#080c14] md:flex">
      <div className="px-[18px] pb-4 pt-5">
        <Link
          href="/today"
          className="text-[9px] font-semibold uppercase tracking-[0.25em] text-white/70 no-underline"
        >
          Recall
        </Link>
      </div>

      <nav className="space-y-1 px-2.5" aria-label="Primary">
        {topItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(location, href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex h-[30px] items-center gap-2.5 rounded-lg px-2.5 text-[11px] font-medium no-underline transition-colors ${
                active
                  ? "border border-white/[0.07] bg-white/[0.09] text-white/90"
                  : "text-white/42 hover:bg-white/[0.04] hover:text-white/70"
              }`}
            >
              <Icon size={11} strokeWidth={active ? 2.1 : 1.7} />
              {label}
            </Link>
          );
        })}
      </nav>

      <p className="px-[18px] pb-1.5 pt-5 text-[8px] font-semibold uppercase tracking-[0.09em] text-white/22">
        Workspace
      </p>
      <nav className="space-y-1 px-2.5" aria-label="Workspace">
        {workspaceItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex h-[30px] items-center gap-2.5 rounded-lg px-2.5 text-[11px] font-medium no-underline transition-colors ${
              isActive(location, href)
                ? "bg-white/[0.07] text-white/85"
                : "text-white/42 hover:bg-white/[0.04] hover:text-white/70"
            }`}
          >
            <Icon size={11} strokeWidth={1.7} />
            {label}
          </Link>
        ))}
        <button
          type="button"
          onClick={onMore}
          className="flex h-[30px] w-full items-center gap-2.5 rounded-lg px-2.5 text-[11px] font-medium text-white/42 transition-colors hover:bg-white/[0.04] hover:text-white/70"
        >
          <Ellipsis size={11} strokeWidth={1.7} />
          More
        </button>
      </nav>

      <div className="mt-auto px-[18px] pb-5 text-[8px] leading-[1.35] text-white/20">
        Views over one graph · not copies
      </div>
    </aside>
  );
}
