import React, { useCallback, useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import { toast } from "@/hooks/use-toast";
import {
  confirmLinkSuggestion,
  dismissLinkSuggestion,
  fetchPersonContext,
  type ContextItem,
  type LinkSuggestion,
  type PersonContext,
} from "@/lib/recall-api";

const DISMISSED_KEY = "aura-dismissed-link-suggestions";

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ItemRow({ item }: { item: ContextItem }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5">
      <Link href={item.href} className="text-sm text-zinc-200 hover:text-white hover:underline truncate">
        {item.title}
      </Link>
      {item.detail && <span className="text-xs text-zinc-500 shrink-0">{item.detail}</span>}
    </li>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {title}
        {count != null && count > 0 ? <span className="ml-2 text-zinc-500">{count}</span> : null}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function PersonDetail() {
  const [, params] = useRoute("/people/:personId");
  const personId = params?.personId;
  const [context, setContext] = useState<PersonContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!personId) return;
    setLoading(true);
    try {
      setContext(await fetchPersonContext(personId));
    } catch {
      setContext(null);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onConfirmLink(suggestion: LinkSuggestion) {
    setBusy(suggestion.id);
    try {
      await confirmLinkSuggestion({
        entityType: suggestion.entityType,
        entityId: suggestion.entityId,
        field: suggestion.field,
        value: suggestion.suggestedId,
      });
      toast({ title: "Link confirmed", description: suggestion.title });
      await load();
    } catch {
      toast({ title: "Could not apply the link", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function onDismissLink(suggestion: LinkSuggestion) {
    setBusy(suggestion.id);
    try {
      await dismissLinkSuggestion({
        id: suggestion.id,
        entityType: suggestion.entityType,
        entityId: suggestion.entityId,
        suggestedName: suggestion.suggestedName,
      });
      const next = new Set(dismissed).add(suggestion.id);
      setDismissed(next);
      saveDismissed(next);
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="p-6 text-sm text-zinc-500">Loading…</div>
      </AppLayout>
    );
  }

  if (!context) {
    return (
      <AppLayout>
        <div className="p-6">
          <p className="text-sm text-zinc-400">Person not found.</p>
          <Link href="/people" className="text-sm text-sky-400 hover:underline">Back to People</Link>
        </div>
      </AppLayout>
    );
  }

  const { person } = context;
  const suggestions = context.linkSuggestions.filter((s) => !dismissed.has(s.id));

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <header>
          <Link href="/people" className="text-xs text-zinc-500 hover:text-zinc-300">← People</Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-100">{person.displayName}</h1>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
            {person.role && <span>{person.role}</span>}
            {person.organization && <span>{person.organization}</span>}
            {person.email && <span>{person.email}</span>}
            {person.phone && <span>{person.phone}</span>}
          </div>
          <p className="mt-2 text-sm text-zinc-300">{context.summary}</p>
          <div className="mt-2 flex gap-3 text-xs">
            <Link href={`/people?person=${encodeURIComponent(person.id)}`} className="text-sky-400 hover:underline">
              Edit profile
            </Link>
            <Link href={`/ask?q=${encodeURIComponent(`What do I need to know about ${person.displayName}?`)}`} className="text-sky-400 hover:underline">
              Ask Aura about {person.firstName ?? person.displayName}
            </Link>
          </div>
        </header>

        {context.nextBestAction && (
          <section className="rounded-xl border border-sky-400/30 bg-sky-500/10 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-sky-300">Next best action</div>
            <Link href={context.nextBestAction.href} className="mt-1 block text-sm font-medium text-zinc-100 hover:underline">
              {context.nextBestAction.title}
            </Link>
            <p className="mt-0.5 text-xs text-zinc-400">
              {context.nextBestAction.reason} · source: {context.nextBestAction.sourceLabel}
            </p>
          </section>
        )}

        {suggestions.length > 0 && (
          <Section title="Suggested links" count={suggestions.length}>
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="text-zinc-200">{s.title}</span>
                    <span className="ml-2 text-xs text-zinc-500">
                      link to {s.suggestedName} ({s.confidence}) — {s.reason}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => void onConfirmLink(s)}
                      disabled={busy === s.id}
                      className="rounded-md border border-emerald-400/30 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => void onDismissLink(s)}
                      disabled={busy === s.id}
                      className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Section title="They're sending you" count={context.theyOweYou.length}>
            {context.theyOweYou.length === 0 ? (
              <p className="text-xs text-zinc-500">Nothing pending from them.</p>
            ) : (
              <ul className="divide-y divide-zinc-800/60">{context.theyOweYou.map((i) => <ItemRow key={i.id} item={i} />)}</ul>
            )}
          </Section>
          <Section title="You owe them" count={context.youOweThem.length}>
            {context.youOweThem.length === 0 ? (
              <p className="text-xs text-zinc-500">No open tasks requested by them.</p>
            ) : (
              <ul className="divide-y divide-zinc-800/60">{context.youOweThem.map((i) => <ItemRow key={i.id} item={i} />)}</ul>
            )}
          </Section>
        </div>

        <Section title="Deadlines" count={context.deadlines.length}>
          {context.deadlines.length === 0 ? (
            <p className="text-xs text-zinc-500">No linked deadlines.</p>
          ) : (
            <ul className="divide-y divide-zinc-800/60">{context.deadlines.map((i) => <ItemRow key={i.id} item={i} />)}</ul>
          )}
        </Section>

        <Section title="Recent emails" count={context.recentMessages.length}>
          {context.recentMessages.length === 0 ? (
            <p className="text-xs text-zinc-500">No synced emails found for {person.displayName} yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-800/60">
              {context.recentMessages.map((m) => (
                <li key={m.id} className="flex items-baseline justify-between gap-3 py-1.5">
                  {m.sourceUrl ? (
                    <a href={m.sourceUrl} target="_blank" rel="noreferrer" className="text-sm text-zinc-200 hover:text-white hover:underline truncate">
                      {m.title}
                    </a>
                  ) : (
                    <span className="text-sm text-zinc-200 truncate">{m.title}</span>
                  )}
                  <span className="text-xs text-zinc-500 shrink-0">{formatDate(m.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Notes" count={context.notes.length}>
          {context.notes.length === 0 ? (
            <p className="text-xs text-zinc-500">No notes tagged with {person.displayName}.</p>
          ) : (
            <ul className="divide-y divide-zinc-800/60">
              {context.notes.map((n) => (
                <li key={n.id} className="py-1.5">
                  <Link href={n.href} className="text-sm text-zinc-200 hover:text-white hover:underline">{n.title}</Link>
                  {n.preview && <p className="mt-0.5 text-xs text-zinc-500 line-clamp-2">{n.preview}</p>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Timeline">
          {context.timeline.length === 0 ? (
            <p className="text-xs text-zinc-500">No activity yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {context.timeline.map((t, i) => (
                <li key={`${t.kind}-${i}`} className="flex items-baseline gap-3 text-sm">
                  <span className="w-20 shrink-0 text-xs text-zinc-500">{formatDate(t.at)}</span>
                  <span className="w-16 shrink-0 text-xs capitalize text-zinc-500">{t.kind}</span>
                  {t.href.startsWith("http") ? (
                    <a href={t.href} target="_blank" rel="noreferrer" className="truncate text-zinc-200 hover:underline">{t.title}</a>
                  ) : t.href === "#" ? (
                    <span className="truncate text-zinc-400">{t.title}</span>
                  ) : (
                    <Link href={t.href} className="truncate text-zinc-200 hover:underline">{t.title}</Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </AppLayout>
  );
}
