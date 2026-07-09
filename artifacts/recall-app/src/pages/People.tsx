import React, { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { createPerson, listPeople, type PersonRecord } from "@/lib/recall-api";
import { toast } from "@/hooks/use-toast";

export function People() {
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await listPeople();
      setPeople(res.people);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const addPerson = async () => {
    if (!name.trim()) return;
    try {
      await createPerson({ displayName: name.trim(), email: email.trim() || null });
      setName("");
      setEmail("");
      await load();
      toast({ title: "Person added" });
    } catch {
      toast({ title: "Could not add person", variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#0a0a0f] p-4 md:p-8 text-white">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">Network</p>
          <h1 className="mt-2 text-3xl font-semibold">People</h1>
          <p className="mt-2 text-white/50">
            Requesters, vendors, coworkers, and contacts connected to your tasks and captures.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email (optional)"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void addPerson()}
              className="rounded-xl bg-indigo-500/20 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/30"
            >
              Add person
            </button>
          </div>

          <div className="mt-8 space-y-3">
            {loading && <p className="text-white/40">Loading people…</p>}
            {!loading && people.length === 0 && (
              <p className="text-white/45">No people yet. They will also appear when AI resolves names from captures.</p>
            )}
            {people.map((person) => (
              <article key={person.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <h2 className="text-lg font-semibold">{person.displayName}</h2>
                <div className="mt-1 text-sm text-white/50 space-y-0.5">
                  {person.email && <p>{person.email}</p>}
                  {person.organization && <p>{person.organization}</p>}
                  {person.role && <p>{person.role}</p>}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
