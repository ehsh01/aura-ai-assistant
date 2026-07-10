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
import { setAuthTokenGetter } from "@workspace/api-client-react";
import {
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from "@/lib/auth-storage";
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

async function logoutOnServer(): Promise<void> {
  try {
    const token = getStoredToken();
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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

  const syncPathAfterAuth = useCallback(() => {
    normalizeBrowserPath();
    const path = pathnameOnly();
    if (!isAppPath(path) || location !== path) {
      setLocation(path, { replace: true });
    }
  }, [location, setLocation]);

  useEffect(() => {
    // Bearer fallback for extension / older sessions; cookie is primary.
    setAuthTokenGetter(() => getStoredToken());
  }, []);

  useEffect(() => {
    // Prefer httpOnly cookie session; Bearer token is optional fallback.
    getCurrentUser()
      .then((res) => {
        setUser(res.user);
      })
      .catch(() => {
        clearStoredToken();
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
      // Keep Bearer for extension / offline capture queue; cookie is primary.
      setStoredToken(res.token);
      setUser(res.user);
      normalizeBrowserPath();
      setLocation("/", { replace: true });
    },
    [setLocation],
  );

  const register = useCallback(
    async (data: RegisterRequest) => {
      const res = await apiRegister(data);
      setStoredToken(res.token);
      setUser(res.user);
      normalizeBrowserPath();
      setLocation("/", { replace: true });
    },
    [setLocation],
  );

  const logout = useCallback(() => {
    void logoutOnServer().finally(() => {
      clearStoredToken();
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
