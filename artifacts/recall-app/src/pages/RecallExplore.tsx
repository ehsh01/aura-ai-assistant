import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";
import {
  Download,
  ExternalLink,
  File,
  Grid3X3,
  Loader2,
  Network,
  Plus,
  Send,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { KnowledgeGraph } from "@/components/KnowledgeGraph";
import { MicButton, showSpeechError } from "@/components/MicButton";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { toast } from "@/hooks/use-toast";
import { shouldUseGridFallback } from "@/lib/graph-performance";
import {
  classifyOneBoxInput,
  isShowMeFollowUp,
  voiceAnswerForSpeech,
  voicePresentationFor,
  type VoicePresentation,
} from "@/lib/one-box-rules";
import {
  deleteSavedItem,
  fetchKnowledgeGraph,
  getAskAiAvailability,
  getVoiceAiAvailability,
  getSavedItem,
  listSavedItems,
  queryRecallStream,
  queryVoiceRecall,
  savedItemMediaUrl,
  saveImageItem,
  saveTextItem,
  searchExplore,
  type AskAiAvailability,
  type ExploreSearchResult,
  type KnowledgeGraphNode,
  type KnowledgeGraphNodeType,
  type KnowledgeGraphResponse,
  type QueryRecallResult,
  type SavedItemRecord,
  VoiceQueryError,
} from "@/lib/recall-api";
import { speakText, stopSpeaking } from "@/lib/speech-synthesis";
import {
  createVoiceSessionState,
  isVoiceSessionActive,
  shouldBargeIn,
  voiceSessionReducer,
} from "@/lib/voice-conversation-state";

const ALL_GRAPH_TYPES: KnowledgeGraphNodeType[] = [
  "notes",
  "notebooks",
  "tags",
  "links",
  "files",
  "evernote",
];
const VOICE_LIMIT_REPLY = "Daily voice limit reached. Free search still works.";
const VOICE_MONTHLY_LIMIT_REPLY =
  "Monthly voice limit reached. Free search still works.";

type ActionChip =
  | { kind: "saved"; itemId: string | null; label: string }
  | { kind: "search"; value: string }
  | null;

type VoiceTurn = {
  id: string;
  question: string;
  answer: string;
  results: ExploreSearchResult[];
  presentation: VoicePresentation;
  showAll: boolean;
};

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

function displayDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function itemVisual(item: SavedItemRecord): string | null {
  if (item.media.storagePath) return savedItemMediaUrl(item.id);
  return item.media.remoteUrl ?? null;
}

function SourceMeta({
  source,
  notebook,
  date,
}: {
  source: string;
  notebook: string | null;
  date: string | null;
}) {
  return (
    <span className="recall-source-label">
      {source}
      {notebook ? ` · ${notebook}` : ""}
      {displayDate(date) ? ` · ${displayDate(date)}` : ""}
    </span>
  );
}

function SearchCard({
  result,
  onPreview,
}: {
  result: ExploreSearchResult;
  onPreview: (url: string, title: string) => void;
}) {
  const open = () => {
    if (result.document?.previewUrl) {
      onPreview(result.document.previewUrl, result.document.name);
    } else if (result.openUrl) {
      window.open(result.openUrl, "_blank", "noopener,noreferrer");
    }
  };
  return (
    <article
      className={`recall-result-card ${result.document ? "is-document" : ""}`}
      data-testid="one-box-result"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <SourceMeta
            source={result.source}
            notebook={result.notebook}
            date={result.date}
          />
          <h3 className="mt-1 truncate text-sm font-semibold text-[#e8fff7]">
            {result.title}
          </h3>
        </div>
        {result.document && <File size={17} className="text-[#ffcf7d]" />}
      </div>
      {result.snippet && (
        <p className="mt-2 line-clamp-3 text-xs leading-5 text-[#aebfba]">
          {result.snippet}
        </p>
      )}
      {(result.document || result.openUrl) && (
        <div className="mt-3 flex gap-2">
          {(result.document?.previewUrl || result.openUrl) && (
            <button
              type="button"
              onClick={open}
              className="recall-document-action"
            >
              Open <ExternalLink size={12} />
            </button>
          )}
          {result.document && (
            <a
              href={result.document.downloadUrl}
              className="recall-document-action"
              data-testid="document-download"
            >
              Download <Download size={12} />
            </a>
          )}
        </div>
      )}
    </article>
  );
}

function DocumentCard({
  result,
  onPreview,
}: {
  result: ExploreSearchResult;
  onPreview: (url: string, title: string) => void;
}) {
  if (!result.document) return null;
  return (
    <div className="recall-document-hero" data-testid="document-card">
      <div className="recall-document-icon">
        <File size={28} />
      </div>
      <div className="min-w-0 flex-1">
        <SourceMeta
          source={result.source}
          notebook={result.notebook}
          date={result.date}
        />
        <h3 className="mt-1 truncate text-base font-semibold text-[#f3f8f6]">
          {result.document.name}
        </h3>
        <div className="mt-3 flex gap-2">
          {(result.document.previewUrl || result.openUrl) && (
            <button
              type="button"
              className="recall-document-action is-primary"
              onClick={() =>
                result.document?.previewUrl
                  ? onPreview(result.document.previewUrl, result.document.name)
                  : result.openUrl &&
                    window.open(result.openUrl, "_blank", "noopener,noreferrer")
              }
            >
              Open
            </button>
          )}
          <a
            href={result.document.downloadUrl}
            className="recall-document-action"
          >
            Download <Download size={12} />
          </a>
        </div>
      </div>
    </div>
  );
}

function GridCard({
  item,
  onOpen,
}: {
  item: SavedItemRecord;
  onOpen: () => void;
}) {
  const visual = itemVisual(item);
  const source =
    item.source === "evernote"
      ? "Evernote"
      : ["image", "pdf", "file"].includes(item.kind)
        ? "File"
        : item.kind === "link"
          ? "Link"
          : "Note";
  return (
    <button
      type="button"
      className="hud-panel mb-4 block w-full break-inside-avoid overflow-hidden text-left"
      onClick={onOpen}
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
        <SourceMeta
          source={source}
          notebook={item.notebook}
          date={item.createdAt}
        />
        <h2 className="mt-2 text-base font-semibold text-[#e8fff7]">
          {item.title}
        </h2>
        {(item.description || item.bodyText) && (
          <p className="mt-2 line-clamp-4 text-sm leading-6 text-[#c9d6d2]">
            {item.description || item.bodyText}
          </p>
        )}
      </div>
    </button>
  );
}

export function RecallExplore() {
  const [location] = useLocation();
  const initialQuery = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const lowMotionFallback = useLowMotionFallback();
  const [mode, setMode] = useState<"graph" | "grid">(
    initialQuery.get("view") === "grid" ? "grid" : "graph",
  );
  const [value, setValue] = useState(
    () => initialQuery.get("url") ?? initialQuery.get("text") ?? "",
  );
  const [attachment, setAttachment] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<SavedItemRecord[]>([]);
  const [graph, setGraph] = useState<KnowledgeGraphResponse>({
    nodes: [],
    edges: [],
    page: { offset: 0, limit: 350, nextOffset: null },
  });
  const [selectedItem, setSelectedItem] = useState<SavedItemRecord | null>(
    null,
  );
  const [results, setResults] = useState<ExploreSearchResult[]>([]);
  const [answer, setAnswer] = useState("");
  const [aiResult, setAiResult] = useState<QueryRecallResult | null>(null);
  const [aiAvailability, setAiAvailability] =
    useState<AskAiAvailability | null>(null);
  const [panelMode, setPanelMode] = useState<
    "idle" | "search" | "ai" | "voice"
  >("idle");
  const [chip, setChip] = useState<ActionChip>(null);
  const [voiceTurn, setVoiceTurn] = useState<VoiceTurn | null>(null);
  const [voiceThreadId, setVoiceThreadId] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [voiceSession, dispatchVoiceSession] = useReducer(
    voiceSessionReducer,
    undefined,
    () => createVoiceSessionState(),
  );
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(
    null,
  );
  const chipTimer = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadWorkspace = useCallback(async () => {
    const [listed, mapped] = await Promise.all([
      listSavedItems({ limit: 150 }),
      fetchKnowledgeGraph({
        types: ALL_GRAPH_TYPES,
        limit: window.innerWidth < 640 ? 180 : 350,
      }),
    ]);
    setItems(listed.items);
    setGraph(mapped);
  }, []);

  useEffect(() => {
    if (lowMotionFallback) setMode("grid");
  }, [lowMotionFallback]);

  useEffect(() => {
    void loadWorkspace().catch(() =>
      toast({
        title: "Could not load Explore",
        description: "Try again in a moment.",
        variant: "destructive",
      }),
    );
    void getAskAiAvailability()
      .then(setAiAvailability)
      .catch(() =>
        setAiAvailability({
          allowed: false,
          model: null,
          reason: "unavailable",
        }),
      );
    void getVoiceAiAvailability()
      .then(({ sessionSilenceMs }) => {
        if (Number.isFinite(sessionSilenceMs)) {
          dispatchVoiceSession({
            type: "configure",
            silenceTimeoutMs: sessionSilenceMs,
            now: Date.now(),
          });
        }
      })
      .catch(() => undefined);
    return () => stopSpeaking();
  }, [loadWorkspace]);

  useEffect(() => {
    const itemId = location.match(/^\/everything\/([^/?#]+)/)?.[1];
    if (!itemId) {
      setSelectedItem(null);
      return;
    }
    void getSavedItem(decodeURIComponent(itemId))
      .then((response) => setSelectedItem(response.item))
      .catch(() => setSelectedItem(null));
  }, [location]);

  const showChip = useCallback((next: ActionChip, timeout = 8_000) => {
    if (chipTimer.current) window.clearTimeout(chipTimer.current);
    setChip(next);
    if (next && timeout > 0) {
      chipTimer.current = window.setTimeout(() => setChip(null), timeout);
    }
  }, []);

  const save = useCallback(
    async (text: string, file: File | null) => {
      if (busy || (!text.trim() && !file)) return;
      setBusy(true);
      try {
        const created = file
          ? await saveImageItem(file, text)
          : await saveTextItem(text);
        setValue("");
        setAttachment(null);
        setPanelMode("idle");
        setResults([]);
        showChip({
          kind: "saved",
          itemId: created.existing ? null : created.item.id,
          label: created.existing ? "Already saved" : "Saved",
        });
        await loadWorkspace();
      } catch (error) {
        toast({
          title: "Could not save",
          description: error instanceof Error ? error.message : "Try again",
          variant: "destructive",
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, loadWorkspace, showChip],
  );

  const runSearch = useCallback(
    async (query: string) => {
      const clean = query.trim();
      if (!clean || busy) return [] as ExploreSearchResult[];
      setBusy(true);
      setPanelMode("search");
      setAnswer("");
      setAiResult(null);
      setVoiceTurn(null);
      showChip({ kind: "search", value: clean }, 0);
      try {
        const response = await searchExplore(clean, 20);
        setResults(response.results);
        return response.results;
      } catch (error) {
        toast({
          title: "Search failed",
          description: error instanceof Error ? error.message : "Try again",
          variant: "destructive",
        });
        setResults([]);
        return [];
      } finally {
        setBusy(false);
      }
    },
    [busy, showChip],
  );

  const submit = useCallback(
    async (forceSave = false) => {
      const decision = classifyOneBoxInput({
        value,
        hasAttachment: Boolean(attachment),
        forceSave,
      });
      if (decision.intent === "save") {
        await save(decision.value, attachment);
      } else {
        setValue(decision.value);
        await runSearch(decision.value);
      }
    },
    [attachment, runSearch, save, value],
  );

  const showVoiceTurn = useCallback(() => {
    setVoiceTurn((current) =>
      current ? { ...current, showAll: true } : current,
    );
    setPanelMode("voice");
  }, []);

  const runVoiceSearch = useCallback(
    async (question: string) => {
      if (busy) return;
      let freeResults: ExploreSearchResult[] = [];
      setBusy(true);
      dispatchVoiceSession({ type: "turn-started" });
      setPanelMode("voice");
      showChip({ kind: "search", value: question }, 0);
      setValue(question);
      try {
        const free = await searchExplore(question, 20).catch(() => ({
          results: [] as ExploreSearchResult[],
        }));
        freeResults = free.results;
        setResults(freeResults);
        const result = await queryVoiceRecall(question, {
          threadId: voiceThreadId,
        });
        setVoiceThreadId(result.threadId);
        const presentation = voicePresentationFor({
          query: question,
          bestIsDocument: Boolean(freeResults[0]?.document),
          answer: result.answer,
        });
        const sourceKeys = new Set(
          result.sources.map((source) => source.itemId),
        );
        let proofResults = freeResults.filter(
          (entry) =>
            sourceKeys.has(entry.id) ||
            (entry.itemId != null && sourceKeys.has(entry.itemId)),
        );
        const documentResult = freeResults.find((entry) => entry.document);
        if (
          presentation === "document" &&
          documentResult &&
          sourceKeys.size === 0 &&
          !proofResults.includes(documentResult)
        ) {
          proofResults = [documentResult, ...proofResults];
        }
        if (proofResults.length === 0) proofResults = freeResults;
        const responseCapReply =
          result.limitReason === "monthly_limit"
            ? VOICE_MONTHLY_LIMIT_REPLY
            : result.limitReason === "daily_limit"
              ? VOICE_LIMIT_REPLY
              : null;
        const answerForSpeech = voiceAnswerForSpeech(
          result.answer,
          presentation,
        );
        const spokenAnswer = responseCapReply
          ? `${answerForSpeech} ${responseCapReply}`
          : answerForSpeech;
        setVoiceTurn({
          id: `${Date.now()}`,
          question,
          answer: spokenAnswer,
          results: proofResults,
          presentation,
          showAll: Boolean(responseCapReply),
        });
        setSpeaking(true);
        if (responseCapReply) {
          dispatchVoiceSession({
            type: "cap-reached",
            message: responseCapReply,
          });
        } else {
          dispatchVoiceSession({ type: "speaking-started" });
        }
        void (async () => {
          let blockedReason:
            | "disabled"
            | "daily_limit"
            | "monthly_limit"
            | null = null;
          const started = await speakText(spokenAnswer, {
            premium: !responseCapReply,
            onBlocked: (reason) => {
              blockedReason = reason;
              return reason === "daily_limit" || reason === "monthly_limit";
            },
            onEnd: () => {
              setSpeaking(false);
              dispatchVoiceSession({ type: "listen", now: Date.now() });
            },
            onError: () => {
              setSpeaking(false);
              dispatchVoiceSession({ type: "listen", now: Date.now() });
            },
          });
          if (
            blockedReason === "daily_limit" ||
            blockedReason === "monthly_limit"
          ) {
            const capReply =
              blockedReason === "monthly_limit"
                ? VOICE_MONTHLY_LIMIT_REPLY
                : VOICE_LIMIT_REPLY;
            setVoiceTurn({
              id: `${Date.now()}`,
              question,
              answer: capReply,
              results: [],
              presentation: "fact",
              showAll: true,
            });
            dispatchVoiceSession({
              type: "cap-reached",
              message: capReply,
            });
            const fallbackStarted = await speakText(capReply, {
              premium: false,
              onEnd: () => setSpeaking(false),
              onError: () => setSpeaking(false),
            });
            if (!fallbackStarted) setSpeaking(false);
            return;
          }
          if (!started) setSpeaking(false);
        })();
      } catch (error) {
        const capReached =
          error instanceof VoiceQueryError &&
          (error.reason === "daily_limit" || error.reason === "monthly_limit");
        const blocked =
          error instanceof VoiceQueryError &&
          (error.reason === "disabled" || capReached);
        const fallback =
          error instanceof VoiceQueryError
            ? error.reason === "monthly_limit"
              ? VOICE_MONTHLY_LIMIT_REPLY
              : error.reason === "daily_limit"
                ? VOICE_LIMIT_REPLY
                : freeVoiceAnswer(freeResults)
            : freeVoiceAnswer(freeResults);
        const presentation = capReached
          ? ("fact" as const)
          : voicePresentationFor({
              query: question,
              bestIsDocument: Boolean(freeResults[0]?.document),
              answer: fallback,
            });
        const spokenAnswer = voiceAnswerForSpeech(fallback, presentation);
        setVoiceTurn({
          id: `${Date.now()}`,
          question,
          answer: spokenAnswer,
          results: freeResults,
          presentation,
          showAll: capReached,
        });
        if (capReached) {
          dispatchVoiceSession({
            type: "cap-reached",
            message: fallback,
          });
        }
        if (blocked) {
          setSpeaking(true);
          void speakText(spokenAnswer, {
            premium: false,
            onEnd: () => {
              setSpeaking(false);
              if (!capReached) {
                dispatchVoiceSession({ type: "listen", now: Date.now() });
              }
            },
            onError: () => {
              setSpeaking(false);
              if (!capReached) {
                dispatchVoiceSession({ type: "listen", now: Date.now() });
              }
            },
          });
        } else {
          dispatchVoiceSession({ type: "listen", now: Date.now() });
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, showChip, voiceThreadId],
  );

  const submitVoice = useCallback(
    (transcript: string) => {
      if (isShowMeFollowUp(transcript)) {
        if (voiceTurn) showVoiceTurn();
        else
          toast({
            title: "Nothing to show yet",
            description: "Ask Recall something first.",
          });
        dispatchVoiceSession({ type: "listen", now: Date.now() });
        return;
      }
      const decision = classifyOneBoxInput({
        value: transcript,
        voice: true,
      });
      if (!decision.value) return;
      if (decision.intent === "save") {
        dispatchVoiceSession({ type: "turn-started" });
        void save(decision.value, null).finally(() =>
          dispatchVoiceSession({ type: "listen", now: Date.now() }),
        );
      } else {
        void runVoiceSearch(decision.value);
      }
    },
    [runVoiceSearch, save, showVoiceTurn, voiceTurn],
  );

  const speech = useSpeechInput(submitVoice, {
    allowServerTranscription: false,
    onError: (error) => {
      if (error === "no-speech" && isVoiceSessionActive(voiceSession)) {
        return;
      }
      showSpeechError(error);
    },
    onSpeechStart: () => {
      if (!isVoiceSessionActive(voiceSession)) return;
      if (shouldBargeIn(voiceSession) || speaking) {
        stopSpeaking();
        setSpeaking(false);
      }
      dispatchVoiceSession({ type: "speech-started", now: Date.now() });
    },
  });
  const voiceSessionActive = isVoiceSessionActive(voiceSession);

  useEffect(() => {
    if (
      !voiceSessionActive ||
      busy ||
      speech.listening ||
      speech.transcribing ||
      (voiceSession.phase !== "listening" && voiceSession.phase !== "speaking")
    ) {
      return;
    }
    let cancelled = false;
    void speech.start().then((result) => {
      if (!cancelled && !result.ok) {
        dispatchVoiceSession({
          type: "stop",
          message: "Voice session ended because the microphone is unavailable.",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    busy,
    speech.listening,
    speech.start,
    speech.transcribing,
    voiceSession.phase,
    voiceSessionActive,
  ]);

  useEffect(() => {
    if (
      voiceSession.phase !== "listening" ||
      voiceSession.silenceDeadlineAt === null
    ) {
      return;
    }
    const delay = Math.max(0, voiceSession.silenceDeadlineAt - Date.now());
    const timer = window.setTimeout(() => {
      const now = Date.now();
      dispatchVoiceSession({ type: "silence-timeout", now });
      speech.stop();
      stopSpeaking();
      setSpeaking(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [speech.stop, voiceSession.phase, voiceSession.silenceDeadlineAt]);
  const ringState = speech.listening
    ? "listening"
    : speaking
      ? "speaking"
      : busy
        ? panelMode === "search"
          ? "searching"
          : "thinking"
        : voiceSession.phase === "cap-reached"
          ? "cap-reached"
          : "ready";
  const silenceSeconds = Math.round(voiceSession.silenceTimeoutMs / 1_000);
  const voiceSessionLabel = voiceSessionActive
    ? `${voiceSession.phase.toUpperCase()} · ${silenceSeconds}S SILENCE`
    : voiceSession.phase === "cap-reached"
      ? "STOPPED · CAP"
      : voiceSession.phase === "ended"
        ? `ENDED · ${silenceSeconds}S SILENCE`
        : `READY · ${silenceSeconds}S SILENCE`;

  const beforeMic = useCallback(() => {
    if (isVoiceSessionActive(voiceSession)) {
      speech.stop();
      stopSpeaking();
      setSpeaking(false);
      dispatchVoiceSession({ type: "stop" });
      return false;
    }
    if (!speaking) return true;
    stopSpeaking();
    setSpeaking(false);
    return false;
  }, [speaking, speech, voiceSession]);

  const submitAi = async () => {
    const question = value.trim();
    if (!question || busy || !aiAvailability?.allowed) return;
    setBusy(true);
    setPanelMode("ai");
    setAnswer("");
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
    } catch {
      setAnswer("Recall could not answer just now.");
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (chip?.kind !== "saved" || !chip.itemId) return;
    const itemId = chip.itemId;
    setChip(null);
    try {
      await deleteSavedItem(itemId);
      await loadWorkspace();
      toast({ title: "Save undone" });
    } catch {
      toast({
        title: "Could not undo",
        description: "The saved item was not changed.",
        variant: "destructive",
      });
    }
  };

  const saveInstead = async () => {
    if (chip?.kind !== "search") return;
    await save(chip.value, null);
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const file = Array.from(event.clipboardData.files)[0];
    if (file) {
      event.preventDefault();
      setAttachment(file);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) setAttachment(file);
  };

  const openGraphNode = (node: KnowledgeGraphNode) => {
    if (!node.itemId) return;
    void getSavedItem(node.itemId)
      .then((response) => setSelectedItem(response.item))
      .catch(() => undefined);
  };

  const voiceDocument = voiceTurn?.results.find((entry) => entry.document);
  const showPanel =
    panelMode !== "idle" &&
    (busy ||
      results.length > 0 ||
      answer ||
      voiceTurn ||
      panelMode === "search");

  return (
    <AppLayout immersive>
      <div
        className="explore-shell relative h-full min-h-0 overflow-hidden text-[#dce8e4]"
        onDrop={onDrop}
        onDragOver={(event) => event.preventDefault()}
        data-testid="recall-explore"
      >
        <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between py-3 pl-14 pr-3 sm:p-5">
          <div className="pointer-events-auto flex items-center gap-3">
            <div>
              <p className="hud-label text-[#7dffd9]">Recall / Explore</p>
              <h1 className="mt-1 hidden text-lg font-semibold text-[#e8fff7] sm:block">
                Save or find anything
              </h1>
            </div>
            <div className="flex rounded-full border border-cyan-100/15 bg-[#07110f]/80 p-1 backdrop-blur-md">
              <button
                type="button"
                onClick={() => setMode("graph")}
                disabled={lowMotionFallback}
                className={`hud-view-toggle ${mode === "graph" ? "is-active" : ""}`}
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
        </header>

        {mode === "graph" ? (
          <div className="absolute inset-0 pb-28 pt-16 sm:pb-32">
            <KnowledgeGraph
              nodes={graph.nodes}
              edges={graph.edges}
              focus={false}
              holo
              labels={false}
              onNodeClick={openGraphNode}
            />
          </div>
        ) : (
          <div className="absolute inset-0 overflow-y-auto px-3 pb-48 pt-20 sm:px-6 sm:pb-52 sm:pt-24">
            <div className="mx-auto max-w-7xl">
              {items.length ? (
                <div
                  className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4"
                  data-testid="masonry-grid"
                >
                  {items.map((item) => (
                    <GridCard
                      key={item.id}
                      item={item}
                      onOpen={() => setSelectedItem(item)}
                    />
                  ))}
                </div>
              ) : (
                <div className="hud-panel py-16 text-center text-sm text-[#9fb4ab]">
                  Your saved items will appear here.
                </div>
              )}
            </div>
          </div>
        )}

        {showPanel && (
          <section
            className="recall-one-box-output assistant-panel absolute left-1/2 z-40 w-[min(760px,calc(100%-24px))] -translate-x-1/2 overflow-y-auto"
            data-testid="ask-output-panel"
            aria-live="polite"
          >
            {busy && !voiceTurn && (
              <div className="flex items-center gap-2 py-2 text-sm text-[#b8fff2]">
                <Loader2 size={16} className="animate-spin" />
                {panelMode === "ai"
                  ? "Recall is thinking…"
                  : "Searching everything…"}
              </div>
            )}
            {panelMode === "search" && !busy && (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <p className="hud-label text-[#8fd8c2]">
                    {results.length} result{results.length === 1 ? "" : "s"}
                  </p>
                  <span className="text-[10px] text-[#8aa69c]">
                    Free search · no AI
                  </span>
                </div>
                {results.length ? (
                  <div
                    className="grid gap-2 sm:grid-cols-2"
                    data-testid="keyword-results"
                  >
                    {results.map((result) => (
                      <SearchCard
                        key={result.id}
                        result={result}
                        onPreview={(url, title) => setPreview({ url, title })}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="py-3 text-sm text-[#9fb4ab]">
                    Not found in Recall.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void submitAi()}
                  disabled={!aiAvailability?.allowed || busy}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-200/20 bg-amber-200/10 px-3 py-1.5 text-xs font-semibold text-[#ffcf7d] disabled:opacity-40"
                >
                  <Sparkles size={12} /> Ask AI
                </button>
              </>
            )}
            {panelMode === "ai" && (
              <div data-testid="ai-answer">
                <p className="hud-label mb-2 text-[#ffcf7d]">Ask AI</p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[#e8fff7]">
                  {answer}
                </p>
                {aiResult && (
                  <p className="mt-3 text-[10px] text-[#8aa69c]">
                    Answered from {aiResult.relatedRecords.length} Recall source
                    {aiResult.relatedRecords.length === 1 ? "" : "s"}
                  </p>
                )}
              </div>
            )}
            {panelMode === "voice" && voiceTurn && (
              <div data-testid="voice-answer-state">
                <div className="mb-3 flex items-center justify-between">
                  <p className="hud-label text-[#ffcf7d]">Recall</p>
                  <span className="text-[10px] text-[#8aa69c]">
                    {speaking ? "Speaking in onyx" : "Answer spoken"}
                  </span>
                </div>
                {voiceTurn.showAll && (
                  <div data-testid="show-me-state">
                    <p className="mb-3 text-sm leading-6 text-[#f3f8f6]">
                      {voiceTurn.answer}
                    </p>
                    {voiceDocument && (
                      <div className="mb-2">
                        <DocumentCard
                          result={voiceDocument}
                          onPreview={(url, title) => setPreview({ url, title })}
                        />
                      </div>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {voiceTurn.results
                        .filter((result) => result !== voiceDocument)
                        .map((result) => (
                          <SearchCard
                            key={result.id}
                            result={result}
                            onPreview={(url, title) =>
                              setPreview({ url, title })
                            }
                          />
                        ))}
                    </div>
                  </div>
                )}
                {!voiceTurn.showAll && (
                  <div
                    className="flex items-center gap-4"
                    data-testid="voice-spoken-only"
                  >
                    <button
                      type="button"
                      className="text-xs font-semibold text-[#7dffd9]"
                      onClick={showVoiceTurn}
                      data-testid="show-voice-results"
                    >
                      Show
                    </button>
                    {speaking && (
                      <button
                        type="button"
                        className="text-xs font-semibold text-[#ffcf7d]"
                        onClick={() => {
                          stopSpeaking();
                          setSpeaking(false);
                        }}
                      >
                        Stop
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <div className="recall-one-box-wrap absolute bottom-3 left-1/2 z-50 w-[min(760px,calc(100%-24px))] -translate-x-1/2 sm:bottom-5">
          {chip && (
            <div
              className="recall-action-chip"
              data-testid="one-box-action-chip"
            >
              <span>
                {chip.kind === "saved" ? `✓ ${chip.label}` : "⌕ Searching"}
              </span>
              {chip.kind === "saved" && chip.itemId ? (
                <button type="button" onClick={() => void undo()}>
                  <Undo2 size={12} /> Undo
                </button>
              ) : chip.kind === "search" ? (
                <button type="button" onClick={() => void saveInstead()}>
                  Save instead
                </button>
              ) : null}
            </div>
          )}
          <form
            className="recall-one-box"
            data-testid="one-box"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void submit();
            }}
          >
            <button
              type="button"
              className="recall-plus"
              aria-label="Attach a file"
              onClick={() => fileInput.current?.click()}
            >
              <Plus size={20} />
            </button>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(event) => {
                setAttachment(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
            <div className="min-w-0 flex-1">
              {attachment && (
                <div className="recall-attachment">
                  <File size={12} />
                  <span className="truncate">{attachment.name}</span>
                  <button
                    type="button"
                    aria-label="Remove attachment"
                    onClick={() => setAttachment(null)}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              <input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onPaste={onPaste}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey)
                  ) {
                    event.preventDefault();
                    void submit(true);
                  }
                }}
                placeholder="Tell or ask Recall anything…"
                aria-label="Tell or ask Recall"
                className="w-full bg-transparent text-base text-[#e8fff7] outline-none placeholder:text-[#789188] sm:text-sm"
              />
            </div>
            <button
              type="submit"
              className="recall-send"
              aria-label="Send to Recall"
              disabled={busy || (!value.trim() && !attachment)}
            >
              {busy ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Send size={18} />
              )}
            </button>
            <MicButton
              onTranscript={submitVoice}
              controller={speech}
              className={`assistant-ring recall-one-box-ring is-${ringState}`}
              iconSize={44}
              title="Talk to Recall"
              testId="recall-ring-mic"
              listeningLabel={
                <>
                  <span className="assistant-ring-name">R.E.C.A.L.L.</span>
                  <small data-testid="voice-session-state">
                    {voiceSessionLabel}
                  </small>
                </>
              }
              holdToTalk
              quiet
              onBeforeToggle={beforeMic}
              onActivated={() =>
                dispatchVoiceSession({ type: "start", now: Date.now() })
              }
            >
              <span className="assistant-ring-name">R.E.C.A.L.L.</span>
              <small data-testid="voice-session-state">
                {voiceSessionLabel}
              </small>
            </MicButton>
          </form>
        </div>

        {selectedItem && (
          <aside className="hud-detail absolute inset-y-0 right-0 z-[60] w-full overflow-y-auto p-5 sm:w-[440px]">
            <button
              type="button"
              onClick={() => setSelectedItem(null)}
              className="float-right rounded-full p-2 text-[#8fd8c2]"
              aria-label="Close item"
            >
              <X size={16} />
            </button>
            <SourceMeta
              source={
                selectedItem.source === "evernote" ? "Evernote" : "Recall"
              }
              notebook={selectedItem.notebook}
              date={selectedItem.createdAt}
            />
            <h2 className="mt-5 text-2xl font-semibold text-[#e8fff7]">
              {selectedItem.title}
            </h2>
            <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-[#dce8e4]">
              {selectedItem.description || selectedItem.bodyText}
            </p>
          </aside>
        )}

        {preview && (
          <div
            className="recall-preview-backdrop z-[70]"
            data-testid="document-preview"
          >
            <div className="recall-preview">
              <div className="flex items-center justify-between border-b border-cyan-100/10 px-4 py-3">
                <h2 className="truncate text-sm font-semibold text-[#e8fff7]">
                  {preview.title}
                </h2>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  aria-label="Close preview"
                >
                  <X size={17} />
                </button>
              </div>
              <iframe
                src={preview.url}
                title={preview.title}
                sandbox=""
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function freeVoiceAnswer(results: ExploreSearchResult[]): string {
  if (results.length === 0) return "I couldn't find that in Recall.";
  return `I found ${results.length} match${results.length === 1 ? "" : "es"}. The top match is ${results[0]!.title}.`;
}
