import React from "react";
import { useAuth } from "@/context/AuthContext";
import { Login } from "@/pages/Login";
import { Landing } from "@/pages/Landing";
import { pathnameOnly } from "@/lib/app-path";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const path = pathnameOnly();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] text-white/50 text-sm">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    // Public home for Google OAuth branding / crawlers — no login wall.
    if (path === "/" || path === "") return <Landing />;
    if (path === "/login") return <Login />;
    return <Login />;
  }

  return <>{children}</>;
}
