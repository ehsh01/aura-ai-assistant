import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import {
  createVehicle,
  createWarranty,
  deleteVehicle,
  deleteWarranty,
  listVehicles,
  listWarranties,
  updateVehicle,
  updateWarranty,
  type VehicleRecord,
  type WarrantyRecord,
} from "@/lib/recall-api";
import { readSearchParam, vehiclesPath } from "@/lib/recall-nav";
import { toast } from "@/hooks/use-toast";
import { Car, ShieldCheck, Trash2 } from "lucide-react";

export function Vehicles() {
  const [, navigate] = useLocation();
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [warranties, setWarranties] = useState<WarrantyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedWarrantyId, setSelectedWarrantyId] = useState<string | null>(null);

  const [vehicleForm, setVehicleForm] = useState({
    displayName: "",
    year: "",
    make: "",
    model: "",
    vin: "",
    licensePlate: "",
    notes: "",
  });
  const [warrantyForm, setWarrantyForm] = useState({
    title: "",
    subjectType: "vehicle" as "vehicle" | "home" | "other",
    subjectId: "",
    provider: "",
    expiresAt: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [vRes, wRes] = await Promise.all([listVehicles(), listWarranties()]);
      setVehicles(vRes.vehicles);
      setWarranties(wRes.warranties);
    } catch (err) {
      toast({
        title: "Could not load vehicles",
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
    const vehicleParam = readSearchParam("vehicle");
    const warrantyParam = readSearchParam("warranty");
    if (vehicleParam) setSelectedVehicleId(vehicleParam);
    if (warrantyParam) setSelectedWarrantyId(warrantyParam);
  }, []);

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId) ?? null;
  const selectedWarranty = warranties.find((w) => w.id === selectedWarrantyId) ?? null;
  const vehicleWarranties = selectedVehicle
    ? warranties.filter((w) => w.subjectId === selectedVehicle.id)
    : [];

  const createVehicleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleForm.displayName.trim()) return;
    setSaving(true);
    try {
      const created = await createVehicle({
        displayName: vehicleForm.displayName.trim(),
        year: vehicleForm.year || null,
        make: vehicleForm.make || null,
        model: vehicleForm.model || null,
        vin: vehicleForm.vin || null,
        licensePlate: vehicleForm.licensePlate || null,
        notes: vehicleForm.notes || null,
      });
      setVehicleForm({
        displayName: "",
        year: "",
        make: "",
        model: "",
        vin: "",
        licensePlate: "",
        notes: "",
      });
      await load();
      setSelectedVehicleId(created.id);
      navigate(vehiclesPath({ vehicleId: created.id }));
      toast({ title: "Vehicle saved" });
    } catch (err) {
      toast({
        title: "Could not save vehicle",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const createWarrantySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warrantyForm.title.trim()) return;
    setSaving(true);
    try {
      const created = await createWarranty({
        title: warrantyForm.title.trim(),
        subjectType: warrantyForm.subjectType,
        subjectId:
          warrantyForm.subjectType === "vehicle"
            ? warrantyForm.subjectId || selectedVehicleId || null
            : null,
        provider: warrantyForm.provider || null,
        expiresAt: warrantyForm.expiresAt || null,
        notes: warrantyForm.notes || null,
      });
      setWarrantyForm({
        title: "",
        subjectType: "vehicle",
        subjectId: selectedVehicleId ?? "",
        provider: "",
        expiresAt: "",
        notes: "",
      });
      await load();
      setSelectedWarrantyId(created.id);
      navigate(vehiclesPath({ warrantyId: created.id }));
      toast({ title: "Warranty saved" });
    } catch (err) {
      toast({
        title: "Could not save warranty",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveVehicleEdits = async () => {
    if (!selectedVehicle) return;
    setSaving(true);
    try {
      await updateVehicle(selectedVehicle.id, {
        displayName: selectedVehicle.displayName,
        year: selectedVehicle.year,
        make: selectedVehicle.make,
        model: selectedVehicle.model,
        vin: selectedVehicle.vin,
        licensePlate: selectedVehicle.licensePlate,
        notes: selectedVehicle.notes,
      });
      await load();
      toast({ title: "Vehicle updated" });
    } catch (err) {
      toast({
        title: "Could not update vehicle",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveWarrantyEdits = async () => {
    if (!selectedWarranty) return;
    setSaving(true);
    try {
      await updateWarranty(selectedWarranty.id, {
        title: selectedWarranty.title,
        subjectType: selectedWarranty.subjectType,
        subjectId: selectedWarranty.subjectId,
        provider: selectedWarranty.provider,
        expiresAt: selectedWarranty.expiresAt,
        notes: selectedWarranty.notes,
      });
      await load();
      toast({ title: "Warranty updated" });
    } catch (err) {
      toast({
        title: "Could not update warranty",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const patchVehicle = (patch: Partial<VehicleRecord>) => {
    if (!selectedVehicleId) return;
    setVehicles((prev) =>
      prev.map((v) => (v.id === selectedVehicleId ? { ...v, ...patch } : v)),
    );
  };

  const patchWarranty = (patch: Partial<WarrantyRecord>) => {
    if (!selectedWarrantyId) return;
    setWarranties((prev) =>
      prev.map((w) => (w.id === selectedWarrantyId ? { ...w, ...patch } : w)),
    );
  };

  return (
    <AppLayout>
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-6 overflow-y-auto p-4 md:p-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Vehicles &amp; warranties</h1>
          <p className="mt-1 text-sm text-white/50">
            Structured records Ask and Today can use — VINs, plates, and expiry dates.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/45">
              <Car className="h-4 w-4" /> Vehicles
            </h2>

            <form
              onSubmit={createVehicleSubmit}
              className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <input
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                placeholder="Display name (e.g. 2014 Porsche Cayman S)"
                value={vehicleForm.displayName}
                onChange={(e) => setVehicleForm((f) => ({ ...f, displayName: e.target.value }))}
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                  placeholder="Year"
                  value={vehicleForm.year}
                  onChange={(e) => setVehicleForm((f) => ({ ...f, year: e.target.value }))}
                />
                <input
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                  placeholder="Make"
                  value={vehicleForm.make}
                  onChange={(e) => setVehicleForm((f) => ({ ...f, make: e.target.value }))}
                />
                <input
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                  placeholder="Model"
                  value={vehicleForm.model}
                  onChange={(e) => setVehicleForm((f) => ({ ...f, model: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                  placeholder="VIN"
                  value={vehicleForm.vin}
                  onChange={(e) => setVehicleForm((f) => ({ ...f, vin: e.target.value }))}
                />
                <input
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                  placeholder="Plate"
                  value={vehicleForm.licensePlate}
                  onChange={(e) =>
                    setVehicleForm((f) => ({ ...f, licensePlate: e.target.value }))
                  }
                />
              </div>
              <button
                type="submit"
                disabled={saving || !vehicleForm.displayName.trim()}
                className="rounded-xl bg-indigo-500/80 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Add vehicle
              </button>
            </form>

            {loading ? (
              <p className="text-sm text-white/40">Loading…</p>
            ) : vehicles.length === 0 ? (
              <p className="text-sm text-white/40">No vehicles yet.</p>
            ) : (
              <ul className="space-y-2">
                {vehicles.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedVehicleId(v.id);
                        setSelectedWarrantyId(null);
                        navigate(vehiclesPath({ vehicleId: v.id }));
                      }}
                      className="w-full rounded-2xl border px-4 py-3 text-left transition"
                      style={{
                        borderColor:
                          selectedVehicleId === v.id
                            ? "rgba(129,140,248,0.45)"
                            : "rgba(255,255,255,0.08)",
                        background:
                          selectedVehicleId === v.id
                            ? "rgba(99,102,241,0.12)"
                            : "rgba(255,255,255,0.03)",
                      }}
                    >
                      <div className="text-sm font-medium text-white">{v.displayName}</div>
                      <div className="mt-0.5 text-xs text-white/40">
                        {[v.year, v.make, v.model].filter(Boolean).join(" ") || "No details"}
                        {v.vin ? ` · VIN ${v.vin}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selectedVehicle && (
              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-white">Edit vehicle</h3>
                  <button
                    type="button"
                    className="text-rose-300/80 hover:text-rose-200"
                    onClick={async () => {
                      if (!confirm(`Delete ${selectedVehicle.displayName}?`)) return;
                      await deleteVehicle(selectedVehicle.id);
                      setSelectedVehicleId(null);
                      await load();
                      toast({ title: "Vehicle deleted" });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={selectedVehicle.displayName}
                  onChange={(e) => patchVehicle({ displayName: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                    placeholder="VIN"
                    value={selectedVehicle.vin ?? ""}
                    onChange={(e) => patchVehicle({ vin: e.target.value || null })}
                  />
                  <input
                    className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                    placeholder="Plate"
                    value={selectedVehicle.licensePlate ?? ""}
                    onChange={(e) => patchVehicle({ licensePlate: e.target.value || null })}
                  />
                </div>
                <textarea
                  className="min-h-[72px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  placeholder="Notes"
                  value={selectedVehicle.notes ?? ""}
                  onChange={(e) => patchVehicle({ notes: e.target.value || null })}
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveVehicleEdits()}
                  className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white"
                >
                  Save changes
                </button>
                {vehicleWarranties.length > 0 && (
                  <div className="pt-2">
                    <p className="mb-1 text-xs uppercase tracking-wider text-white/35">
                      Linked warranties
                    </p>
                    <ul className="space-y-1">
                      {vehicleWarranties.map((w) => (
                        <li key={w.id}>
                          <button
                            type="button"
                            className="text-left text-sm text-indigo-300 hover:underline"
                            onClick={() => {
                              setSelectedWarrantyId(w.id);
                              navigate(vehiclesPath({ warrantyId: w.id }));
                            }}
                          >
                            {w.title}
                            {w.expiresAt ? ` · ${w.expiresAt}` : ""}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/45">
              <ShieldCheck className="h-4 w-4" /> Warranties
            </h2>

            <form
              onSubmit={createWarrantySubmit}
              className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <input
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                placeholder="Title (e.g. Roof warranty)"
                value={warrantyForm.title}
                onChange={(e) => setWarrantyForm((f) => ({ ...f, title: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={warrantyForm.subjectType}
                  onChange={(e) =>
                    setWarrantyForm((f) => ({
                      ...f,
                      subjectType: e.target.value as "vehicle" | "home" | "other",
                    }))
                  }
                >
                  <option value="vehicle">Vehicle</option>
                  <option value="home">Home</option>
                  <option value="other">Other</option>
                </select>
                <input
                  type="date"
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={warrantyForm.expiresAt}
                  onChange={(e) => setWarrantyForm((f) => ({ ...f, expiresAt: e.target.value }))}
                />
              </div>
              {warrantyForm.subjectType === "vehicle" && (
                <select
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={warrantyForm.subjectId || selectedVehicleId || ""}
                  onChange={(e) => setWarrantyForm((f) => ({ ...f, subjectId: e.target.value }))}
                >
                  <option value="">Link to vehicle (optional)</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.displayName}
                    </option>
                  ))}
                </select>
              )}
              <input
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                placeholder="Provider"
                value={warrantyForm.provider}
                onChange={(e) => setWarrantyForm((f) => ({ ...f, provider: e.target.value }))}
              />
              <button
                type="submit"
                disabled={saving || !warrantyForm.title.trim()}
                className="rounded-xl bg-indigo-500/80 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Add warranty
              </button>
            </form>

            {loading ? null : warranties.length === 0 ? (
              <p className="text-sm text-white/40">No warranties yet.</p>
            ) : (
              <ul className="space-y-2">
                {warranties.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWarrantyId(w.id);
                        navigate(vehiclesPath({ warrantyId: w.id }));
                      }}
                      className="w-full rounded-2xl border px-4 py-3 text-left transition"
                      style={{
                        borderColor:
                          selectedWarrantyId === w.id
                            ? "rgba(129,140,248,0.45)"
                            : "rgba(255,255,255,0.08)",
                        background:
                          selectedWarrantyId === w.id
                            ? "rgba(99,102,241,0.12)"
                            : "rgba(255,255,255,0.03)",
                      }}
                    >
                      <div className="text-sm font-medium text-white">{w.title}</div>
                      <div className="mt-0.5 text-xs text-white/40">
                        {w.subjectName || w.subjectType}
                        {w.expiresAt ? ` · expires ${w.expiresAt}` : " · no expiry date"}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selectedWarranty && (
              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-white">Edit warranty</h3>
                  <button
                    type="button"
                    className="text-rose-300/80 hover:text-rose-200"
                    onClick={async () => {
                      if (!confirm(`Delete ${selectedWarranty.title}?`)) return;
                      await deleteWarranty(selectedWarranty.id);
                      setSelectedWarrantyId(null);
                      await load();
                      toast({ title: "Warranty deleted" });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={selectedWarranty.title}
                  onChange={(e) => patchWarranty({ title: e.target.value })}
                />
                <input
                  type="date"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={selectedWarranty.expiresAt ?? ""}
                  onChange={(e) => patchWarranty({ expiresAt: e.target.value || null })}
                />
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  placeholder="Provider"
                  value={selectedWarranty.provider ?? ""}
                  onChange={(e) => patchWarranty({ provider: e.target.value || null })}
                />
                <textarea
                  className="min-h-[72px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  placeholder="Notes"
                  value={selectedWarranty.notes ?? ""}
                  onChange={(e) => patchWarranty({ notes: e.target.value || null })}
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveWarrantyEdits()}
                  className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white"
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
