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

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (data: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
    setAuthTokenGetter(() => getStoredToken());
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setIsLoading(false);
      return;
    }

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

  const login = useCallback(
    async (data: LoginRequest) => {
      const res = await apiLogin(data);
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
    clearStoredToken();
    setUser(null);
    setLocation("/", { replace: true });
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
