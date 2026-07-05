import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { BookOpen, Inbox, Library, Plus, FolderKanban } from "lucide-react";
import { CaptureModal } from "@/components/CaptureModal";
import { MobileBottomNav, MobileMoreSheet } from "@/components/MobileShell";
import { useAuth } from "@/context/AuthContext";
import { useRecallData } from "@/context/RecallDataContext";
import { notesPath, readSearchParam } from "@/lib/recall-nav";

interface AppLayoutProps {
  children: React.ReactNode;
}

type NavEntry = {
  key: string;
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  count?: number;
  nested?: boolean;
};

type NavGroup = {
  key: string;
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  count?: number;
  children: NavEntry[];
};

const notebooksIcon = <Library width={18} height={18} strokeWidth={1.8} />;
const notebookItemIcon = <BookOpen width={18} height={18} strokeWidth={1.8} />;

const staticNavItems = [
  {
    id: "/",
    label: "Home",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5"/>
        <rect x="14" y="3" width="7" height="7" rx="1.5"/>
        <rect x="3" y="14" width="7" height="7" rx="1.5"/>
        <rect x="14" y="14" width="7" height="7" rx="1.5"/>
      </svg>
    ),
  },
  {
    id: "/notes",
    label: "Notes",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="8" y1="13" x2="16" y2="13"/>
        <line x1="8" y1="17" x2="12" y2="17"/>
      </svg>
    ),
  },
  {
    id: "/notebooks",
    label: "Notebooks",
    icon: notebooksIcon,
  },
  {
    id: "/inbox",
    label: "AI Inbox",
    icon: <Inbox width={18} height={18} strokeWidth={1.8} />,
  },
  {
    id: "/projects",
    label: "Projects",
    icon: <FolderKanban width={18} height={18} strokeWidth={1.8} />,
  },
  {
    id: "/tasks",
    label: "Tasks",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    ),
  },
  {
    id: "/canvas",
    label: "Canvas",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M8 12h8M12 8v8"/>
      </svg>
    ),
  },
];

function SidebarNavButton({
  href,
  label,
  icon,
  active,
  collapsed,
  count,
  nested,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  collapsed: boolean;
  count?: number;
  nested?: boolean;
}) {
  return (
    <Link
      href={href}
      className="w-full flex items-center gap-3 py-2.5 rounded-xl text-left transition-all duration-150 group no-underline"
      style={{
        paddingLeft: nested && !collapsed ? 36 : 12,
        paddingRight: 12,
        background: active ? "rgba(99,102,241,0.15)" : "transparent",
        color: active ? "rgba(165,180,252,1)" : "rgba(255,255,255,0.45)",
      }}
    >
      <span className="flex-shrink-0" style={{ color: active ? "#a5b4fc" : "rgba(255,255,255,0.35)" }}>
        {icon}
      </span>
      {!collapsed && (
        <span className="text-[13.5px] font-medium tracking-tight truncate flex-1">{label}</span>
      )}
      {!collapsed && count !== undefined && (
        <span className="text-[11px] text-white/25 tabular-nums flex-shrink-0">{count}</span>
      )}
      {!collapsed && active && count === undefined && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0"/>
      )}
    </Link>
  );
}

