import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { RecallLogo } from "@/components/RecallLogo";

type Mode = "login" | "register";

export function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("Ernesto");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login({ email, password });
      } else {
        await register({ email, password, name });
      }
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Something went wrong. Try again.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[#0a0a0f] text-white p-4 sm:p-6 recall-safe-top recall-safe-bottom">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <RecallLogo size={52} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Recall</h1>
            <p className="text-sm text-white/40">Sign in to your assistant</p>
          </div>
        </div>

        <div className="flex gap-2 mb-6 p-1 rounded-xl bg-white/5">
          {(["login", "register"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 py-2 text-sm rounded-lg transition-colors ${
                mode === m
                  ? "bg-indigo-500/20 text-indigo-200"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {m === "login" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "register" && (
            <div>
              <label className="text-xs text-white/50 mb-1 block">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 focus:border-indigo-500/50 outline-none text-sm"
              />
            </div>
          )}
          <div>
            <label className="text-xs text-white/50 mb-1 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 focus:border-indigo-500/50 outline-none text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-white/50 mb-1 block">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 focus:border-indigo-500/50 outline-none text-sm"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 font-medium text-sm transition-colors"
          >
            {submitting
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
