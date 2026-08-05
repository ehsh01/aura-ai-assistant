import React, { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Activity, MessageSquare, Settings as SettingsIcon, Shield, Users } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { AiUsageSection } from "@/components/settings/AiUsageSection";
import { useAuth } from "@/context/AuthContext";
import {
  adminSetDisabled,
  adminSetIsAdmin,
  adminSetPassword,
  changePassword,
  createUserRule,
  deleteUserRule,
  getNotificationSettings,
  listAdminUsers,
  listUserRules,
  sendTestSmsReminder,
  updateNotificationSettings,
  updateUserRule,
  type AdminUserRecord,
  type NotificationSettings,
  type UserRuleRecord,
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
  const [rules, setRules] = useState<UserRuleRecord[]>([]);
  const [newRule, setNewRule] = useState("");
  const [savingRule, setSavingRule] = useState(false);

  const [notif, setNotif] = useState<NotificationSettings | null>(null);
  const [notifPhone, setNotifPhone] = useState("");
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [notifLeadMinutes, setNotifLeadMinutes] = useState(30);
  const [morningEnabled, setMorningEnabled] = useState(false);
  const [morningTime, setMorningTime] = useState("07:30");
  const [eveningEnabled, setEveningEnabled] = useState(false);
  const [eveningTime, setEveningTime] = useState("17:30");
  const [quietStart, setQuietStart] = useState("21:00");
  const [quietEnd, setQuietEnd] = useState("08:00");
  const [briefingTz, setBriefingTz] = useState("");
  const [savingNotif, setSavingNotif] = useState(false);
  const [testingNotif, setTestingNotif] = useState(false);

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

  useEffect(() => {
    void listUserRules()
      .then((r) => setRules(r.rules))
      .catch(() => setRules([]));
  }, []);

  useEffect(() => {
    void getNotificationSettings()
      .then((s) => {
        setNotif(s);
        setNotifPhone(s.phoneNumber ?? "");
        setNotifEnabled(s.smsRemindersEnabled);
        setNotifLeadMinutes(s.smsLeadMinutes);
        setMorningEnabled(s.morningBriefingEnabled);
        setMorningTime(s.morningBriefingTime);
        setEveningEnabled(s.eveningCheckinEnabled);
        setEveningTime(s.eveningCheckinTime);
        setQuietStart(s.quietHoursStart);
        setQuietEnd(s.quietHoursEnd);
        setBriefingTz(s.timezone ?? "");
      })
      .catch(() => setNotif(null));
  }, []);

  const onSaveNotifications = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingNotif(true);
    try {
      const updated = await updateNotificationSettings({
        phoneNumber: notifPhone.trim() || null,
        smsRemindersEnabled: notifEnabled,
        smsLeadMinutes: notifLeadMinutes,
        morningBriefingEnabled: morningEnabled,
        morningBriefingTime: morningTime,
        eveningCheckinEnabled: eveningEnabled,
        eveningCheckinTime: eveningTime,
        quietHoursStart: quietStart,
        quietHoursEnd: quietEnd,
        timezone: briefingTz.trim() || null,
      });
      setNotif(updated);
      setNotifPhone(updated.phoneNumber ?? "");
      toast({ title: "Text reminders updated" });
    } catch (err) {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSavingNotif(false);
    }
  };

  const onSendTestText = async () => {
    setTestingNotif(true);
    try {
      await sendTestSmsReminder();
      toast({ title: "Test text sent", description: "It should arrive shortly." });
    } catch (err) {
      toast({
        title: "Could not send test text",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setTestingNotif(false);
    }
  };

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
      {/* AppLayout's <main> is overflow-hidden, so each page owns its scroll area. */}
      <div className="h-full overflow-y-auto px-4 py-8 md:px-6">
        <div className="mx-auto max-w-3xl space-y-8">
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

        <Link
          href="/activity"
          className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 no-underline transition-colors hover:bg-white/[0.05] md:px-6"
        >
          <div className="flex items-center gap-3">
            <Activity size={18} className="text-indigo-300" />
            <div>
              <p className="text-sm font-medium text-white">Activity log</p>
              <p className="text-xs text-white/45">
                See everything Recall has captured, changed, or acted on.
              </p>
            </div>
          </div>
          <span className="text-xs text-white/30">View →</span>
        </Link>

        <AiUsageSection isAdmin={user?.isAdmin === true} />

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

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
          <h2 className="text-lg font-medium text-white">Ask rules</h2>
          <p className="mt-1 text-sm text-white/45">
            Short instructions Recall always follows when answering (e.g. prefer metric units,
            never invent project codes).
          </p>
          <ul className="mt-4 space-y-2">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className={rule.enabled ? "text-white/80" : "text-white/35 line-through"}>
                    {rule.body}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="text-xs text-white/40 hover:text-white/70"
                    onClick={() =>
                      void updateUserRule(rule.id, { enabled: !rule.enabled }).then((updated) =>
                        setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r))),
                      )
                    }
                  >
                    {rule.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-rose-300/70 hover:text-rose-200"
                    onClick={() =>
                      void deleteUserRule(rule.id).then(() =>
                        setRules((prev) => prev.filter((r) => r.id !== rule.id)),
                      )
                    }
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newRule.trim()) return;
              setSavingRule(true);
              void createUserRule(newRule.trim())
                .then((rule) => {
                  setRules((prev) => [...prev, rule]);
                  setNewRule("");
                  toast({ title: "Rule added" });
                })
                .catch((err) =>
                  toast({
                    title: "Could not add rule",
                    description: err instanceof Error ? err.message : "Try again",
                    variant: "destructive",
                  }),
                )
                .finally(() => setSavingRule(false));
            }}
          >
            <input
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              placeholder="Add a rule…"
              maxLength={500}
              className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-indigo-500/50"
            />
            <button
              type="submit"
              disabled={savingRule || !newRule.trim()}
              className="rounded-xl bg-indigo-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Add
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-indigo-300" />
            <h2 className="text-lg font-medium text-white">Text message reminders</h2>
          </div>
          <p className="mt-1 text-sm text-white/45">
            Get a text when a reminder is coming up and again when it's due — no need to have
            the app open.
          </p>

          {notif && !notif.smsConfigured && (
            <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/80">
              Texting isn't turned on for this Recall deployment yet (Twilio isn't configured on
              the server). You can still save your number and preferences below.
            </p>
          )}

          <form onSubmit={onSaveNotifications} className="mt-5 max-w-md space-y-3">
            <div>
              <label className="mb-1 block text-xs text-white/50">Phone number</label>
              <input
                type="tel"
                placeholder="(555) 123-4567"
                value={notifPhone}
                onChange={(e) => setNotifPhone(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm outline-none focus:border-indigo-500/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">
                Send a heads-up this many minutes before it's due
              </label>
              <input
                type="number"
                min={5}
                max={1440}
                value={notifLeadMinutes}
                onChange={(e) => setNotifLeadMinutes(Number(e.target.value) || 30)}
                className="w-32 rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm outline-none focus:border-indigo-500/50"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={notifEnabled}
                onChange={(e) => setNotifEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-black/30 accent-indigo-500"
              />
              Text me reminders
            </label>

            <div className="border-t border-white/[0.06] pt-4">
              <p className="text-sm font-medium text-white/80">Daily briefing texts</p>
              <p className="mt-0.5 text-xs text-white/40">
                One morning briefing and one evening check-in per day — counts only, never
                message content.
              </p>

              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={morningEnabled}
                      onChange={(e) => setMorningEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-black/30 accent-indigo-500"
                    />
                    Morning briefing at
                  </label>
                  <input
                    type="time"
                    value={morningTime}
                    onChange={(e) => setMorningTime(e.target.value)}
                    className="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-sm outline-none focus:border-indigo-500/50"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={eveningEnabled}
                      onChange={(e) => setEveningEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-black/30 accent-indigo-500"
                    />
                    Evening check-in at
                  </label>
                  <input
                    type="time"
                    value={eveningTime}
                    onChange={(e) => setEveningTime(e.target.value)}
                    className="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-sm outline-none focus:border-indigo-500/50"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-white/70">
                  <span>Quiet hours (no texts) from</span>
                  <input
                    type="time"
                    value={quietStart}
                    onChange={(e) => setQuietStart(e.target.value)}
                    className="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-sm outline-none focus:border-indigo-500/50"
                  />
                  <span>to</span>
                  <input
                    type="time"
                    value={quietEnd}
                    onChange={(e) => setQuietEnd(e.target.value)}
                    className="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-sm outline-none focus:border-indigo-500/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/50">
                    Your timezone (IANA name — leave blank to use the server default)
                  </label>
                  <input
                    type="text"
                    placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"}
                    value={briefingTz}
                    onChange={(e) => setBriefingTz(e.target.value)}
                    className="w-full max-w-xs rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm outline-none focus:border-indigo-500/50"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="submit"
                disabled={savingNotif}
                className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {savingNotif ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={testingNotif || !notif?.phoneNumber}
                onClick={() => void onSendTestText()}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/80 hover:bg-white/5 disabled:opacity-40"
              >
                {testingNotif ? "Sending…" : "Send test text"}
              </button>
            </div>
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
      </div>
    </AppLayout>
  );
}
