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
import {
  fetchKnowledgeGraph,
  getSavedItem,
  listItemFacets,
  listSavedItems,
  queryRecallStream,
  savedItemMediaUrl,
  saveImageItem,
  saveTextItem,
  type ItemSearchInput,
  type KnowledgeGraphNode,
  type KnowledgeGraphNodeType,
  type KnowledgeGraphResponse,
  type SavedItemRecord,
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
        media.matches ||
          (device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 2) ||
          (device.deviceMemory != null && device.deviceMemory <= 2),
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
        <h2 className="text-base font-semibold leading-snug text-[#e8fff7]">{item.title}</h2>
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
        <button type="button" onClick={onClose} className="hud-chip ml-10 inline-flex items-center gap-1.5 sm:ml-0">
          <ArrowLeft size={12} />
          Back
        </button>
        <span className="hud-label text-[#8fd8c2]">{item.source} · {item.kind}</span>
      </div>
      {visual && (
        <img src={visual} alt="" className="mt-5 max-h-[360px] w-full rounded-xl object-cover" />
      )}
      <h1 className="mt-6 text-2xl font-semibold leading-tight text-[#e8fff7]">{item.title}</h1>
      {item.notebook && <p className="mt-2 text-sm text-[#8fd8c2]">{item.notebook}</p>}
      {item.description && (
        <p className="mt-5 text-base leading-7 text-[#c9d6d2]">{item.description}</p>
      )}
      {item.bodyText && (
        <div className="mt-5 whitespace-pre-wrap text-sm leading-7 text-[#dce8e4]">
          {item.bodyText}
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        {item.tags.map((tag) => (
          <span key={tag} className="hud-chip">{tag}</span>
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

export function Everything() {
  const [location, navigate] = useLocation();
  const detailItemId = location.match(/^\/everything\/([^/?#]+)/)?.[1];
  const lowMotionFallback = useLowMotionFallback();
  const initialQuery = useMemo(() => new URLSearchParams(window.location.search), []);
  const [mode, setMode] = useState<"graph" | "grid">(
    initialQuery.get("view") === "grid" ? "grid" : "graph",
  );
  const [capture, setCapture] = useState(
    () => initialQuery.get("url") ?? initialQuery.get("text") ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<SavedItemRecord[]>([]);
  const [graph, setGraph] = useState<KnowledgeGraphResponse>({ nodes: [], edges: [], page: { offset: 0, limit: 350, nextOffset: null } });
  const [loading, setLoading] = useState(true);
  const [selectedTypes, setSelectedTypes] = useState<KnowledgeGraphNodeType[]>(
    GRAPH_TYPES.map((item) => item.type),
  );
  const [focus, setFocus] = useState(false);
  const [holo, setHolo] = useState(true);
  const [labels, setLabels] = useState(false);
  const [hubNode, setHubNode] = useState<KnowledgeGraphNode | null>(null);
  const [detail, setDetail] = useState<SavedItemRecord | null>(null);
  const [facets, setFacets] = useState<{ tags: string[]; notebooks: string[] }>({ tags: [], notebooks: [] });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<ItemSearchInput>({
    q: initialQuery.get("q") ?? "",
    tag: initialQuery.get("tag") ?? "",
    notebook: initialQuery.get("notebook") ?? "",
  });
  const [ask, setAsk] = useState("");
  const [answer, setAnswer] = useState("");
  const [askStatus, setAskStatus] = useState<"idle" | "thinking" | "ready" | "error">("idle");

  useEffect(() => {
    if (lowMotionFallback) setMode("grid");
  }, [lowMotionFallback]);

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

  const submitAsk = async (event: FormEvent) => {
    event.preventDefault();
    const question = ask.trim();
    if (!question || askStatus === "thinking") return;
    setAskStatus("thinking");
    setAnswer("");
    try {
      const result = await queryRecallStream(question, {
        onToken: (delta) => setAnswer((current) => current + delta),
      });
      setAnswer((current) => current || result.answer);
      setAskStatus("ready");
    } catch {
      setAskStatus("error");
      setAnswer("Recall could not answer just now.");
    }
  };

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
                title={lowMotionFallback ? "Graph disabled by reduced-motion or device settings" : "Graph view"}
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
            <div className="hud-legend pointer-events-auto hidden w-40 p-3 sm:block" aria-label="Graph filters">
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
                <div className="hud-ring h-20 w-20" aria-label="Loading graph" />
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
          <div className="absolute inset-0 overflow-y-auto px-3 pb-32 pt-36 sm:px-6 sm:pt-24">
            <div className="mx-auto max-w-7xl">
              <div className="hud-panel mb-5 p-3">
                <div className="flex items-center gap-2">
                  <Search size={16} className="text-[#7dffd9]" />
                  <input
                    value={filters.q ?? ""}
                    onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
                    placeholder="Search everything instantly…"
                    className="min-w-0 flex-1 bg-transparent text-sm text-[#e8fff7] outline-none placeholder:text-[#8aa69c]"
                    data-testid="item-search"
                  />
                  <button type="button" onClick={() => setFiltersOpen((value) => !value)} className="hud-chip inline-flex items-center gap-1.5">
                    <SlidersHorizontal size={12} /> Filters
                  </button>
                </div>
                {filtersOpen && (
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-cyan-100/10 pt-3 sm:grid-cols-6" data-testid="search-filters">
                    <select value={filters.type ?? ""} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))} className="hud-field">
                      <option value="">All types</option>
                      <option value="note">Notes</option>
                      <option value="link">Links</option>
                      <option value="image">Images</option>
                      <option value="pdf">PDFs</option>
                    </select>
                    <select value={filters.source ?? ""} onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))} className="hud-field">
                      <option value="">All sources</option>
                      <option value="recall">Recall</option>
                      <option value="evernote">Evernote</option>
                    </select>
                    <select value={filters.notebook ?? ""} onChange={(event) => setFilters((current) => ({ ...current, notebook: event.target.value }))} className="hud-field">
                      <option value="">All notebooks</option>
                      {facets.notebooks.map((notebook) => <option key={notebook}>{notebook}</option>)}
                    </select>
                    <select value={filters.tag ?? ""} onChange={(event) => setFilters((current) => ({ ...current, tag: event.target.value }))} className="hud-field">
                      <option value="">All tags</option>
                      {facets.tags.map((tag) => <option key={tag}>{tag}</option>)}
                    </select>
                    <input type="date" value={filters.dateFrom ?? ""} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} className="hud-field" aria-label="From date" />
                    <label className="hud-field flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={Boolean(filters.trash)} onChange={(event) => setFilters((current) => ({ ...current, trash: event.target.checked }))} />
                      Trash
                    </label>
                  </div>
                )}
              </div>
              {items.length ? (
                <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4" data-testid="masonry-grid">
                  {items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onOpen={() => navigate(`/everything/${encodeURIComponent(item.id)}?view=grid`)}
                    />
                  ))}
                </div>
              ) : (
                <div className="hud-panel py-16 text-center">
                  <FileImage className="mx-auto text-[#8fd8c2]" />
                  <p className="mt-3 text-sm text-[#c9d6d2]">Nothing matches these filters.</p>
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
              <div className={`assistant-ring ${askStatus === "thinking" ? "is-thinking" : ""}`}>
                <div>
                  <span>R.E.C.A.L.L.</span>
                  <small>{askStatus === "thinking" ? "THINKING" : "ONLINE"}</small>
                </div>
              </div>
              <span className="assistant-status">
                <span className="h-1.5 w-1.5 rounded-full bg-[#7dffd9] shadow-[0_0_8px_#7dffd9]" />
                {askStatus === "thinking" ? "PROCESSING" : "READY"}
              </span>
            </div>

            <form onSubmit={submitAsk} className="assistant-panel absolute bottom-3 left-1/2 z-30 w-[min(680px,calc(100%-24px))] -translate-x-1/2 sm:bottom-5">
              {answer && <p className="mb-2 max-h-24 overflow-y-auto text-xs leading-5 text-[#c9d6d2]">{answer}</p>}
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-[#ffcf7d]" />
                <input
                  value={ask}
                  onChange={(event) => setAsk(event.target.value)}
                  placeholder="Ask Recall about what you see…"
                  aria-label="Ask Recall"
                  className="min-w-0 flex-1 bg-transparent text-sm text-[#e8fff7] outline-none placeholder:text-[#8aa69c]"
                />
                <button type="submit" disabled={!ask.trim() || askStatus === "thinking"} className="rounded-full p-2 text-[#7dffd9] hover:bg-cyan-200/10 disabled:opacity-40" aria-label="Submit Ask">
                  <Send size={16} />
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
                <h2 className="mt-1 font-semibold text-[#e8fff7]">{hubNode.label}</h2>
              </div>
              <button type="button" onClick={() => setHubNode(null)} aria-label="Close"><X size={15} /></button>
            </div>
            <button type="button" onClick={() => navigate(hubNode.href)} className="mt-4 text-xs font-semibold text-[#7dffd9]">
              Browse related items
            </button>
          </div>
        )}

        {detail && <ItemDetail item={detail} onClose={() => navigate("/")} />}
      </div>
    </AppLayout>
  );
}
