import React, { useCallback, useEffect, useState } from "react";
import { Settings as SettingsIcon, Shield, Users } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/context/AuthContext";
import {
  adminSetDisabled,
  adminSetIsAdmin,
  adminSetPassword,
  changePassword,
  listAdminUsers,
  type AdminUserRecord,
} from "@/lib/recall-api";
import { toast } from "@/hooks/use-toast";

export function Settings() {
  const { user, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const loadUsers = useCallback(async () => {
    if (!user?.isAdmin) return;
    setUsersLoading(true);
    try {
      const res = await listAdminUsers();
      setUsers(res.users);
    } catch (err) {
      toast({
        title: "Could not load users",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setUsersLoading(false);
    }
  }, [user?.isAdmin]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const onChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "New password and confirmation must be the same.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword.length < 8) {
      toast({
        title: "Password too short",
        description: "Use at least 8 characters.",
        variant: "destructive",
      });
      return;
    }
    setSavingPassword(true);
    try {
      const res = await changePassword({ currentPassword, newPassword });
      toast({ title: "Password updated", description: res.message });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      logout();
    } catch (err) {
      toast({
        title: "Could not update password",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 md:px-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2 text-indigo-300">
            <SettingsIcon size={18} />
            <span className="text-xs font-semibold uppercase tracking-[0.16em]">
              Account
            </span>
          </div>
          <h1 className="text-2xl font-semibold text-white">Settings</h1>
          <p className="text-sm text-white/45">
            Signed in as {user?.name} ({user?.email})
            {user?.isAdmin ? " · Admin" : ""}
          </p>
        </header>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
          <h2 className="text-lg font-medium text-white">Change password</h2>
          <p className="mt-1 text-sm text-white/45">
            Updates your password and signs you out of every device.
          </p>
          <form onSubmit={onChangePassword} className="mt-5 space-y-3 max-w-md">
            <div>
              <label className="mb-1 block text-xs text-white/50">Current password</label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm outline-none focus:border-indigo-500/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">New password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm outline-none focus:border-indigo-500/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">Confirm new password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm outline-none focus:border-indigo-500/50"
              />
            </div>
            <button
              type="submit"
              disabled={savingPassword}
              className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {savingPassword ? "Saving…" : "Update password"}
            </button>
          </form>
        </section>

        {user?.isAdmin && (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
            <div className="flex items-center gap-2">
              <Shield size={18} className="text-indigo-300" />
              <h2 className="text-lg font-medium text-white">Admin · Users</h2>
            </div>
            <p className="mt-1 text-sm text-white/45">
              Manage accounts: reset passwords, disable access, grant admin.
            </p>

            {usersLoading ? (
              <p className="mt-4 text-sm text-white/40">Loading users…</p>
            ) : users.length === 0 ? (
              <p className="mt-4 text-sm text-white/40">No users found.</p>
            ) : (
              <div className="mt-5 space-y-3">
                {users.map((u) => (
                  <article
                    key={u.id}
                    className="rounded-xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Users size={14} className="text-white/35" />
                          <p className="truncate font-medium text-white">{u.name}</p>
                        </div>
                        <p className="mt-0.5 truncate text-sm text-white/45">{u.email}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                          {u.isAdmin && (
                            <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-indigo-200">
                              Admin
                            </span>
                          )}
                          {u.disabledAt ? (
                            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-200">
                              Disabled
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-200">
                              Active
                            </span>
                          )}
                          {u.id === user.id && (
                            <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/50">
                              You
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5"
                          onClick={() => {
                            setResetFor(resetFor === u.id ? null : u.id);
                            setResetPassword("");
                          }}
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          disabled={u.id === user.id}
                          className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5 disabled:opacity-30"
                          onClick={async () => {
                            try {
                              await adminSetDisabled(u.id, !u.disabledAt);
                              await loadUsers();
                              toast({
                                title: u.disabledAt ? "User enabled" : "User disabled",
                              });
                            } catch (err) {
                              toast({
                                title: "Update failed",
                                description:
                                  err instanceof Error ? err.message : "Try again",
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          {u.disabledAt ? "Enable" : "Disable"}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5"
                          onClick={async () => {
                            try {
                              await adminSetIsAdmin(u.id, !u.isAdmin);
                              await loadUsers();
                              toast({
                                title: u.isAdmin ? "Admin removed" : "Admin granted",
                              });
                            } catch (err) {
                              toast({
                                title: "Update failed",
                                description:
                                  err instanceof Error ? err.message : "Try again",
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          {u.isAdmin ? "Remove admin" : "Make admin"}
                        </button>
                      </div>
                    </div>
                    {resetFor === u.id && (
                      <form
                        className="mt-3 flex flex-wrap items-end gap-2 border-t border-white/10 pt-3"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          try {
                            await adminSetPassword(u.id, resetPassword);
                            setResetFor(null);
                            setResetPassword("");
                            toast({
                              title: "Password reset",
                              description: `Tell ${u.email} the new password securely.`,
                            });
                          } catch (err) {
                            toast({
                              title: "Reset failed",
                              description:
                                err instanceof Error ? err.message : "Try again",
                              variant: "destructive",
                            });
                          }
                        }}
                      >
                        <div className="min-w-[12rem] flex-1">
                          <label className="mb-1 block text-xs text-white/50">
                            New password for {u.name}
                          </label>
                          <input
                            type="password"
                            required
                            minLength={8}
                            value={resetPassword}
                            onChange={(e) => setResetPassword(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-indigo-500/50"
                          />
                        </div>
                        <button
                          type="submit"
                          className="rounded-xl bg-indigo-500 px-3 py-2 text-sm text-white"
                        >
                          Save
                        </button>
                      </form>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </AppLayout>
  );
}
