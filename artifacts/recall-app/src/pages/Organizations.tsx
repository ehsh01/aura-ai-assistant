import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import {
  createInvoice,
  createOrganization,
  deleteInvoice,
  deleteOrganization,
  listInvoices,
  listOrganizationPeople,
  listOrganizations,
  updateInvoice,
  updateOrganization,
  type InvoiceRecord,
  type OrganizationRecord,
} from "@/lib/recall-api";
import { organizationsPath, readSearchParam } from "@/lib/recall-nav";
import { toast } from "@/hooks/use-toast";
import { Building2, Receipt, Trash2 } from "lucide-react";

function dollarsToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function centsToDollars(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

export function Organizations() {
  const [, navigate] = useLocation();
  const [orgs, setOrgs] = useState<OrganizationRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [orgPeople, setOrgPeople] = useState<
    { personId: string; displayName: string; email: string | null; role: string | null }[]
  >([]);

  const [orgForm, setOrgForm] = useState({
    displayName: "",
    orgType: "vendor" as OrganizationRecord["orgType"],
    email: "",
    phone: "",
    notes: "",
  });
  const [invoiceForm, setInvoiceForm] = useState({
    title: "",
    organizationId: "",
    amount: "",
    dueDate: "",
    status: "open" as InvoiceRecord["status"],
    notes: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [oRes, iRes] = await Promise.all([listOrganizations(), listInvoices()]);
      setOrgs(oRes.organizations);
      setInvoices(iRes.invoices);
    } catch (err) {
      toast({
        title: "Could not load organizations",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedOrgId) {
      setOrgPeople([]);
      return;
    }
    void listOrganizationPeople(selectedOrgId)
      .then((r) => setOrgPeople(r.people))
      .catch(() => setOrgPeople([]));
  }, [selectedOrgId]);

  useEffect(() => {
    const orgParam = readSearchParam("org");
    const invoiceParam = readSearchParam("invoice");
    if (orgParam) setSelectedOrgId(orgParam);
    if (invoiceParam) setSelectedInvoiceId(invoiceParam);
  }, []);

  const selectedOrg = orgs.find((o) => o.id === selectedOrgId) ?? null;
  const selectedInvoice = invoices.find((i) => i.id === selectedInvoiceId) ?? null;
  const orgInvoices = selectedOrg
    ? invoices.filter((i) => i.organizationId === selectedOrg.id)
    : [];

  return (
    <AppLayout>
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-6 overflow-y-auto p-4 md:p-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Organizations &amp; invoices
          </h1>
          <p className="mt-1 text-sm text-white/50">
            Vendors and bills Ask and Today can track — with due dates for follow-up.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/45">
              <Building2 className="h-4 w-4" /> Organizations
            </h2>
            <form
              className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!orgForm.displayName.trim()) return;
                setSaving(true);
                try {
                  const created = await createOrganization({
                    displayName: orgForm.displayName.trim(),
                    orgType: orgForm.orgType,
                    email: orgForm.email || null,
                    phone: orgForm.phone || null,
                    notes: orgForm.notes || null,
                  });
                  setOrgForm({
                    displayName: "",
                    orgType: "vendor",
                    email: "",
                    phone: "",
                    notes: "",
                  });
                  await load();
                  setSelectedOrgId(created.id);
                  navigate(organizationsPath({ organizationId: created.id }));
                  toast({ title: "Organization saved" });
                } catch (err) {
                  toast({
                    title: "Could not save organization",
                    description: err instanceof Error ? err.message : "Try again",
                    variant: "destructive",
                  });
                } finally {
                  setSaving(false);
                }
              }}
            >
              <input
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                placeholder="Name (e.g. ABC Roofing)"
                value={orgForm.displayName}
                onChange={(e) => setOrgForm((f) => ({ ...f, displayName: e.target.value }))}
              />
              <select
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                value={orgForm.orgType}
                onChange={(e) =>
                  setOrgForm((f) => ({
                    ...f,
                    orgType: e.target.value as OrganizationRecord["orgType"],
                  }))
                }
              >
                <option value="vendor">Vendor</option>
                <option value="contractor">Contractor</option>
                <option value="employer">Employer</option>
                <option value="agency">Agency</option>
                <option value="other">Other</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                  placeholder="Email"
                  value={orgForm.email}
                  onChange={(e) => setOrgForm((f) => ({ ...f, email: e.target.value }))}
                />
                <input
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                  placeholder="Phone"
                  value={orgForm.phone}
                  onChange={(e) => setOrgForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <button
                type="submit"
                disabled={saving || !orgForm.displayName.trim()}
                className="rounded-xl bg-indigo-500/80 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Add organization
              </button>
            </form>

            {loading ? (
              <p className="text-sm text-white/40">Loading…</p>
            ) : orgs.length === 0 ? (
              <p className="text-sm text-white/40">No organizations yet.</p>
            ) : (
              <ul className="space-y-2">
                {orgs.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedOrgId(o.id);
                        setSelectedInvoiceId(null);
                        navigate(organizationsPath({ organizationId: o.id }));
                      }}
                      className="w-full rounded-2xl border px-4 py-3 text-left transition"
                      style={{
                        borderColor:
                          selectedOrgId === o.id
                            ? "rgba(129,140,248,0.45)"
                            : "rgba(255,255,255,0.08)",
                        background:
                          selectedOrgId === o.id
                            ? "rgba(99,102,241,0.12)"
                            : "rgba(255,255,255,0.03)",
                      }}
                    >
                      <div className="text-sm font-medium text-white">{o.displayName}</div>
                      <div className="mt-0.5 text-xs text-white/40">{o.orgType}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selectedOrg && (
              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-white">Edit organization</h3>
                  <button
                    type="button"
                    className="text-rose-300/80"
                    onClick={async () => {
                      if (!confirm(`Delete ${selectedOrg.displayName}?`)) return;
                      await deleteOrganization(selectedOrg.id);
                      setSelectedOrgId(null);
                      await load();
                      toast({ title: "Organization deleted" });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={selectedOrg.displayName}
                  onChange={(e) =>
                    setOrgs((prev) =>
                      prev.map((o) =>
                        o.id === selectedOrg.id
                          ? { ...o, displayName: e.target.value }
                          : o,
                      ),
                    )
                  }
                />
                <textarea
                  className="min-h-[72px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  placeholder="Notes"
                  value={selectedOrg.notes ?? ""}
                  onChange={(e) =>
                    setOrgs((prev) =>
                      prev.map((o) =>
                        o.id === selectedOrg.id
                          ? { ...o, notes: e.target.value || null }
                          : o,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white"
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await updateOrganization(selectedOrg.id, {
                        displayName: selectedOrg.displayName,
                        orgType: selectedOrg.orgType,
                        email: selectedOrg.email,
                        phone: selectedOrg.phone,
                        website: selectedOrg.website,
                        notes: selectedOrg.notes,
                      });
                      await load();
                      toast({ title: "Organization updated" });
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Save changes
                </button>
                <div className="border-t border-white/10 pt-3">
                  <p className="mb-1 text-xs uppercase tracking-wider text-white/35">
                    Affiliated people
                  </p>
                  {orgPeople.length === 0 ? (
                    <p className="text-sm text-white/40">Link people from the People page.</p>
                  ) : (
                    <ul className="space-y-1 text-sm text-white/70">
                      {orgPeople.map((p) => (
                        <li key={p.personId}>
                          {p.displayName}
                          {p.role ? ` · ${p.role}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {orgInvoices.map((inv) => (
                  <button
                    key={inv.id}
                    type="button"
                    className="block text-left text-sm text-indigo-300 hover:underline"
                    onClick={() => {
                      setSelectedInvoiceId(inv.id);
                      navigate(organizationsPath({ invoiceId: inv.id }));
                    }}
                  >
                    {inv.title}
                    {inv.dueDate ? ` · due ${inv.dueDate}` : ""}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/45">
              <Receipt className="h-4 w-4" /> Invoices
            </h2>
            <form
              className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!invoiceForm.title.trim()) return;
                setSaving(true);
                try {
                  const created = await createInvoice({
                    title: invoiceForm.title.trim(),
                    organizationId: invoiceForm.organizationId || selectedOrgId || null,
                    amountCents: dollarsToCents(invoiceForm.amount),
                    dueDate: invoiceForm.dueDate || null,
                    status: invoiceForm.status,
                    notes: invoiceForm.notes || null,
                  });
                  setInvoiceForm({
                    title: "",
                    organizationId: selectedOrgId ?? "",
                    amount: "",
                    dueDate: "",
                    status: "open",
                    notes: "",
                  });
                  await load();
                  setSelectedInvoiceId(created.id);
                  navigate(organizationsPath({ invoiceId: created.id }));
                  toast({ title: "Invoice saved" });
                } catch (err) {
                  toast({
                    title: "Could not save invoice",
                    description: err instanceof Error ? err.message : "Try again",
                    variant: "destructive",
                  });
                } finally {
                  setSaving(false);
                }
              }}
            >
              <input
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                placeholder="Title (e.g. Roof deposit)"
                value={invoiceForm.title}
                onChange={(e) => setInvoiceForm((f) => ({ ...f, title: e.target.value }))}
              />
              <select
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                value={invoiceForm.organizationId || selectedOrgId || ""}
                onChange={(e) =>
                  setInvoiceForm((f) => ({ ...f, organizationId: e.target.value }))
                }
              >
                <option value="">Organization (optional)</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.displayName}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                  placeholder="Amount (e.g. 2500.00)"
                  value={invoiceForm.amount}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, amount: e.target.value }))}
                />
                <input
                  type="date"
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={invoiceForm.dueDate}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
              <button
                type="submit"
                disabled={saving || !invoiceForm.title.trim()}
                className="rounded-xl bg-indigo-500/80 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Add invoice
              </button>
            </form>

            {loading ? null : invoices.length === 0 ? (
              <p className="text-sm text-white/40">No invoices yet.</p>
            ) : (
              <ul className="space-y-2">
                {invoices.map((inv) => (
                  <li key={inv.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedInvoiceId(inv.id);
                        navigate(organizationsPath({ invoiceId: inv.id }));
                      }}
                      className="w-full rounded-2xl border px-4 py-3 text-left transition"
                      style={{
                        borderColor:
                          selectedInvoiceId === inv.id
                            ? "rgba(129,140,248,0.45)"
                            : "rgba(255,255,255,0.08)",
                        background:
                          selectedInvoiceId === inv.id
                            ? "rgba(99,102,241,0.12)"
                            : "rgba(255,255,255,0.03)",
                      }}
                    >
                      <div className="text-sm font-medium text-white">{inv.title}</div>
                      <div className="mt-0.5 text-xs text-white/40">
                        {inv.organizationName || "No org"}
                        {inv.amountCents != null
                          ? ` · $${centsToDollars(inv.amountCents)}`
                          : ""}
                        {inv.dueDate ? ` · due ${inv.dueDate}` : ""}
                        {` · ${inv.status}`}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selectedInvoice && (
              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-white">Edit invoice</h3>
                  <button
                    type="button"
                    className="text-rose-300/80"
                    onClick={async () => {
                      if (!confirm(`Delete ${selectedInvoice.title}?`)) return;
                      await deleteInvoice(selectedInvoice.id);
                      setSelectedInvoiceId(null);
                      await load();
                      toast({ title: "Invoice deleted" });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={selectedInvoice.title}
                  onChange={(e) =>
                    setInvoices((prev) =>
                      prev.map((i) =>
                        i.id === selectedInvoice.id ? { ...i, title: e.target.value } : i,
                      ),
                    )
                  }
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                    placeholder="Amount"
                    value={centsToDollars(selectedInvoice.amountCents)}
                    onChange={(e) =>
                      setInvoices((prev) =>
                        prev.map((i) =>
                          i.id === selectedInvoice.id
                            ? { ...i, amountCents: dollarsToCents(e.target.value) }
                            : i,
                        ),
                      )
                    }
                  />
                  <input
                    type="date"
                    className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                    value={selectedInvoice.dueDate ?? ""}
                    onChange={(e) =>
                      setInvoices((prev) =>
                        prev.map((i) =>
                          i.id === selectedInvoice.id
                            ? { ...i, dueDate: e.target.value || null }
                            : i,
                        ),
                      )
                    }
                  />
                </div>
                <select
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={selectedInvoice.status}
                  onChange={(e) =>
                    setInvoices((prev) =>
                      prev.map((i) =>
                        i.id === selectedInvoice.id
                          ? {
                              ...i,
                              status: e.target.value as InvoiceRecord["status"],
                            }
                          : i,
                      ),
                    )
                  }
                >
                  <option value="open">Open</option>
                  <option value="paid">Paid</option>
                  <option value="void">Void</option>
                  <option value="other">Other</option>
                </select>
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white"
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await updateInvoice(selectedInvoice.id, {
                        title: selectedInvoice.title,
                        organizationId: selectedInvoice.organizationId,
                        amountCents: selectedInvoice.amountCents,
                        currency: selectedInvoice.currency,
                        status: selectedInvoice.status,
                        invoiceDate: selectedInvoice.invoiceDate,
                        dueDate: selectedInvoice.dueDate,
                        notes: selectedInvoice.notes,
                      });
                      await load();
                      toast({ title: "Invoice updated" });
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Save changes
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </AppLayout>
  );
}
