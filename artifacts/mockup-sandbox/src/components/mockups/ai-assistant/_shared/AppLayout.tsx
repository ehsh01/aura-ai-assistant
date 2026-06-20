import { useState } from "react";

export type Page = "dashboard" | "notes" | "tasks" | "canvas";

interface AppLayoutProps {
  children: React.ReactNode;
  activePage: Page;
  onNavigate?: (page: Page) => void;
}

const navItems = [
  {
    id: "dashboard" as Page,
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
    id: "notes" as Page,
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
    id: "tasks" as Page,
    label: "Tasks",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    ),
  },
  {
    id: "canvas" as Page,
    label: "Canvas",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M8 12h8M12 8v8"/>
      </svg>
    ),
  },
];

export function AppLayout({ children, activePage, onNavigate }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen bg-[#0a0a0f] text-white overflow-hidden">
      {/* Sidebar */}
      <aside
        className="flex flex-col border-r border-white/[0.06] transition-all duration-300 ease-in-out flex-shrink-0"
        style={{ width: collapsed ? 64 : 220, background: "rgba(255,255,255,0.02)" }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/[0.06]">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
               style={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 0 10 10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
          </div>
          {!collapsed && (
            <span className="font-semibold text-[15px] tracking-tight text-white/90">Aura</span>
          )}
        </div>

        {/* Search */}
        {!collapsed && (
          <div className="px-3 py-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer group"
                 style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <span className="text-xs text-white/30 flex-1">Search or ask AI...</span>
              <kbd className="text-[10px] text-white/20 border border-white/10 rounded px-1">⌘K</kbd>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-2 py-2 space-y-0.5">
          {navItems.map((item) => {
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate?.(item.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 group"
                style={{
                  background: isActive ? "rgba(99,102,241,0.15)" : "transparent",
                  color: isActive ? "rgba(165,180,252,1)" : "rgba(255,255,255,0.45)",
                }}
              >
                <span className="flex-shrink-0" style={{ color: isActive ? "#a5b4fc" : "rgba(255,255,255,0.35)" }}>
                  {item.icon}
                </span>
                {!collapsed && (
                  <span className="text-[13.5px] font-medium tracking-tight">{item.label}</span>
                )}
                {!collapsed && isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400"/>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="p-3 border-t border-white/[0.06]">
          {!collapsed && (
            <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl"
                 style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                   style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
                A
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-white/80 truncate">Alex Morgan</div>
                <div className="text-[10px] text-white/30 truncate">Pro plan</div>
              </div>
            </div>
          )}
          <button
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

      {/* Main */}
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {children}
      </main>
    </div>
  );
}
