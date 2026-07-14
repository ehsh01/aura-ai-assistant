import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import {
  createHome,
  createVehicle,
  createWarranty,
  deleteHome,
  deleteVehicle,
  deleteWarranty,
  listHomes,
  listVehicles,
  listWarranties,
  updateHome,
  updateVehicle,
  updateWarranty,
  type HomeRecord,
  type VehicleRecord,
  type WarrantyRecord,
} from "@/lib/recall-api";
import { readSearchParam, vehiclesPath } from "@/lib/recall-nav";
import { toast } from "@/hooks/use-toast";
import { Car, Home, ShieldCheck, Trash2 } from "lucide-react";

export function Vehicles() {
  const [, navigate] = useLocation();
  const [homes, setHomes] = useState<HomeRecord[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [warranties, setWarranties] = useState<WarrantyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedHomeId, setSelectedHomeId] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedWarrantyId, setSelectedWarrantyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [homeForm, setHomeForm] = useState({
    displayName: "",
    addressLine1: "",
    city: "",
    region: "",
    postalCode: "",
    notes: "",
  });
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

  const load = async () => {
    setLoading(true);
    try {
      const [hRes, vRes, wRes] = await Promise.all([
        listHomes(),
        listVehicles(),
        listWarranties(),
      ]);
      setHomes(hRes.homes);
      setVehicles(vRes.vehicles);
      setWarranties(wRes.warranties);
    } catch (err) {
      toast({
        title: "Could not load properties",
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
    const homeParam = readSearchParam("home");
    const vehicleParam = readSearchParam("vehicle");
    const warrantyParam = readSearchParam("warranty");
    if (homeParam) setSelectedHomeId(homeParam);
    if (vehicleParam) setSelectedVehicleId(vehicleParam);
    if (warrantyParam) setSelectedWarrantyId(warrantyParam);
  }, []);

  const selectedHome = homes.find((h) => h.id === selectedHomeId) ?? null;
  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId) ?? null;
  const selectedWarranty = warranties.find((w) => w.id === selectedWarrantyId) ?? null;

  const linkedWarrantiesFor = (subjectType: "home" | "vehicle", id: string) =>
    warranties.filter((w) => w.subjectType === subjectType && w.subjectId === id);

  const createHomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!homeForm.displayName.trim()) return;
    setSaving(true);
    try {
      const created = await createHome({
        displayName: homeForm.displayName.trim(),
        addressLine1: homeForm.addressLine1 || null,
        city: homeForm.city || null,
        region: homeForm.region || null,
        postalCode: homeForm.postalCode || null,
        notes: homeForm.notes || null,
      });
      setHomeForm({
        displayName: "",
        addressLine1: "",
        city: "",
        region: "",
        postalCode: "",
        notes: "",
      });
      await load();
      setSelectedHomeId(created.id);
      navigate(vehiclesPath({ homeId: created.id }));
      toast({ title: "Home saved" });
    } catch (err) {
      toast({
        title: "Could not save home",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

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
      const defaultSubject =
        warrantyForm.subjectType === "home"
          ? selectedHomeId
          : warrantyForm.subjectType === "vehicle"
            ? selectedVehicleId
            : null;
      const created = await createWarranty({
        title: warrantyForm.title.trim(),
        subjectType: warrantyForm.subjectType,
        subjectId:
          warrantyForm.subjectType === "other"
            ? null
            : warrantyForm.subjectId || defaultSubject || null,
        provider: warrantyForm.provider || null,
        expiresAt: warrantyForm.expiresAt || null,
        notes: warrantyForm.notes || null,
      });
      setWarrantyForm({
        title: "",
        subjectType: "vehicle",
        subjectId: "",
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

  const patchHome = (patch: Partial<HomeRecord>) => {
    if (!selectedHomeId) return;
    setHomes((prev) => prev.map((h) => (h.id === selectedHomeId ? { ...h, ...patch } : h)));
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

  const subjectOptions =
    warrantyForm.subjectType === "home"
      ? homes
      : warrantyForm.subjectType === "vehicle"
        ? vehicles
        : [];

  return (
    <AppLayout>
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-6 overflow-y-auto p-4 md:p-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Home, vehicles &amp; warranties
          </h1>
          <p className="mt-1 text-sm text-white/50">
            Structured property records Ask and Today can use — addresses, VINs, and expiry dates.
          </p>
        </header>

        <div className="grid gap-6 xl:grid-cols-3">
          <section className="space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/45">
              <Home className="h-4 w-4" /> Homes
            </h2>
            <form
              onSubmit={createHomeSubmit}
              className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <input
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                placeholder="Display name (e.g. Primary residence)"
                value={homeForm.displayName}
                onChange={(e) => setHomeForm((f) => ({ ...f, displayName: e.target.value }))}
              />
              <input
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                placeholder="Street address"
                value={homeForm.addressLine1}
                onChange={(e) => setHomeForm((f) => ({ ...f, addressLine1: e.target.value }))}
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                  placeholder="City"
                  value={homeForm.city}
                  onChange={(e) => setHomeForm((f) => ({ ...f, city: e.target.value }))}
                />
                <input
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                  placeholder="State"
                  value={homeForm.region}
                  onChange={(e) => setHomeForm((f) => ({ ...f, region: e.target.value }))}
                />
                <input
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
                  placeholder="ZIP"
                  value={homeForm.postalCode}
                  onChange={(e) => setHomeForm((f) => ({ ...f, postalCode: e.target.value }))}
                />
              </div>
              <button
                type="submit"
                disabled={saving || !homeForm.displayName.trim()}
                className="rounded-xl bg-indigo-500/80 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Add home
              </button>
            </form>

            {loading ? (
              <p className="text-sm text-white/40">Loading…</p>
            ) : homes.length === 0 ? (
              <p className="text-sm text-white/40">No homes yet.</p>
            ) : (
              <ul className="space-y-2">
                {homes.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedHomeId(h.id);
                        setSelectedVehicleId(null);
                        setSelectedWarrantyId(null);
                        navigate(vehiclesPath({ homeId: h.id }));
                      }}
                      className="w-full rounded-2xl border px-4 py-3 text-left transition"
                      style={{
                        borderColor:
                          selectedHomeId === h.id
                            ? "rgba(129,140,248,0.45)"
                            : "rgba(255,255,255,0.08)",
                        background:
                          selectedHomeId === h.id
                            ? "rgba(99,102,241,0.12)"
                            : "rgba(255,255,255,0.03)",
                      }}
                    >
                      <div className="text-sm font-medium text-white">{h.displayName}</div>
                      <div className="mt-0.5 text-xs text-white/40">
                        {[h.addressLine1, h.city, h.region].filter(Boolean).join(", ") ||
                          "No address"}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selectedHome && (
              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-white">Edit home</h3>
                  <button
                    type="button"
                    className="text-rose-300/80 hover:text-rose-200"
                    onClick={async () => {
                      if (!confirm(`Delete ${selectedHome.displayName}?`)) return;
                      await deleteHome(selectedHome.id);
                      setSelectedHomeId(null);
                      await load();
                      toast({ title: "Home deleted" });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={selectedHome.displayName}
                  onChange={(e) => patchHome({ displayName: e.target.value })}
                />
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  placeholder="Street"
                  value={selectedHome.addressLine1 ?? ""}
                  onChange={(e) => patchHome({ addressLine1: e.target.value || null })}
                />
                <textarea
                  className="min-h-[72px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  placeholder="Notes"
                  value={selectedHome.notes ?? ""}
                  onChange={(e) => patchHome({ notes: e.target.value || null })}
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await updateHome(selectedHome.id, {
                        displayName: selectedHome.displayName,
                        addressLine1: selectedHome.addressLine1,
                        addressLine2: selectedHome.addressLine2,
                        city: selectedHome.city,
                        region: selectedHome.region,
                        postalCode: selectedHome.postalCode,
                        notes: selectedHome.notes,
                      });
                      await load();
                      toast({ title: "Home updated" });
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white"
                >
                  Save changes
                </button>
                {linkedWarrantiesFor("home", selectedHome.id).map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    className="block text-left text-sm text-indigo-300 hover:underline"
                    onClick={() => {
                      setSelectedWarrantyId(w.id);
                      navigate(vehiclesPath({ warrantyId: w.id }));
                    }}
                  >
                    {w.title}
                    {w.expiresAt ? ` · ${w.expiresAt}` : ""}
                  </button>
                ))}
              </div>
            )}
          </section>

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

            {loading ? null : vehicles.length === 0 ? (
              <p className="text-sm text-white/40">No vehicles yet.</p>
            ) : (
              <ul className="space-y-2">
                {vehicles.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedVehicleId(v.id);
                        setSelectedHomeId(null);
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
                  onClick={async () => {
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
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white"
                >
                  Save changes
                </button>
                {linkedWarrantiesFor("vehicle", selectedVehicle.id).map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    className="block text-left text-sm text-indigo-300 hover:underline"
                    onClick={() => {
                      setSelectedWarrantyId(w.id);
                      navigate(vehiclesPath({ warrantyId: w.id }));
                    }}
                  >
                    {w.title}
                    {w.expiresAt ? ` · ${w.expiresAt}` : ""}
                  </button>
                ))}
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
                      subjectId: "",
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
              {warrantyForm.subjectType !== "other" && (
                <select
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={
                    warrantyForm.subjectId ||
                    (warrantyForm.subjectType === "home"
                      ? selectedHomeId
                      : selectedVehicleId) ||
                    ""
                  }
                  onChange={(e) => setWarrantyForm((f) => ({ ...f, subjectId: e.target.value }))}
                >
                  <option value="">
                    Link to {warrantyForm.subjectType} (optional)
                  </option>
                  {subjectOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.displayName}
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
                  onClick={async () => {
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
                    } finally {
                      setSaving(false);
                    }
                  }}
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