export function AppLayout({ children }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const sidebarSearchRef = useRef<HTMLInputElement>(null);
  const [location, navigate] = useLocation();
  const { user, logout } = useAuth();
  const { notebooks, notes, isReady } = useRecallData();
  const initial = user?.name?.charAt(0).toUpperCase() ?? "?";
  const onNotesPage = location === "/notes";
  const activeNotebook = onNotesPage ? readSearchParam("notebook") ?? "all" : "all";
  const [notebooksExpanded, setNotebooksExpanded] = useState(false);

  React.useEffect(() => {
    if (location === "/notebooks" || (onNotesPage && activeNotebook !== "all")) {
      setNotebooksExpanded(true);
    }
  }, [location, onNotesPage, activeNotebook]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (collapsed) setCollapsed(false);
        sidebarSearchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [collapsed]);

  const handleSidebarSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = sidebarQuery.trim();
    if (!q) return;
    navigate(notesPath({ q }));
    setSidebarQuery("");
  };

  const navItems: Array<{ type: "entry"; entry: NavEntry } | { type: "group"; group: NavGroup }> = [];

  for (const item of staticNavItems) {
    if (item.id === "/notes") {
      navItems.push({
        type: "entry",
        entry: {
          key: "/notes",
          href: notesPath(),
          label: "Notes",
          icon: item.icon,
          isActive: onNotesPage && activeNotebook === "all",
          count: notes.length,
        },
      });
      continue;
    }

    if (item.id === "/notebooks") {
      navItems.push({
        type: "group",
        group: {
          key: "/notebooks",
          href: "/notebooks",
          label: "Notebooks",
          icon: item.icon,
          isActive: location === "/notebooks",
          count: isReady ? notebooks.length : undefined,
          children: isReady
            ? notebooks.map((notebook) => ({
                key: notebook.id,
                href: notesPath({ notebook: notebook.id }),
                label: notebook.name,
                icon: notebookItemIcon,
                isActive: onNotesPage && activeNotebook === notebook.id,
                count: notebook.noteCount,
                nested: true,
              }))
            : [],
        },
      });
      continue;
    }

    navItems.push({
      type: "entry",
      entry: {
        key: item.id,
        href: item.id,
        label: item.label,
        icon: item.icon,
        isActive: location === item.id,
      },
    });
  }

  const moreActive =
    location === "/notebooks" ||
    location === "/tasks" ||
    location === "/canvas" ||
    location === "/projects" ||
    location.startsWith("/projects/");

  const mobileNotebookLinks = isReady
    ? notebooks.slice(0, 12).map((notebook) => ({
        href: notesPath({ notebook: notebook.id }),
        label: notebook.name,
        count: notebook.noteCount,
      }))
    : [];

  return (
    <div className="flex h-[100dvh] bg-[#0a0a0f] text-white overflow-hidden recall-safe-top">
      <aside
        className="hidden md:flex flex-col border-r border-white/[0.06] transition-all duration-300 ease-in-out flex-shrink-0"
        style={{ width: collapsed ? 64 : 220, background: "rgba(255,255,255,0.02)" }}
      >
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/[0.06]">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
               style={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 0 10 10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
          </div>
          {!collapsed && (
            <span className="font-semibold text-[15px] tracking-tight text-white/90">Recall</span>
          )}
        </div>

        {!collapsed && (
          <div className="px-3 py-3">
            <button
              type="button"
              onClick={() => setCaptureOpen(true)}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400"
            >
              <Plus size={16} />
              Capture
            </button>
            <form
              onSubmit={handleSidebarSearch}
              className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                ref={sidebarSearchRef}
                type="search"
                value={sidebarQuery}
                onChange={(e) => setSidebarQuery(e.target.value)}
                placeholder="Search notes…"
                className="text-xs text-white/70 flex-1 bg-transparent border-none outline-none placeholder:text-white/30 min-w-0"
              />
              <kbd className="hidden lg:inline text-[10px] text-white/20 border border-white/10 rounded px-1 flex-shrink-0">⌘K</kbd>
            </form>
          </div>
        )}

        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto recall-scrollbar">
          {navItems.map((item) => {
            if (item.type === "entry") {
              const entry = item.entry;
              return (
                <SidebarNavButton
                  key={entry.key}
                  href={entry.href}
                  label={entry.label}
                  icon={entry.icon}
                  active={entry.isActive}
                  collapsed={collapsed}
                  count={entry.count}
                  nested={entry.nested}
                />
              );
            }

            const group = item.group;
            return (
              <div key={group.key}>
                <div className="flex items-center gap-0.5">
                  <SidebarNavButton
                    href={group.href}
                    label={group.label}
                    icon={group.icon}
                    active={group.isActive}
                    collapsed={collapsed}
                    count={group.count}
                  />
                  {!collapsed && group.children.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setNotebooksExpanded((open) => !open)}
                      className="flex-shrink-0 p-2 rounded-lg text-white/25 hover:text-white/50 transition-colors"
                      aria-expanded={notebooksExpanded}
                      aria-label={notebooksExpanded ? "Collapse notebooks" : "Expand notebooks"}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                          transform: notebooksExpanded ? "rotate(90deg)" : "rotate(0deg)",
                          transition: "transform 150ms ease",
                        }}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  )}
                </div>

                {!collapsed && notebooksExpanded && (
                  <div className="mt-0.5 space-y-0.5">
                    {group.children.map((entry) => (
                      <SidebarNavButton
                        key={entry.key}
                        href={entry.href}
                        label={entry.label}
                        icon={entry.icon}
                        active={entry.isActive}
                        collapsed={collapsed}
                        count={entry.count}
                        nested
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/[0.06]">
          {!collapsed && (
            <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl"
                 style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                   style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
                {initial}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-white/80 truncate">{user?.name ?? "User"}</div>
                <div className="text-[10px] text-white/30 truncate">{user?.email}</div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="text-[10px] text-white/30 hover:text-white/60 transition-colors px-2 py-1 rounded"
                title="Sign out"
              >
                Out
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="mt-2 w-full flex items-center justify-center p-2 rounded-lg text-white/20 hover:text-white/50 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {collapsed
                ? <><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></>
                : <><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></>
              }
            </svg>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden flex flex-col min-w-0 pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))] md:pb-0">
        {children}
      </main>
      <button
        type="button"
        onClick={() => setCaptureOpen(true)}
        className="hidden md:flex fixed bottom-6 right-6 z-40 items-center gap-2 rounded-full bg-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-2xl shadow-indigo-500/25 hover:bg-indigo-400"
      >
        <Plus size={18} />
        Capture
      </button>
      <MobileBottomNav
        location={location}
        onCapture={() => setCaptureOpen(true)}
        onOpenMore={() => setMoreOpen(true)}
        moreActive={moreActive}
      />
      <MobileMoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        location={location}
        userName={user?.name}
        userEmail={user?.email}
        userInitial={initial}
        onCapture={() => setCaptureOpen(true)}
        onLogout={logout}
        notebookLinks={mobileNotebookLinks}
      />
      <CaptureModal open={captureOpen} onClose={() => setCaptureOpen(false)} />
    </div>
  );
}
