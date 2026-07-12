import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation } from "wouter";
import {
  getCurrentUser,
  login as apiLogin,
  register as apiRegister,
  type LoginRequest,
  type RegisterRequest,
  type User,
} from "@workspace/api-client-react";
import { isAppPath, normalizeBrowserPath, pathnameOnly } from "@/lib/app-path";
import { startCaptureQueueSync } from "@/lib/capture-queue";
import { toast } from "@/hooks/use-toast";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (data: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const LEGACY_TOKEN_KEY = "recall_auth_token";

async function logoutOnServer(): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  } catch {
    try {
      await fetch("/api/auth/logout/public", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // ignore
    }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Remove full-account bearer tokens persisted by older Recall versions.
    try {
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch {
      // Storage may be unavailable in restricted browser contexts.
    }
  }, []);

  const syncPathAfterAuth = useCallback(() => {
    normalizeBrowserPath();
    const path = pathnameOnly();
    if (!isAppPath(path) || location !== path) {
      setLocation(path, { replace: true });
    }
  }, [location, setLocation]);

  useEffect(() => {
    // Browser sessions are cookie-only; credentials never enter JavaScript storage.
    getCurrentUser()
      .then((res) => {
        setUser(res.user);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    syncPathAfterAuth();
  }, [user, syncPathAfterAuth]);

  // Flush offline captures when the device comes back online.
  useEffect(() => {
    if (!user) return;
    return startCaptureQueueSync((result) => {
      toast({
        title: "Queued captures synced",
        description: `${result.sent} capture${result.sent === 1 ? "" : "s"} sent to AI Inbox.`,
      });
    });
  }, [user]);

  const login = useCallback(
    async (data: LoginRequest) => {
      const res = await apiLogin(data);
      setUser(res.user);
      normalizeBrowserPath();
      setLocation("/", { replace: true });
    },
    [setLocation],
  );

  const register = useCallback(
    async (data: RegisterRequest) => {
      const res = await apiRegister(data);
      setUser(res.user);
      normalizeBrowserPath();
      setLocation("/", { replace: true });
    },
    [setLocation],
  );

  const logout = useCallback(() => {
    void logoutOnServer().finally(() => {
      setUser(null);
      setLocation("/", { replace: true });
    });
  }, [setLocation]);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
    }),
    [user, isLoading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
