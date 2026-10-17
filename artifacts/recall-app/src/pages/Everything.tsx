import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  ExternalLink,
  FileImage,
  Grid3X3,
  Loader2,
  Network,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { KnowledgeGraph } from "@/components/KnowledgeGraph";
import { toast } from "@/hooks/use-toast";
import { shouldUseGridFallback } from "@/lib/graph-performance";
import {
  fetchKnowledgeGraph,
  getAskAiAvailability,
  getSavedItem,
  listItemFacets,
  listSavedItems,
  queryRecallStream,
  savedItemMediaUrl,
  saveImageItem,
  saveTextItem,
  type ItemSearchInput,
  type AskAiAvailability,
  type KnowledgeGraphNode,
  type KnowledgeGraphNodeType,
  type KnowledgeGraphResponse,
  type SavedItemRecord,
  type QueryRecallResult,
} from "@/lib/recall-api";

const GRAPH_TYPES: Array<{
  type: KnowledgeGraphNodeType;
  label: string;
  color: string;
}> = [
  { type: "notes", label: "Notes", color: "#75baff" },
  { type: "notebooks", label: "Notebooks", color: "#6dffe0" },
  { type: "tags", label: "Tags", color: "#f5ca62" },
  { type: "links", label: "Links", color: "#b695ff" },
  { type: "files", label: "Files", color: "#ff8f82" },
  { type: "evernote", label: "Evernote", color: "#74e59b" },
];

function useLowMotionFallback(): boolean {
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const device = navigator as Navigator & { deviceMemory?: number };
    const evaluate = () =>
      setFallback(
        shouldUseGridFallback({
          reducedMotion: media.matches,
          hardwareConcurrency: device.hardwareConcurrency,
          deviceMemory: device.deviceMemory,
        }),
      );
    evaluate();
    media.addEventListener("change", evaluate);
    return () => media.removeEventListener("change", evaluate);
  }, []);
  return fallback;
}

function itemVisual(item: SavedItemRecord): string | null {
  if (item.media.storagePath) return savedItemMediaUrl(item.id);
  return item.media.remoteUrl ?? null;
}

