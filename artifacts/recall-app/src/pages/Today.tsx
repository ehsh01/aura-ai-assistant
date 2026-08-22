import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Check, Clock3, RotateCcw, X } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { EvidenceDrawer } from "@/components/EvidenceDrawer";
import { MicButton } from "@/components/MicButton";
import {
  fetchTodayDashboard,
  type TodayCategoryKey,
  type TodayDashboardCategory,
  type TodayDashboardEvidence,
  type TodayDashboardItem,
  type TodayDashboardResponse,
} from "@/lib/recall-api";
import { ingestCaptureReliable } from "@/lib/capture-queue";
import { readSearchParam } from "@/lib/recall-nav";
import { toast } from "@/hooks/use-toast";

const CATEGORY_KEYS = new Set<TodayCategoryKey>([
  "email",
  "payments",
  "important",
  "due-soon",
  "cracks",
  "waiting",
  "focus",
  "finance",
]);

const EMPTY_CATEGORIES: TodayDashboardCategory[] = [
  ["email", "Gmail", "Email", "needs a reply"],
  ["payments", "Finance", "Payments & subscriptions", "due in about 14 days"],
  ["important", "Attention", "Important", "must do now"],
  ["due-soon", "Tasks", "Due soon", "today + 7 days"],
  ["cracks", "Stale", "Falling through the cracks", "silent 5+ days"],
  ["waiting", "People", "Waiting on", "open waits"],
  ["focus", "Suggested", "Focus", "do these next · cap 3"],
  ["finance", "Synced", "Finance snapshot", "connect a finance ledger"],
].map(([key, eyebrow, title, summary]) => ({
  key: key as TodayCategoryKey,
  eyebrow,
  title,
  summary,
  count: 0,
  items: [],
  emptyTitle: "Nothing to show yet",
  emptyAction: null,
  emptyHref: null,
  ...(key === "finance"
    ? { heroAmount: 0, heroCurrency: "USD" as const, period: "this month", flags: [] }
    : {}),
}));

type SelectedEvidence = {
  title: string;
  evidence: TodayDashboardEvidence;
};

function clientDate(): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.abs(value));
}

