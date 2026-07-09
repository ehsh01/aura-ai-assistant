import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import {
  createPerson,
  listPeople,
  listWaitingOn,
  type PersonRecord,
  type WaitingOnRecord,
} from "@/lib/recall-api";
import { toast } from "@/hooks/use-toast";

export function People() {
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [waiting, setWaiting] = useState<WaitingOnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [peopleRes, waitingRes] = await Promise.all([listPeople(), listWaitingOn()]);
      setPeople(peopleRes.people);
      setWaiting(waitingRes.items);
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
            Contacts plus what you&apos;re waiting on from them — with the source evidence.
          </p>

          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Waiting on</h2>
              <Link href="/ask" className="text-xs text-indigo-300 no-underline hover:underline">
                Ask about follow-ups
              </Link>
            </div>
            {loading && <p className="text-white/40">Loading…</p>}
            {!loading && waiting.length === 0 && (
              <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">
                Nothing looks like it&apos;s waiting on someone right now. Capture a note like
                “waiting on quote from Mike” and it will show up here.
              </p>
            )}
            <div className="space-y-2">
              {waiting.map((w) => (
                <Link
                  key={w.id}
                  href={w.href}
                  className="block rounded-2xl border border-amber-500/15 bg-amber-500/5 p-4 no-underline transition-colors hover:border-amber-500/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wider text-amber-200/70">
                        {w.person}
                        {w.days > 0 ? ` · ${w.days}d` : ""}
                        {" · "}
                        {w.sourceType}
                      </p>
                      <h3 className="mt-1 font-semibold text-white">{w.item}</h3>
                      <p className="mt-1 line-clamp-2 text-sm text-white/50">{w.evidenceText}</p>
                    </div>
                    <span className="flex-shrink-0 rounded-full bg-white/5 px-2.5 py-1 text-xs text-indigo-200">
                      {w.followUp}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <div className="mt-10 flex flex-wrap gap-2">
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

          <div className="mt-6 space-y-3">
            {!loading && people.length === 0 && (
              <p className="text-white/45">
                No people yet. They will also appear when AI resolves names from captures.
              </p>
            )}
            {people.map((person) => (
              <article key={person.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <h2 className="text-lg font-semibold">{person.displayName}</h2>
                <div className="mt-1 space-y-0.5 text-sm text-white/50">
                  {person.email && <p>{person.email}</p>}
                  {person.organization && <p>{person.organization}</p>}
                  {person.role && <p>{person.role}</p>}
                </div>
                {waiting.some((w) => w.personId === person.id) && (
                  <p className="mt-2 text-xs text-amber-200/80">
                    {waiting.filter((w) => w.personId === person.id).length} open follow-up
                    {waiting.filter((w) => w.personId === person.id).length === 1 ? "" : "s"}
                  </p>
                )}
              </article>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