function ItemCard({
  item,
  onOpen,
}: {
  item: SavedItemRecord;
  onOpen: () => void;
}) {
  const visual = itemVisual(item);
  const body = item.description || item.bodyText;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="hud-panel mb-4 block w-full break-inside-avoid overflow-hidden text-left transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-cyan-200/30 hover:shadow-[0_0_34px_rgba(109,255,224,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7dffd9]"
      data-testid="item-card"
    >
      {visual && (
        <img
          src={visual}
          alt=""
          loading="lazy"
          className="max-h-72 w-full object-cover"
        />
      )}
      <div className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="hud-label text-[#8fd8c2]">{item.source}</span>
          <span className="text-[11px] text-[#9fb4ab]">
            {new Date(item.createdAt).toLocaleDateString()}
          </span>
        </div>
        <h2 className="text-base font-semibold leading-snug text-[#e8fff7]">
          {item.title}
        </h2>
        {body && (
          <p className="mt-2 line-clamp-5 text-sm leading-6 text-[#c9d6d2]">
            {body}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="hud-chip">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

function CaptureBox({
  value,
  onChange,
  onSubmit,
  onFile,
  saving,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onFile: (file: File) => void;
  saving: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      onDragOver={(event) => event.preventDefault()}
      className="hud-capture flex items-center gap-2"
      data-testid="capture-box"
    >
      <Plus size={17} className="flex-none text-[#7dffd9]" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Save a note, paste a link, or drop an image…"
        aria-label="Save anything"
        className="min-w-0 flex-1 bg-transparent text-sm text-[#e8fff7] outline-none placeholder:text-[#8aa69c]"
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-full p-2 text-[#8fd8c2] hover:bg-cyan-200/10 hover:text-[#dffdf4]"
        aria-label="Upload image"
      >
        <Upload size={16} />
      </button>
      <button
        type="submit"
        disabled={saving || !value.trim()}
        className="rounded-full bg-[#7dffd9] px-3 py-1.5 text-xs font-semibold text-[#04100d] disabled:opacity-45"
      >
        {saving ? "Saving" : "Save"}
      </button>
    </form>
  );
}

function ItemDetail({
  item,
  onClose,
}: {
  item: SavedItemRecord;
  onClose: () => void;
}) {
  const visual = itemVisual(item);
  return (
    <aside
      className="hud-detail absolute inset-y-0 right-0 z-40 w-full overflow-y-auto p-5 sm:w-[440px]"
      data-testid="item-detail"
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          className="hud-chip ml-10 inline-flex items-center gap-1.5 sm:ml-0"
        >
          <ArrowLeft size={12} />
          Back
        </button>
        <span className="hud-label text-[#8fd8c2]">
          {item.source} · {item.kind}
        </span>
      </div>
      {visual && (
        <img
          src={visual}
          alt=""
          className="mt-5 max-h-[360px] w-full rounded-xl object-cover"
        />
      )}
      <h1 className="mt-6 text-2xl font-semibold leading-tight text-[#e8fff7]">
        {item.title}
      </h1>
      {item.notebook && (
        <p className="mt-2 text-sm text-[#8fd8c2]">{item.notebook}</p>
      )}
      {item.description && (
        <p className="mt-5 text-base leading-7 text-[#c9d6d2]">
          {item.description}
        </p>
      )}
      {item.bodyText && (
        <div className="mt-5 whitespace-pre-wrap text-sm leading-7 text-[#dce8e4]">
          {item.bodyText}
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        {item.tags.map((tag) => (
          <span key={tag} className="hud-chip">
            {tag}
          </span>
        ))}
      </div>
      {item.sourceUrl && (
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-[#7dffd9]"
        >
          Open source <ExternalLink size={14} />
        </a>
      )}
    </aside>
  );
}

function inlineMarkdown(text: string) {
  return text
    .split(/(\[[^\]]+\]\(https?:\/\/[^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part, index) => {
      const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (link) {
        return (
          <a
            key={`${part}-${index}`}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className="text-[#7dffd9] underline decoration-[#7dffd9]/40 underline-offset-2"
          >
            {link[1]}
          </a>
        );
      }
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong
            key={`${part}-${index}`}
            className="font-semibold text-[#e8fff7]"
          >
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code
            key={`${part}-${index}`}
            className="rounded bg-black/30 px-1 py-0.5 font-mono text-[0.9em] text-[#b8fff2]"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
}

function MarkdownAnswer({ value }: { value: string }) {
  return (
    <div className="space-y-2 text-sm leading-6 text-[#dce8e4]">
      {value.split(/\n{2,}/).map((block, index) => {
        const lines = block.split("\n");
        const list = lines.every((line) => /^\s*[-*]\s+/.test(line));
        if (list) {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {lines.map((line) => (
                <li key={line}>
                  {inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            {inlineMarkdown(block)}
          </p>
        );
      })}
    </div>
  );
}

export function Everything() {
  const [location, navigate] = useLocation();
  const detailItemId = location.match(/^\/everything\/([^/?#]+)/)?.[1];
  const lowMotionFallback = useLowMotionFallback();
  const initialQuery = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const [mode, setMode] = useState<"graph" | "grid">(
    initialQuery.get("view") === "grid" ? "grid" : "graph",
  );
  const [capture, setCapture] = useState(
    () => initialQuery.get("url") ?? initialQuery.get("text") ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<SavedItemRecord[]>([]);
  const [graph, setGraph] = useState<KnowledgeGraphResponse>({
    nodes: [],
    edges: [],
    page: { offset: 0, limit: 350, nextOffset: null },
  });
  const [loading, setLoading] = useState(true);
  const [selectedTypes, setSelectedTypes] = useState<KnowledgeGraphNodeType[]>(
    GRAPH_TYPES.map((item) => item.type),
  );
  const [focus, setFocus] = useState(false);
  const [holo, setHolo] = useState(true);
  const [labels, setLabels] = useState(false);
  const [hubNode, setHubNode] = useState<KnowledgeGraphNode | null>(null);
  const [detail, setDetail] = useState<SavedItemRecord | null>(null);
  const [facets, setFacets] = useState<{ tags: string[]; notebooks: string[] }>(
    { tags: [], notebooks: [] },
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<ItemSearchInput>({
    q: initialQuery.get("q") ?? "",
    tag: initialQuery.get("tag") ?? "",
    notebook: initialQuery.get("notebook") ?? "",
  });
  const [ask, setAsk] = useState("");
  const [answer, setAnswer] = useState("");
  const [askStatus, setAskStatus] = useState<
    "idle" | "searching" | "results" | "thinking" | "ready" | "error"
  >("idle");
  const [keywordResults, setKeywordResults] = useState<SavedItemRecord[]>([]);
  const [aiResult, setAiResult] = useState<QueryRecallResult | null>(null);
  const [aiAvailability, setAiAvailability] =
    useState<AskAiAvailability | null>(null);

  useEffect(() => {
    if (lowMotionFallback) setMode("grid");
  }, [lowMotionFallback]);

  useEffect(() => {
    void getAskAiAvailability()
      .then(setAiAvailability)
      .catch(() =>
        setAiAvailability({
          allowed: false,
          model: null,
          reason: "unavailable",
        }),
      );
  }, []);

  const reloadItems = useCallback(async () => {
    const result = await listSavedItems({ ...filters, limit: 150 });
    setItems(result.items);
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      void Promise.all([
        reloadItems(),
        fetchKnowledgeGraph({
          types: selectedTypes,
          limit: window.innerWidth < 640 ? 180 : 350,
        }).then(setGraph),
        listItemFacets().then(setFacets),
      ])
        .catch((error) =>
          toast({
            title: "Could not load Everything",
            description: error instanceof Error ? error.message : "Try again",
            variant: "destructive",
          }),
        )
        .finally(() => setLoading(false));
    }, 160);
    return () => clearTimeout(timer);
  }, [reloadItems, selectedTypes]);

  useEffect(() => {
    if (!detailItemId) {
      setDetail(null);
      return;
    }
    void getSavedItem(decodeURIComponent(detailItemId))
      .then((result) => setDetail(result.item))
      .catch(() => setDetail(null));
  }, [detailItemId]);

  const saveText = async () => {
    if (!capture.trim() || saving) return;
    setSaving(true);
    try {
      const result = await saveTextItem(capture);
      setCapture("");
      toast({
        title: result.existing ? "Already saved" : "Saved to Recall",
        description: result.item.title,
      });
      await reloadItems();
      setGraph(
        await fetchKnowledgeGraph({
          types: selectedTypes,
          limit: window.innerWidth < 640 ? 180 : 350,
        }),
      );
    } catch (error) {
      toast({
        title: "Could not save",
        description: error instanceof Error ? error.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveFile = async (file: File) => {
    setSaving(true);
    try {
      const result = await saveImageItem(file);
      toast({ title: "Image saved", description: result.item.title });
      await reloadItems();
    } catch (error) {
      toast({
        title: "Could not save image",
        description: error instanceof Error ? error.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const submitKeywordSearch = async (event: FormEvent) => {
    event.preventDefault();
    const question = ask.trim();
    if (!question || askStatus === "searching") return;
    setAskStatus("searching");
    setAnswer("");
    setAiResult(null);
    try {
      const result = await listSavedItems({ q: question, limit: 12 });
      setKeywordResults(result.items);
      setAskStatus("results");
    } catch {
      setKeywordResults([]);
      setAskStatus("error");
    }
  };

  const submitAskAi = async () => {
    const question = ask.trim();
    if (!question || askStatus === "thinking" || !aiAvailability?.allowed)
      return;
    setAskStatus("thinking");
    setAnswer("");
    setKeywordResults([]);
    setAiResult(null);
    try {
      const result = await queryRecallStream(question, {
        onMeta: (meta) =>
          setAiResult((current) => ({
            answer: current?.answer ?? "",
            confidence: current?.confidence ?? 0,
            caveats: current?.caveats ?? null,
            suggestedNextAction: current?.suggestedNextAction ?? null,
            assistantMessageId: current?.assistantMessageId ?? null,
            evidence: meta.evidence,
            relatedRecords: meta.relatedRecords,
            images: meta.images,
            threadId: meta.threadId,
            privacy: meta.privacy,
            sourcesConsulted: meta.sourcesConsulted,
          })),
        onToken: (delta) => setAnswer((current) => current + delta),
      });
      setAnswer((current) => current || result.answer);
      setAiResult(result);
      setAskStatus("ready");
    } catch {
      setAskStatus("error");
      setAnswer("Recall could not answer just now.");
    }
  };

  const aiDisabledReason =
    aiAvailability?.reason === "daily_limit"
      ? "Daily AI allowance reached"
      : aiAvailability?.reason === "disabled"
        ? "Ask AI is disabled"
        : aiAvailability?.reason === "unavailable"
          ? "Ask AI is unavailable"
          : aiAvailability
            ? undefined
            : "Checking Ask AI availability";

  const openNode = useCallback(
    (node: KnowledgeGraphNode) => {
      if (node.itemId) navigate(node.href);
      else setHubNode(node);
    },
    [navigate],
  );

  return (
    <AppLayout immersive>
      <div className="explore-shell relative h-full min-h-0 overflow-hidden text-[#dce8e4]">
        <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 py-3 pl-14 pr-3 sm:p-5">
          <div className="pointer-events-auto flex items-center gap-3">
            <div>
              <p className="hud-label text-[#7dffd9]">Recall / Explore</p>
              <h1 className="mt-1 hidden text-lg font-semibold tracking-tight text-[#e8fff7] sm:block">
                Your knowledge, in orbit
              </h1>
            </div>
            <div className="flex rounded-full border border-cyan-100/15 bg-[#07110f]/80 p-1 backdrop-blur-md">
              <button
                type="button"
                onClick={() => setMode("graph")}
                disabled={lowMotionFallback}
                className={`hud-view-toggle ${mode === "graph" ? "is-active" : ""}`}
                title={
                  lowMotionFallback
                    ? "Graph disabled by reduced-motion or device settings"
                    : "Graph view"
                }
              >
                <Network size={13} /> Graph
              </button>
              <button
                type="button"
                onClick={() => setMode("grid")}
                className={`hud-view-toggle ${mode === "grid" ? "is-active" : ""}`}
              >
                <Grid3X3 size={13} /> Grid
              </button>
            </div>
          </div>

          {mode === "graph" && (
            <div
              className="hud-legend pointer-events-auto hidden w-40 p-3 sm:block"
              aria-label="Graph filters"
            >
              <p className="hud-label mb-2 text-[#8fd8c2]">Filter</p>
              {GRAPH_TYPES.map((entry) => {
                const active = selectedTypes.includes(entry.type);
                return (
                  <button
                    key={entry.type}
                    type="button"
                    onClick={() =>
                      setSelectedTypes((current) =>
                        current.includes(entry.type)
                          ? current.filter((type) => type !== entry.type)
                          : [...current, entry.type],
                      )
                    }
                    className="flex w-full items-center gap-2 py-1 text-left text-[11px] text-[#c9d6d2]"
                    aria-pressed={active}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        background: active ? entry.color : "#33423d",
                        boxShadow: active ? `0 0 9px ${entry.color}` : "none",
                      }}
                    />
                    {entry.label}
                  </button>
                );
              })}
            </div>
          )}
        </header>

        <div className="absolute left-1/2 top-[76px] z-30 w-[min(680px,calc(100%-24px))] -translate-x-1/2">
          <CaptureBox
            value={capture}
            onChange={setCapture}
            onSubmit={() => void saveText()}
            onFile={(file) => void saveFile(file)}
            saving={saving}
          />
        </div>

        {mode === "graph" ? (
          <div className="absolute inset-0 pt-24 sm:pt-0">
            {loading && graph.nodes.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div
                  className="hud-ring h-20 w-20"
                  aria-label="Loading graph"
                />
              </div>
            ) : (
              <KnowledgeGraph
                nodes={graph.nodes}
                edges={graph.edges}
                focus={focus}
                holo={holo}
                labels={labels}
                onNodeClick={openNode}
              />
            )}
          </div>
        ) : (
          <div className="absolute inset-0 overflow-y-auto px-3 pb-32 pt-[148px] sm:px-6 sm:pt-[140px]">
            <div className="mx-auto max-w-7xl">
              <div className="hud-panel mb-5 p-3">
                <div className="flex items-center gap-2">
                  <Search size={16} className="text-[#7dffd9]" />
                  <input
                    value={filters.q ?? ""}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        q: event.target.value,
                      }))
                    }
                    placeholder="Search everything instantly…"
                    className="min-w-0 flex-1 bg-transparent text-sm text-[#e8fff7] outline-none placeholder:text-[#8aa69c]"
                    data-testid="item-search"
                  />
                  <button
                    type="button"
                    onClick={() => setFiltersOpen((value) => !value)}
                    className="hud-chip inline-flex items-center gap-1.5"
                  >
                    <SlidersHorizontal size={12} /> Filters
                  </button>
                </div>
                {filtersOpen && (
                  <div
                    className="mt-3 grid grid-cols-2 gap-2 border-t border-cyan-100/10 pt-3 sm:grid-cols-6"
                    data-testid="search-filters"
                  >
                    <select
                      value={filters.type ?? ""}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          type: event.target.value,
                        }))
                      }
                      className="hud-field"
                    >
                      <option value="">All types</option>
                      <option value="note">Notes</option>
                      <option value="link">Links</option>
                      <option value="image">Images</option>
                      <option value="pdf">PDFs</option>
                    </select>
                    <select
                      value={filters.source ?? ""}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          source: event.target.value,
                        }))
                      }
                      className="hud-field"
                    >
                      <option value="">All sources</option>
                      <option value="recall">Recall</option>
                      <option value="evernote">Evernote</option>
                    </select>
                    <select
                      value={filters.notebook ?? ""}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          notebook: event.target.value,
                        }))
                      }
                      className="hud-field"
                    >
                      <option value="">All notebooks</option>
                      {facets.notebooks.map((notebook) => (
                        <option key={notebook}>{notebook}</option>
                      ))}
                    </select>
                    <select
                      value={filters.tag ?? ""}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          tag: event.target.value,
                        }))
                      }
                      className="hud-field"
                    >
                      <option value="">All tags</option>
                      {facets.tags.map((tag) => (
                        <option key={tag}>{tag}</option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={filters.dateFrom ?? ""}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          dateFrom: event.target.value,
                        }))
                      }
                      className="hud-field"
                      aria-label="From date"
                    />
                    <label className="hud-field flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={Boolean(filters.trash)}
                        onChange={(event) =>
                          setFilters((current) => ({
                            ...current,
                            trash: event.target.checked,
                          }))
                        }
                      />
                      Trash
                    </label>
                  </div>
                )}
              </div>
              {items.length ? (
                <div
                  className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4"
                  data-testid="masonry-grid"
                >
                  {items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onOpen={() =>
                        navigate(
                          `/everything/${encodeURIComponent(item.id)}?view=grid`,
                        )
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="hud-panel py-16 text-center">
                  <FileImage className="mx-auto text-[#8fd8c2]" />
                  <p className="mt-3 text-sm text-[#c9d6d2]">
                    Nothing matches these filters.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {mode === "graph" && (
          <>
            <div className="absolute bottom-[104px] right-3 z-30 flex gap-1.5 sm:bottom-24 sm:right-5">
              {[
                ["Focus", focus, setFocus],
                ["Holo", holo, setHolo],
                ["Labels", labels, setLabels],
              ].map(([label, active, setter]) => (
                <button
                  key={String(label)}
                  type="button"
                  onClick={() => (setter as (value: boolean) => void)(!active)}
                  className={`hud-chip ${active ? "is-active" : ""}`}
                  aria-pressed={Boolean(active)}
                >
                  {String(label)}
                </button>
              ))}
            </div>

            <div className="assistant-ring-wrap absolute right-3 top-1/2 z-30 hidden -translate-y-1/2 sm:block">
              <div
                className={`assistant-ring ${askStatus === "thinking" ? "is-thinking" : ""}`}
              >
                <div>
                  <span>R.E.C.A.L.L.</span>
                  <small>
                    {askStatus === "thinking"
                      ? "THINKING"
                      : askStatus === "searching"
                        ? "SEARCHING"
                        : "ONLINE"}
                  </small>
                </div>
              </div>
              <span className="assistant-status">
                <span className="h-1.5 w-1.5 rounded-full bg-[#7dffd9] shadow-[0_0_8px_#7dffd9]" />
                {askStatus === "thinking"
                  ? "PROCESSING"
                  : askStatus === "searching"
                    ? "SEARCHING"
                    : "READY"}
              </span>
            </div>

            <div
              className="assistant-ring-mobile-wrap absolute bottom-[104px] left-3 z-30 flex items-center gap-1.5 sm:hidden"
              aria-label={`R.E.C.A.L.L. ${askStatus === "thinking" ? "processing" : "ready"}`}
            >
              <div
                className={`assistant-ring-mobile ${askStatus === "thinking" ? "is-thinking" : ""}`}
              >
                <span>RECALL</span>
              </div>
              <span className="assistant-status assistant-status-mobile">
                <span className="h-1.5 w-1.5 rounded-full bg-[#7dffd9] shadow-[0_0_8px_#7dffd9]" />
                {askStatus === "thinking"
                  ? "THINKING"
                  : askStatus === "searching"
                    ? "SEARCH"
                    : "READY"}
              </span>
            </div>

            {(askStatus === "searching" ||
              askStatus === "results" ||
              askStatus === "thinking" ||
              askStatus === "ready" ||
              askStatus === "error") && (
              <section
                className={`assistant-panel absolute bottom-[76px] max-h-[min(52vh,380px)] overflow-y-auto p-3 sm:bottom-24 ${
                  detail
                    ? "left-3 right-3 z-50 sm:left-5 sm:right-[460px]"
                    : "left-1/2 z-30 w-[min(680px,calc(100%-24px))] -translate-x-1/2"
                }`}
                data-testid="ask-output-panel"
                aria-live="polite"
              >
                {askStatus === "searching" && (
                  <div className="flex items-center gap-2 py-3 text-sm text-[#b8fff2]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching saved items and notes…
                  </div>
                )}

                {askStatus === "results" && (
                  <>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="hud-label text-[#8fd8c2]">
                        {keywordResults.length} keyword result
                        {keywordResults.length === 1 ? "" : "s"}
                      </p>
                      <span className="text-[10px] text-[#8aa69c]">
                        Free search · no AI
                      </span>
                    </div>
                    {keywordResults.length > 0 ? (
                      <div
                        className="space-y-1.5"
                        data-testid="keyword-results"
                      >
                        {keywordResults.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() =>
                              navigate(
                                `/everything/${encodeURIComponent(item.id)}`,
                              )
                            }
                            className="block w-full rounded-lg border border-cyan-100/10 bg-black/15 px-3 py-2 text-left hover:border-cyan-100/25 hover:bg-cyan-100/[0.04]"
                            data-testid="keyword-result"
                          >
                            <span className="flex items-center justify-between gap-2">
                              <strong className="truncate text-sm font-medium text-[#e8fff7]">
                                {item.title}
                              </strong>
                              <span className="hud-label flex-none text-[#8fd8c2]">
                                {item.source === "evernote"
                                  ? "Evernote"
                                  : item.kind}
                              </span>
                            </span>
                            <span className="mt-1 block line-clamp-2 text-xs leading-5 text-[#9fb4ab]">
                              {item.description ||
                                item.bodyText ||
                                "Saved in Recall"}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="py-3 text-sm text-[#9fb4ab]">
                        No saved items matched those keywords.
                      </p>
                    )}
                  </>
                )}

                {(askStatus === "thinking" || askStatus === "ready") && (
                  <>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="hud-label text-[#ffcf7d]">Ask AI</p>
                      {askStatus === "thinking" && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-[#b8fff2]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Building an answer…
                        </span>
                      )}
                    </div>
                    {answer ? (
                      <MarkdownAnswer value={answer} />
                    ) : (
                      <div
                        className="space-y-2"
                        aria-label="Loading Ask AI answer"
                      >
                        <div className="h-3 w-11/12 animate-pulse rounded bg-cyan-100/10" />
                        <div className="h-3 w-9/12 animate-pulse rounded bg-cyan-100/10" />
                        <div className="h-3 w-10/12 animate-pulse rounded bg-cyan-100/10" />
                      </div>
                    )}
                    {askStatus === "ready" &&
                      aiResult &&
                      (aiResult.evidence.length > 0 ||
                        aiResult.relatedRecords.length > 0) && (
                        <div className="mt-4 border-t border-cyan-100/10 pt-3">
                          <p className="hud-label mb-2 text-[#8fd8c2]">
                            Sources
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {aiResult.evidence
                              .filter((source) => Boolean(source.url))
                              .slice(0, 5)
                              .map((source) => (
                                <a
                                  key={source.id}
                                  href={source.url!}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hud-chip max-w-full truncate"
                                >
                                  {source.fileName ||
                                    source.evidenceText ||
                                    "Open source"}
                                </a>
                              ))}
                            {aiResult.relatedRecords
                              .slice(0, 6)
                              .map((source) => (
                                <button
                                  key={`${source.entityType}:${source.entityId}`}
                                  type="button"
                                  className="hud-chip max-w-full truncate"
                                  onClick={() =>
                                    navigate(
                                      `/everything/${encodeURIComponent(
                                        source.entityType === "note"
                                          ? `note:${source.entityId}`
                                          : source.entityType ===
                                              "source_record"
                                            ? `evernote:${source.entityId}`
                                            : source.entityId,
                                      )}`,
                                    )
                                  }
                                >
                                  {source.title}
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                  </>
                )}

                {askStatus === "error" && (
                  <p className="py-2 text-sm text-rose-200">
                    {answer || "Recall could not search just now."}
                  </p>
                )}
              </section>
            )}

            <form
              onSubmit={submitKeywordSearch}
              className={`assistant-panel absolute bottom-3 sm:bottom-5 ${
                detail
                  ? "left-3 right-3 z-50 sm:left-5 sm:right-[460px]"
                  : "left-1/2 z-30 w-[min(680px,calc(100%-24px))] -translate-x-1/2"
              }`}
            >
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-[#ffcf7d]" />
                <input
                  value={ask}
                  onChange={(event) => setAsk(event.target.value)}
                  placeholder="Ask Recall about what you see…"
                  aria-label="Ask Recall"
                  className="min-w-0 flex-1 bg-transparent text-base text-[#e8fff7] outline-none placeholder:text-[#8aa69c] sm:text-sm"
                />
                <button
                  type="submit"
                  disabled={!ask.trim() || askStatus === "searching"}
                  className="rounded-full p-2 text-[#7dffd9] hover:bg-cyan-200/10 disabled:opacity-40"
                  aria-label="Search Recall"
                  title="Search saved items (free)"
                >
                  {askStatus === "searching" ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Send size={16} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void submitAskAi()}
                  disabled={
                    !ask.trim() ||
                    askStatus === "thinking" ||
                    !aiAvailability?.allowed
                  }
                  className="rounded-full border border-amber-200/20 bg-amber-200/10 px-3 py-1.5 text-xs font-semibold text-[#ffcf7d] hover:bg-amber-200/15 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Ask AI"
                  title={aiDisabledReason ?? "Use AI to synthesize an answer"}
                >
                  Ask AI
                </button>
              </div>
            </form>
          </>
        )}

        {hubNode && (
          <div className="hud-panel absolute bottom-28 left-3 z-40 w-72 p-4 sm:left-auto sm:right-48">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="hud-label text-[#8fd8c2]">{hubNode.type}</p>
                <h2 className="mt-1 font-semibold text-[#e8fff7]">
                  {hubNode.label}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setHubNode(null)}
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => navigate(hubNode.href)}
              className="mt-4 text-xs font-semibold text-[#7dffd9]"
            >
              Browse related items
            </button>
          </div>
        )}

        {detail && <ItemDetail item={detail} onClose={() => navigate("/")} />}
      </div>
    </AppLayout>
  );
}