function categoryFromLocation(location: string): TodayCategoryKey | null {
  const raw = location.match(/^\/today\/([^/?#]+)/)?.[1];
  return raw && CATEGORY_KEYS.has(raw as TodayCategoryKey)
    ? (raw as TodayCategoryKey)
    : null;
}

function TileHero({ category }: { category: TodayDashboardCategory }) {
  if (category.key === "finance") {
    return (
      <span className="text-[31px] font-semibold tracking-[-0.05em] text-white/94 tabular-nums">
        {formatMoney(category.heroAmount ?? 0)}
      </span>
    );
  }
  return (
    <span className="text-[39px] font-semibold tracking-[-0.045em] text-white/94 tabular-nums">
      {category.count}
    </span>
  );
}

function TodayTile({
  category,
  selected,
  compact,
  onClick,
}: {
  category: TodayDashboardCategory;
  selected: boolean;
  compact: boolean;
  onClick: () => void;
}) {
  const dramatic = category.key === "cracks";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group flex min-w-0 flex-col rounded-[15px] border text-left transition-[border-color,background,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
        compact ? "min-h-[128px] p-[10px]" : "min-h-[245px] p-4"
      } ${
        selected && dramatic
          ? "border-amber-400/35 bg-[linear-gradient(145deg,rgba(76,47,27,0.64),rgba(31,24,24,0.82))]"
          : selected
            ? "border-white/20 bg-white/[0.085]"
            : dramatic
              ? "border-amber-400/18 bg-[linear-gradient(145deg,rgba(62,40,26,0.54),rgba(26,23,24,0.76))] hover:border-amber-300/30"
              : "border-white/[0.095] bg-[linear-gradient(145deg,rgba(37,42,56,0.68),rgba(25,27,34,0.78))] hover:border-white/20 hover:bg-white/[0.065]"
      }`}
    >
      {!compact && (
        <span className="inline-flex w-fit rounded-full border border-white/[0.055] bg-white/[0.055] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.04em] text-white/38">
          {category.eyebrow}
        </span>
      )}
      <h2
        className={`font-semibold leading-[1.2] tracking-[-0.015em] text-white/88 ${
          compact ? "text-[11px]" : "mt-2 text-[15px]"
        }`}
      >
        {category.title}
      </h2>
      <div className="mt-auto">
        <TileHero category={category} />
        <p
          className={`truncate text-white/32 ${
            compact ? "mt-0 text-[8px]" : "mt-1 text-[10px]"
          }`}
        >
          {category.summary}
        </p>
      </div>
    </button>
  );
}

function DashboardRow({
  item,
  categoryKey,
  onEvidence,
  onFocusAction,
}: {
  item: TodayDashboardItem;
  categoryKey: TodayCategoryKey;
  onEvidence: () => void;
  onFocusAction: (action: "accept" | "defer" | "dismiss") => void;
}) {
  const external = item.href.startsWith("http");
  return (
    <article className="rounded-xl border border-white/[0.085] bg-white/[0.035] px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={item.href}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
            className="block truncate text-[12px] font-semibold text-white/88 no-underline hover:text-white"
          >
            {item.title}
          </Link>
          <p className="mt-0.5 truncate text-[9px] text-white/34">{item.context}</p>
        </div>
        {item.daysSilent != null && (
          <span className="flex-shrink-0 text-[10px] font-semibold text-amber-200/85 tabular-nums">
            {item.daysSilent}d
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="rounded-full border border-white/[0.06] bg-white/[0.06] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.04em] text-white/38">
          {item.source}
        </span>
        {item.inclusion && (
          <span
            className={`rounded-full px-2 py-0.5 text-[8px] font-medium ${
              item.inclusion === "included"
                ? "bg-emerald-400/10 text-emerald-200/65"
                : "bg-white/[0.045] text-white/30"
            }`}
          >
            {item.inclusion}
          </span>
        )}
        <button
          type="button"
          onClick={onEvidence}
          className="ml-auto text-[9px] font-semibold text-indigo-200/80 hover:text-indigo-100"
        >
          Show Evidence
        </button>
      </div>
      {categoryKey === "focus" && (
        <div className="mt-2.5 flex items-center gap-1.5 border-t border-white/[0.055] pt-2">
          <button
            type="button"
            onClick={() => onFocusAction("accept")}
            className="inline-flex items-center gap-1 rounded-md bg-white/[0.085] px-2 py-1 text-[8px] font-medium text-white/70 hover:bg-white/[0.13]"
          >
            <Check size={9} />
            Accept
          </button>
          <button
            type="button"
            onClick={() => onFocusAction("defer")}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[8px] font-medium text-white/38 hover:bg-white/[0.07] hover:text-white/60"
          >
            <Clock3 size={9} />
            Defer
          </button>
          <button
            type="button"
            onClick={() => onFocusAction("dismiss")}
            className="rounded-md px-2 py-1 text-[8px] font-medium text-white/38 hover:bg-white/[0.07] hover:text-white/60"
          >
            Dismiss
          </button>
        </div>
      )}
    </article>
  );
}

function EmptyCategory({ category }: { category: TodayDashboardCategory }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.085] bg-white/[0.018] px-6 text-center">
      <p className="text-[12px] font-medium text-white/60">{category.emptyTitle}</p>
      {category.emptyAction && category.emptyHref && (
        <Link
          href={category.emptyHref}
          className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-semibold text-indigo-200/75 no-underline hover:text-indigo-100"
        >
          {category.emptyAction}
          <ArrowRight size={11} />
        </Link>
      )}
    </div>
  );
}

function FinanceRows({
  category,
  onEvidence,
}: {
  category: TodayDashboardCategory;
  onEvidence: (item: TodayDashboardItem) => void;
}) {
  const included = category.items.filter((item) => item.inclusion === "included");
  const excluded = category.items.filter((item) => item.inclusion === "excluded");
  if (category.items.length === 0) return <EmptyCategory category={category} />;

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-emerald-200/45">
          Included in {category.period ?? "this period"} · {included.length}
        </p>
        <div className="space-y-1.5">
          {included.map((item) => (
            <DashboardRow
              key={item.id}
              item={item}
              categoryKey="finance"
              onEvidence={() => onEvidence(item)}
              onFocusAction={() => undefined}
            />
          ))}
        </div>
      </div>
      {excluded.length > 0 && (
        <div>
          <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-white/25">
            Excluded from spend · {excluded.length}
          </p>
          <div className="space-y-1.5">
            {excluded.map((item) => (
              <DashboardRow
                key={item.id}
                item={item}
                categoryKey="finance"
                onEvidence={() => onEvidence(item)}
                onFocusAction={() => undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Today() {
  const [location, navigate] = useLocation();
  const [dashboard, setDashboard] = useState<TodayDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [capture, setCapture] = useState(() => readSearchParam("capture")?.trim() ?? "");
  const [sending, setSending] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<SelectedEvidence | null>(null);
  const [hiddenFocusIds, setHiddenFocusIds] = useState<Set<string>>(() => new Set());
  const selectedKey = categoryFromLocation(location);

  const loadDashboard = () => {
    setLoading(true);
    setLoadError(false);
    void fetchTodayDashboard()
      .then(setDashboard)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(loadDashboard, []);

  useEffect(() => {
    if (!readSearchParam("capture")) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("capture");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const categories = useMemo(
    () =>
      (dashboard?.categories ?? EMPTY_CATEGORIES).map((category) => {
        if (category.key !== "focus") return category;
        const items = category.items.filter((item) => !hiddenFocusIds.has(item.id));
        return { ...category, items, count: items.length };
      }),
    [dashboard?.categories, hiddenFocusIds],
  );
  const selectedCategory =
    categories.find((category) => category.key === selectedKey) ?? null;

  const submitCapture = async () => {
    const text = capture.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const result = await ingestCaptureReliable({
        rawText: text,
        sourceType: "manual",
        title: text.split(/\r?\n/)[0]?.slice(0, 80) || "Quick capture",
      });
      setCapture("");
      toast({
        title: result.queued ? "Saved offline" : "Sent to Inbox",
        description: result.queued
          ? "Recall will sync it when you are back online."
          : "Capture stays lightweight; review it in Inbox.",
      });
    } catch {
      toast({ title: "Could not capture", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleFocusAction = (
    item: TodayDashboardItem,
    action: "accept" | "defer" | "dismiss",
  ) => {
    if (action === "accept") {
      navigate(item.href);
      return;
    }
    setHiddenFocusIds((previous) => new Set(previous).add(item.id));
    toast({
      title: action === "defer" ? "Deferred for this view" : "Suggestion dismissed",
      description:
        action === "defer"
          ? "The underlying task is unchanged."
          : "The underlying task stays in Recall.",
    });
  };

  return (
    <AppLayout todayDashboard>
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#090d17] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_32%_0%,rgba(44,58,99,0.17),transparent_48%),radial-gradient(circle_at_90%_10%,rgba(93,65,82,0.10),transparent_38%)]" />
        <div className="relative z-10 flex min-h-0 flex-1 flex-col px-[18px] pb-4 pt-[17px] lg:px-[26px]">
          <header className="flex min-h-[58px] flex-shrink-0 items-start justify-between gap-5">
            <div>
              <h1 className="text-[23px] font-semibold leading-none tracking-[-0.035em] text-white/92">
                {dashboard?.date ?? clientDate()}
              </h1>
              <p className="mt-1.5 text-[10px] text-white/34">
                What deserves attention today.
              </p>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitCapture();
              }}
              className="mt-1 hidden h-[32px] w-[300px] max-w-[38vw] items-center rounded-[10px] border border-white/[0.095] bg-white/[0.055] pl-3 pr-1.5 backdrop-blur-xl md:flex"
            >
              <input
                value={capture}
                onChange={(event) => setCapture(event.target.value)}
                placeholder="Capture anything"
                aria-label="Capture anything"
                className="min-w-0 flex-1 border-0 bg-transparent text-[10px] text-white/75 outline-none placeholder:text-white/28"
              />
              <MicButton
                onTranscript={(text) =>
                  setCapture((previous) => (previous ? `${previous} ${text}` : text))
                }
                iconSize={12}
                title="Voice capture"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-white/28 hover:bg-white/[0.07] hover:text-white/65"
              />
              {capture.trim() && (
                <button
                  type="submit"
                  disabled={sending}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 hover:bg-white/[0.07] hover:text-white/75 disabled:opacity-40"
                  aria-label="Send capture to Inbox"
                >
                  <ArrowRight size={12} />
                </button>
              )}
            </form>
          </header>

          {loadError && (
            <div className="mb-2 flex items-center justify-between rounded-lg border border-amber-300/10 bg-amber-200/[0.035] px-3 py-2 text-[9px] text-amber-100/55">
              <span>Live category data is unavailable. The eight views remain ready.</span>
              <button
                type="button"
                onClick={loadDashboard}
                className="inline-flex items-center gap-1 text-amber-100/70 hover:text-amber-50"
              >
                <RotateCcw size={9} />
                Retry
              </button>
            </div>
          )}

          {loading && !dashboard ? (
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 lg:grid-cols-4">
              {EMPTY_CATEGORIES.map((category) => (
                <div
                  key={category.key}
                  className="min-h-[245px] animate-pulse rounded-[15px] border border-white/[0.07] bg-white/[0.035]"
                />
              ))}
            </div>
          ) : selectedCategory ? (
            <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
              <div className="grid min-h-0 grid-cols-2 gap-2">
                {categories.map((category) => (
                  <TodayTile
                    key={category.key}
                    category={category}
                    compact
                    selected={category.key === selectedCategory.key}
                    onClick={() => navigate(`/today/${category.key}`)}
                  />
                ))}
              </div>

              <section className="flex min-h-0 flex-col rounded-[15px] border border-white/[0.095] bg-white/[0.045] p-4 backdrop-blur-xl">
                <header className="flex flex-shrink-0 items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-white/28">
                      {selectedCategory.eyebrow}
                    </p>
                    <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.03em] text-white/92">
                      {selectedCategory.title}
                    </h2>
                    <p className="mt-2 text-[10px] text-white/36">
                      {selectedCategory.key === "cracks"
                        ? "Open items silent five or more days. Sorted by days silent."
                        : selectedCategory.key === "finance"
                          ? `Period spend for ${selectedCategory.period ?? "this month"}. Transfers and credit-card payments stay excluded.`
                          : selectedCategory.summary}
                    </p>
                    {selectedCategory.flags && selectedCategory.flags.length > 0 && (
                      <div className="mt-2 flex gap-1.5">
                        {selectedCategory.flags.map((flag) => (
                          <span
                            key={flag}
                            className="rounded-full border border-emerald-300/10 bg-emerald-300/[0.055] px-2 py-0.5 text-[8px] text-emerald-100/55"
                          >
                            {flag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="text-right">
                      <TileHero category={selectedCategory} />
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate("/today")}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-white/28 hover:bg-white/[0.07] hover:text-white/65"
                      aria-label="Close category"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </header>

                <div className="recall-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
                  {selectedCategory.key === "finance" ? (
                    <FinanceRows
                      category={selectedCategory}
                      onEvidence={(item) =>
                        setSelectedEvidence({ title: item.title, evidence: item.evidence })
                      }
                    />
                  ) : selectedCategory.items.length === 0 ? (
                    <EmptyCategory category={selectedCategory} />
                  ) : (
                    <div className="space-y-1.5">
                      {selectedCategory.items.map((item) => (
                        <DashboardRow
                          key={item.id}
                          item={item}
                          categoryKey={selectedCategory.key}
                          onEvidence={() =>
                            setSelectedEvidence({
                              title: item.title,
                              evidence: item.evidence,
                            })
                          }
                          onFocusAction={(action) => handleFocusAction(item, action)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 lg:grid-cols-4">
              {categories.map((category) => (
                <TodayTile
                  key={category.key}
                  category={category}
                  compact={false}
                  selected={false}
                  onClick={() => navigate(`/today/${category.key}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <EvidenceDrawer
        open={selectedEvidence != null}
        onClose={() => setSelectedEvidence(null)}
        entityType={selectedEvidence?.evidence.entityType ?? ""}
        entityId={selectedEvidence?.evidence.entityId ?? ""}
        title={selectedEvidence?.title}
        fallback={
          selectedEvidence
            ? {
                text: selectedEvidence.evidence.text,
                system: selectedEvidence.evidence.system,
                occurredAt: selectedEvidence.evidence.occurredAt,
                url: selectedEvidence.evidence.url,
              }
            : undefined
        }
      />
    </AppLayout>
  );
}
