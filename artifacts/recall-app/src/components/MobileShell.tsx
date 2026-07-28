import React from "react";
import { Link } from "wouter";
import {
  Brain,
  Cable,
  CalendarClock,
  CheckSquare,
  FileText,
  FolderKanban,
  Hourglass,
  Inbox,
  LayoutGrid,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  Sparkles,
  Users,
  Car,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { notesPath } from "@/lib/recall-nav";

type TabItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  match: (path: string) => boolean;
};

const primaryTabs: TabItem[] = [
  {
    href: "/",
    label: "Today",
    icon: <LayoutGrid size={22} strokeWidth={1.8} />,
    match: (path) => path === "/" || path === "/today",
  },
  {
    href: "/ask",
    label: "Ask",
    icon: <Sparkles size={22} strokeWidth={1.8} />,
    match: (path) => path === "/ask",
  },
  {
    href: "/inbox",
    label: "Inbox",
    icon: <Inbox size={22} strokeWidth={1.8} />,
    match: (path) => path === "/inbox",
  },
];

type MobileBottomNavProps = {
  location: string;
  onCapture: () => void;
  onOpenMore: () => void;
  moreActive: boolean;
  queuedCaptures?: number;
};

export function MobileBottomNav({
  location,
  onCapture,
  onOpenMore,
  moreActive,
  queuedCaptures = 0,
}: MobileBottomNavProps) {
  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-[#0a0a0f]/95 backdrop-blur-xl recall-safe-bottom"
      aria-label="Main navigation"
    >
      <div className="grid grid-cols-5 items-end px-1 pt-1 pb-2">
        {primaryTabs.slice(0, 2).map((tab) => {
          const active = tab.match(location);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-col items-center justify-center gap-1 py-2 no-underline"
            >
              <span className={active ? "text-indigo-400" : "text-white/40"}>
                {tab.icon}
              </span>
              <span
                className={`text-[10px] font-medium ${active ? "text-indigo-300" : "text-white/40"}`}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}

        <div className="relative flex flex-col items-center justify-end pb-1">
          <button
            type="button"
            onClick={onCapture}
            className="flex h-14 w-14 -translate-y-3 items-center justify-center rounded-full bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 active:scale-95 transition-transform"
            aria-label={
              queuedCaptures > 0
                ? `Capture (${queuedCaptures} waiting to sync)`
                : "Capture"
            }
          >
            <Plus size={26} strokeWidth={2.2} />
          </button>
          {queuedCaptures > 0 && (
            <span className="absolute right-2 top-0 flex h-5 min-w-5 -translate-y-1 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-black tabular-nums">
              {queuedCaptures > 9 ? "9+" : queuedCaptures}
            </span>
          )}
        </div>

        <Link
          href={primaryTabs[2]!.href}
          className="flex flex-col items-center justify-center gap-1 py-2 no-underline"
        >
          <span className={primaryTabs[2]!.match(location) ? "text-indigo-400" : "text-white/40"}>
            {primaryTabs[2]!.icon}
          </span>
          <span
            className={`text-[10px] font-medium ${primaryTabs[2]!.match(location) ? "text-indigo-300" : "text-white/40"}`}
          >
            {primaryTabs[2]!.label}
          </span>
        </Link>

        <button
          type="button"
          onClick={onOpenMore}
          className="flex flex-col items-center justify-center gap-1 py-2"
          aria-label="More"
        >
          <span className={moreActive ? "text-indigo-400" : "text-white/40"}>
            <Menu size={22} strokeWidth={1.8} />
          </span>
          <span
            className={`text-[10px] font-medium ${moreActive ? "text-indigo-300" : "text-white/40"}`}
          >
            More
          </span>
        </button>
      </div>
    </nav>
  );
}

type MobileMoreSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: string;
  userName?: string;
  userEmail?: string;
  userInitial: string;
  onCapture: () => void;
  onLogout: () => void;
};

export function MobileMoreSheet({
  open,
  onOpenChange,
  location,
  userName,
  userEmail,
  userInitial,
  onCapture,
  onLogout,
}: MobileMoreSheetProps) {
  const close = () => onOpenChange(false);

  const linkClass = (active: boolean) =>
    `flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left no-underline transition-colors ${
      active
        ? "bg-indigo-500/15 text-indigo-200"
        : "text-white/70 hover:bg-white/[0.05]"
    }`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl border-white/10 bg-[#101018] text-white recall-safe-bottom max-h-[85dvh] overflow-y-auto"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-white">More</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-1">
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
            Ask
          </p>
          <Link href="/" onClick={close} className={linkClass(location === "/" || location === "/today")}>
            <LayoutGrid size={18} />
            <span className="flex-1 text-sm font-medium">Today</span>
          </Link>
          <Link href="/ask" onClick={close} className={linkClass(location === "/ask")}>
            <Sparkles size={18} />
            <span className="flex-1 text-sm font-medium">Ask Aura</span>
          </Link>
          <Link href="/deadlines" onClick={close} className={linkClass(location === "/deadlines")}>
            <CalendarClock size={18} />
            <span className="flex-1 text-sm font-medium">Deadlines</span>
          </Link>
          <Link
            href="/waiting"
            onClick={close}
            className={linkClass(location === "/waiting" || location.startsWith("/waiting/"))}
          >
            <Hourglass size={18} />
            <span className="flex-1 text-sm font-medium">Waiting</span>
          </Link>

          <p className="px-1 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
            Organize
          </p>
          <Link href={notesPath()} onClick={close} className={linkClass(location === "/notes")}>
            <Search size={18} />
            <span className="flex-1 text-sm font-medium">Notes</span>
          </Link>
          <Link href="/memory" onClick={close} className={linkClass(location === "/memory")}>
            <Brain size={18} />
            <span className="flex-1 text-sm font-medium">Life Memory</span>
          </Link>
          <Link href="/documents" onClick={close} className={linkClass(location === "/documents")}>
            <FileText size={18} />
            <span className="flex-1 text-sm font-medium">Documents</span>
          </Link>
          <Link href="/people" onClick={close} className={linkClass(location === "/people")}>
            <Users size={18} />
            <span className="flex-1 text-sm font-medium">People</span>
          </Link>
          <Link href="/vehicles" onClick={close} className={linkClass(location === "/vehicles")}>
            <Car size={18} />
            <span className="flex-1 text-sm font-medium">Home & vehicles</span>
          </Link>
          <Link href="/projects" onClick={close} className={linkClass(location === "/projects" || location.startsWith("/projects/"))}>
            <FolderKanban size={18} />
            <span className="flex-1 text-sm font-medium">Projects</span>
          </Link>
          <Link href="/tasks" onClick={close} className={linkClass(location === "/tasks")}>
            <CheckSquare size={18} />
            <span className="flex-1 text-sm font-medium">Tasks</span>
          </Link>

          <p className="px-1 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
            System
          </p>
          <Link href="/connectors" onClick={close} className={linkClass(location === "/connectors")}>
            <Cable size={18} />
            <span className="flex-1 text-sm font-medium">Connectors</span>
          </Link>
          <Link href="/settings" onClick={close} className={linkClass(location === "/settings")}>
            <Settings size={18} />
            <span className="flex-1 text-sm font-medium">Settings</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              close();
              onCapture();
            }}
            className={linkClass(false)}
          >
            <Plus size={18} />
            <span className="flex-1 text-sm font-medium">Quick capture</span>
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
            >
              {userInitial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white/90">{userName ?? "User"}</div>
              <div className="truncate text-xs text-white/40">{userEmail}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                close();
                onLogout();
              }}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs text-white/50 hover:bg-white/[0.06] hover:text-white/80"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
