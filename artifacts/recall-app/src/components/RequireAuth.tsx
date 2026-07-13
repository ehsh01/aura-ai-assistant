import React from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Login } from "@/pages/Login";
import { Landing } from "@/pages/Landing";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  // Must subscribe to wouter — reading window.location alone does not re-render
  // when Sign in navigates to /login (parent children-prop bailout).
  const [location] = useLocation();
  const path = location.split("?")[0]?.split("#")[0] || "/";

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
    return <Login />;
  }

  return <>{children}</>;
}
