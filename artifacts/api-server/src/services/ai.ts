import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { searchNotesForUser } from "./notes";
import {
  QUERY_ANSWER_SYSTEM_PROMPT,
  QUERY_ANSWER_STREAM_SYSTEM_PROMPT,
} from "../prompts/queryAnswer.v1";

// ---------------------------------------------------------------------------
// Types (mirror OpenAPI / api-zod shapes)
// ---------------------------------------------------------------------------

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface TaskContextItem {
  id: string;
  title: string;
  completed?: boolean;
  priority?: "high" | "med" | "medium" | "low" | "none";
  time?: string | null;
  tags?: string[];
}

export interface NoteContextItem {
  id: string;
  title: string;
  content?: string | null;
  preview?: string | null;
  tags?: string[];
}

export interface AiContext {
  userName?: string;
  tasks?: TaskContextItem[];
  notes?: NoteContextItem[];
}

export interface ExtractedTask {
  title: string;
  priority?: "high" | "med" | "medium" | "low" | "none";
  time?: string | null;
  tags?: string[];
}

export interface SemanticSearchItem {
  id: string;
  text: string;
  title?: string | null;
}

export interface SemanticSearchResult {
  id: string;
  text: string;
  title?: string | null;
  score: number;
}

export interface AiDegradedMeta {
  degraded: boolean;
  degradedReason?: string | null;
}

export interface AiStatus extends AiDegradedMeta {
  enabled: boolean;
  model: string | null;
  embeddingModel: string | null;
}

export interface ChatRequest {
  messages: ChatMessage[];
  context?: AiContext;
  /** Set by the API route so tools can search the user's full note library. */
  userId?: string;
}

export interface ChatResponse extends AiDegradedMeta {
  message: ChatMessage;
  model: string | null;
  openNote?: { id: string; title: string } | null;
}

export interface SummarizeNoteRequest {
  content: string;
  maxLength?: number;
}

export interface SummarizeNoteResponse extends AiDegradedMeta {
  summary: string;
}

export interface GenerateNoteTitleRequest {
  content: string;
}

export interface GenerateNoteTitleResponse extends AiDegradedMeta {
  title: string;
}

export interface ExtractTasksRequest {
  text: string;
}

export interface ExtractTasksResponse extends AiDegradedMeta {
  tasks: ExtractedTask[];
}

export interface SemanticSearchRequest {
  query: string;
  items: SemanticSearchItem[];
  limit?: number;
}

export interface SemanticSearchResponse extends AiDegradedMeta {
  results: SemanticSearchResult[];
}

export interface DashboardDigestRequest {
  userName?: string;
  tasks?: TaskContextItem[];
  notes?: NoteContextItem[];
}

export interface DashboardDigestResponse extends AiDegradedMeta {
  digest: string;
  highlights: string[];
}

export interface CaptureClassificationItem {
  cleanedTitle: string;
  suggestedType: "note" | "task" | "reminder" | "work_note" | "project_item" | "reference";
  suggestedPriority: "low" | "medium" | "high" | "urgent";
  suggestedDueDate: string | null;
  suggestedProject: string | null;
  suggestedTags: string[];
  suggestedActions: string[];
}

export interface ClassifyCaptureRequest {
  rawText: string;
  dueDate?: string | null;
  tags?: string[];
}

export interface ClassifyCaptureResponse extends AiDegradedMeta {
  item: CaptureClassificationItem;
}

export interface QueryContextRecord {
  entityType: string;
  entityId: string;
  title: string;
  text: string;
  /** Source timestamp already formatted in the user timezone — never truncated. */
  date?: string | null;
  pinned?: boolean;
}

export interface QueryFinanceAggregate {
  /** Net = income + expenses (expenses are negative in source data). */
  total: number;
  /** Dollars spent (sum of absolute expense amounts) — use for "how much did I spend". */
  spent: number;
  /** Dollars received (sum of positive amounts). */
  income: number;
  count: number;
  expenseCount: number;
  incomeCount: number;
  rangeLabel: string | null;
  topPayees: { payee: string; total: number; count: number }[];
  topCategories: { category: string; total: number; count: number }[];
  /** Exact $X.XX strings — prefer these in answers so cents stay correct. */
  formatted: {
    net: string;
    spent: string;
    income: string;
    topPayees: { payee: string; total: string; count: number }[];
    topCategories: { category: string; total: string; count: number }[];
  };
  /** Matching transactions for breakdown answers (newest first). */
  transactions: {
    date: string;
    payee: string;
    amount: number;
    amountFormatted: string;
    category: string | null;
    /** Present when finance classification ran. */
    kind?: "expense" | "income" | "transfer" | "credit_card_payment" | "refund";
  }[];
  /** True when transfers/CC payments were excluded from spent/income. */
  transfersExcluded?: boolean;
  /** Classification tallies for the aggregated window (when classified). */
  classificationCounts?: {
    expense: number;
    income: number;
    transfer: number;
    credit_card_payment: number;
    refund: number;
  };
}

export interface AnswerQueryRequest {
  question: string;
  today: string;
  /** Current local datetime label (same TZ as today), including clock time. */
  now?: string;
  records: QueryContextRecord[];
  finance?: QueryFinanceAggregate | null;
  /** Prior turns in this Ask thread (oldest → newest), excluding the current question. */
  conversation?: { role: "user" | "assistant"; content: string }[];
}

/** Cap context text sent to the answer model — notes keep enough body to be useful. */
function answerContextTextCap(
  entityType: string,
  opts?: { pinned?: boolean },
): number {
  if (entityType === "note") return 2_000;
  if (entityType === "person") return 800;
  if (entityType === "memory") return opts?.pinned ? 2_000 : 1_200;
  if (entityType === "source_record") return 1_200;
  return 500;
}

function truncateConversationTurn(
  turn: { role: "user" | "assistant"; content: string },
  index: number,
  total: number,
): { role: "user" | "assistant"; content: string } {
  const isLatestUser = index === total - 1 && turn.role === "user";
  return {
    role: turn.role,
    content: turn.content.slice(0, isLatestUser ? 1_200 : 600),
  };
}

export interface AnswerQueryResponse extends AiDegradedMeta {
  answer: string;
  confidence: number;
  caveats: string | null;
  suggestedNextAction: string | null;
}

export interface AnswerQueryStreamResult {
  answer: string;
  degraded: boolean;
}

export interface GenerateWorkNoteRequest {
  rawText: string;
  tone?: "concise" | "friendly" | "technical";
}

export interface GenerateWorkNoteResponse extends AiDegradedMeta {
  internalWorkNote: string;
  customerUpdate: string;
  transferReason: string;
  resolutionNote: string;
  emailReply: string;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface AiService {
  getStatus(): AiStatus;
  chat(request: ChatRequest): Promise<ChatResponse>;
  summarizeNote(request: SummarizeNoteRequest): Promise<SummarizeNoteResponse>;
  generateNoteTitle(
    request: GenerateNoteTitleRequest,
  ): Promise<GenerateNoteTitleResponse>;
  extractTasks(request: ExtractTasksRequest): Promise<ExtractTasksResponse>;
  semanticSearch(
    request: SemanticSearchRequest,
  ): Promise<SemanticSearchResponse>;
  dashboardDigest(
    request: DashboardDigestRequest,
  ): Promise<DashboardDigestResponse>;
  classifyCapture(request: ClassifyCaptureRequest): Promise<ClassifyCaptureResponse>;
  generateWorkNote(request: GenerateWorkNoteRequest): Promise<GenerateWorkNoteResponse>;
  answerQuery(request: AnswerQueryRequest): Promise<AnswerQueryResponse>;
  /**
   * Optional streaming variant of answerQuery. Streams the plain-text answer
   * via onToken and resolves with the full text. Only OpenAI-backed services
   * implement it; callers must fall back to answerQuery / rule-based answers.
   */
  answerQueryStream?(
    request: AnswerQueryRequest,
    onToken: (delta: string) => void,
  ): Promise<AnswerQueryStreamResult>;
  /** Optional: only OpenAI-backed services implement real embeddings. */
  embedTexts?(texts: string[]): Promise<number[][]>;
}

const DISABLED_REASON =
  "OPENAI_API_KEY is not configured. Add it to artifacts/api-server/.env to enable Recall AI.";

/** Keep prompts within model context limits even for large libraries. */
const MAX_CONTEXT_NOTES = 50;
const MAX_CONTEXT_TASKS = 100;
const MAX_NOTE_BODY_IN_PROMPT = 200;

function trimAiContext(context?: AiContext): {
  context: AiContext | undefined;
  totalNotes: number;
  totalTasks: number;
} {
  if (!context) {
    return { context, totalNotes: 0, totalTasks: 0 };
  }

  const totalNotes = context.notes?.length ?? 0;
  const totalTasks = context.tasks?.length ?? 0;

  const notes = context.notes?.slice(0, MAX_CONTEXT_NOTES).map((n) => ({
    id: n.id,
    title: n.title,
    preview: (n.preview ?? n.content ?? "").slice(0, MAX_NOTE_BODY_IN_PROMPT),
    tags: n.tags,
  }));

  const tasks = context.tasks?.slice(0, MAX_CONTEXT_TASKS);

  return {
    context: { ...context, notes, tasks },
    totalNotes,
    totalTasks,
  };
}

function isOpenAiContextError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "context_length_exceeded";
}

/**
 * Current date in the user's timezone so the model can resolve relative dates
 * ("tomorrow", "next Friday") to absolute ISO dates instead of hallucinating a
 * year from its training data.
 */
function currentDateContext(): { iso: string; weekday: string } {
  const tz = process.env.RECALL_TIMEZONE?.trim() || "America/New_York";
  const now = new Date();
  try {
    // en-CA formats as YYYY-MM-DD.
    const iso = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
    }).format(now);
    return { iso, weekday };
  } catch {
    const iso = now.toISOString().slice(0, 10);
    const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
    return { iso, weekday };
  }
}

/**
 * Accept only a real YYYY-MM-DD date that is today or later. Rejects free-text
 * ("Friday"), malformed dates, and hallucinated past dates (e.g. a wrong year).
 */
function normalizeDueDate(value: unknown, todayIso: string): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m! - 1 ||
    date.getUTCDate() !== d
  ) {
    return null; // not a real calendar date
  }
  return v >= todayIso ? v : null;
}

function degradedMeta(reason: string = DISABLED_REASON): AiDegradedMeta {
  return { degraded: true, degradedReason: reason };
}

function fallbackCaptureClassification(
  request: ClassifyCaptureRequest,
): CaptureClassificationItem {
  const raw = request.rawText.trim();
  const firstLine = raw.split(/\r?\n/).find(Boolean) ?? "Untitled capture";
  const lower = raw.toLowerCase();
  const isTask = /\b(todo|task|call|email|follow up|remind|schedule|send|check|fix)\b/.test(lower);
  const isReminder = /\b(remind|due|tomorrow|today|next week|appointment)\b/.test(lower);
  const isWork = /\b(ticket|user|vpn|printer|outlook|email|server|network|troubleshoot|support)\b/.test(lower);
  const isProject = /\b(permit|inspection|contractor|construction|project|city of miami)\b/.test(lower);
  const urgent = /\b(urgent|asap|critical|emergency|blocked|down)\b/.test(lower);
  const high = urgent || /\b(follow up|waiting|call|deadline|due today)\b/.test(lower);
  return {
    cleanedTitle: firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine,
    suggestedType: isReminder
      ? "reminder"
      : isTask
        ? "task"
        : isWork
          ? "work_note"
          : isProject
            ? "project_item"
            : "note",
    suggestedPriority: urgent ? "urgent" : high ? "high" : "medium",
    suggestedDueDate: request.dueDate ?? null,
    suggestedProject: null,
    suggestedTags: Array.from(new Set([...(request.tags ?? []), isWork ? "work" : "", isProject ? "project" : ""].filter(Boolean))),
    suggestedActions: [
      ...(isTask || isReminder ? ["Create task"] : []),
      ...(isWork ? ["Generate IT work note"] : []),
      ...(isProject ? ["Attach to project"] : []),
    ],
  };
}

function fallbackWorkNote(rawText: string): Omit<GenerateWorkNoteResponse, keyof AiDegradedMeta> {
  const text = rawText.trim();
  return {
    internalWorkNote: text,
    customerUpdate: `Reviewed the reported issue and documented the troubleshooting performed. Current notes: ${text.slice(0, 500)}`,
    transferReason: "Transfer if additional access, escalation, or specialized support is required.",
    resolutionNote: `Resolution details pending. Troubleshooting notes: ${text.slice(0, 500)}`,
    emailReply: `Hi,\n\nI reviewed this issue and documented the troubleshooting performed. I will follow up with the next step or resolution shortly.\n\nThank you.`,
  };
}

// ---------------------------------------------------------------------------
// Disabled implementation
// ---------------------------------------------------------------------------

class DisabledAiService implements AiService {
  getStatus(): AiStatus {
    return {
      enabled: false,
      model: null,
      embeddingModel: null,
      degraded: true,
      degradedReason: DISABLED_REASON,
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    return {
      ...degradedMeta(),
      message: {
        role: "assistant",
        content: lastUser
          ? `Recall AI is offline (${DISABLED_REASON}) I received: "${lastUser.content.slice(0, 120)}${lastUser.content.length > 120 ? "…" : ""}"`
          : `Recall AI is offline. ${DISABLED_REASON}`,
      },
      model: null,
    };
  }

  async summarizeNote(request: SummarizeNoteRequest): Promise<SummarizeNoteResponse> {
    const trimmed = request.content.trim();
    const max = request.maxLength ?? 400;
    const summary =
      trimmed.length <= max
        ? trimmed
        : `${trimmed.slice(0, max - 1).trimEnd()}…`;
    return { ...degradedMeta(), summary };
  }

  async generateNoteTitle(
    request: GenerateNoteTitleRequest,
  ): Promise<GenerateNoteTitleResponse> {
    const line = request.content.trim().split(/\n+/)[0] ?? "Untitled";
    const title =
      line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line || "Untitled";
    return { ...degradedMeta(), title };
  }

  async extractTasks(request: ExtractTasksRequest): Promise<ExtractTasksResponse> {
    const lines = request.text
      .split(/\n+/)
      .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
      .filter((l) => l.length > 3);
    const tasks = lines.slice(0, 8).map((title) => ({ title }));
    return { ...degradedMeta(), tasks };
  }

  async semanticSearch(
    request: SemanticSearchRequest,
  ): Promise<SemanticSearchResponse> {
    const q = request.query.toLowerCase();
    const results = request.items
      .map((item) => {
        const hay = `${item.title ?? ""} ${item.text}`.toLowerCase();
        const score = q
          .split(/\s+/)
          .filter(Boolean)
          .reduce((acc, term) => acc + (hay.includes(term) ? 1 : 0), 0);
        return {
          id: item.id,
          text: item.text,
          title: item.title ?? null,
          score,
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, request.limit ?? 5);
    return { ...degradedMeta(), results };
  }

  async dashboardDigest(
    request: DashboardDigestRequest,
  ): Promise<DashboardDigestResponse> {
    const name = request.userName ?? "there";
    const openTasks =
      request.tasks?.filter((t) => !t.completed).length ?? 0;
    const noteCount = request.notes?.length ?? 0;
    return {
      ...degradedMeta(),
      digest: `Good morning, ${name}. You have ${openTasks} open task(s) and ${noteCount} note(s) in context. Connect OPENAI_API_KEY for a personalized AI digest.`,
      highlights: [
        openTasks > 0 ? `${openTasks} tasks need attention` : "No open tasks in context",
        noteCount > 0 ? `${noteCount} notes available` : "No notes in context",
      ],
    };
  }

  async classifyCapture(request: ClassifyCaptureRequest): Promise<ClassifyCaptureResponse> {
    return { ...degradedMeta(), item: fallbackCaptureClassification(request) };
  }

  async generateWorkNote(
    request: GenerateWorkNoteRequest,
  ): Promise<GenerateWorkNoteResponse> {
    return { ...degradedMeta(), ...fallbackWorkNote(request.rawText) };
  }

  async answerQuery(request: AnswerQueryRequest): Promise<AnswerQueryResponse> {
    // Deterministic fallback; the query engine has richer rule-based logic and
    // will generally not call this when AI is disabled.
    const parts: string[] = [];
    if (request.finance) {
      const f = request.finance;
      parts.push(
        `Across ${f.count} transaction(s)${
          f.rangeLabel ? ` (${f.rangeLabel})` : ""
        }: spent ${f.formatted.spent}, income ${f.formatted.income}, net ${f.formatted.net}.`,
      );
    }
    if (request.records.length) {
      parts.push(`Top related record: "${request.records[0]!.title}".`);
    }
    return {
      ...degradedMeta(),
      answer: parts.join(" ") || "AI is offline; connect OPENAI_API_KEY for synthesized answers.",
      confidence: request.records.length || request.finance ? 0.5 : 0.2,
      caveats: "Generated without AI synthesis.",
      suggestedNextAction: null,
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAI implementation
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function buildSystemPrompt(
  context?: AiContext,
  totals?: { totalNotes: number; totalTasks: number },
): string {
  const name = context?.userName ?? "Ernesto";
  const parts = [
    `You are Recall, a concise and helpful AI personal assistant for ${name}.`,
    "You help with notes, tasks, and planning. Be warm, direct, and actionable.",
    "When listing tasks, use bullet points with priority cues when known.",
    "If you lack information, say so briefly instead of inventing facts.",
    "Use the search_notes tool to search the user's entire note library by keyword.",
    "When the user asks to find or show a note, keep your reply to one short sentence — the app will open the note for them.",
  ];

  if (context?.tasks?.length) {
    const taskLines = context.tasks.map((t) => {
      const status = t.completed ? "done" : "open";
      const pri = t.priority ? ` [${t.priority}]` : "";
      const time = t.time ? ` @ ${t.time}` : "";
      return `- (${status}) ${t.title}${pri}${time} (id: ${t.id})`;
    });
    const taskHeader =
      totals && totals.totalTasks > context.tasks.length
        ? `Current tasks (showing ${context.tasks.length} of ${totals.totalTasks}):`
        : "Current tasks:";
    parts.push(`${taskHeader}\n${taskLines.join("\n")}`);
  }

  if (context?.notes?.length) {
    const noteLines = context.notes.map((n) => {
      const body = (n.preview ?? n.content ?? "").slice(0, MAX_NOTE_BODY_IN_PROMPT);
      return `- ${n.title} (id: ${n.id})${body ? `: ${body}` : ""}`;
    });
    const noteHeader =
      totals && totals.totalNotes > context.notes.length
        ? `Recent notes (showing ${context.notes.length} of ${totals.totalNotes} — use search_notes for others):`
        : "Available notes:";
    parts.push(`${noteHeader}\n${noteLines.join("\n")}`);
  }

  return parts.join("\n\n");
}

const CHAT_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_open_tasks",
      description: "List incomplete tasks from the user's current task context",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "search_notes",
      description:
        "Keyword search across the user's full note library (titles, previews, tags). Use when the user asks to find or open a note.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

class OpenAiService implements AiService {
  private client: OpenAI;
  private model: string;
  private embeddingModel: string;

  constructor(apiKey: string, model: string, embeddingModel: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.embeddingModel = embeddingModel;
  }

  getStatus(): AiStatus {
    return {
      enabled: true,
      model: this.model,
      embeddingModel: this.embeddingModel,
      degraded: false,
      degradedReason: null,
    };
  }

  private async runTool(
    name: string,
    args: Record<string, unknown>,
    context?: AiContext,
    userId?: string,
  ): Promise<string> {
    if (name === "list_open_tasks") {
      const open =
        context?.tasks?.filter((t) => !t.completed) ?? [];
      if (!open.length) return JSON.stringify({ tasks: [], message: "No open tasks" });
      return JSON.stringify({
        tasks: open.map((t) => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          time: t.time,
          tags: t.tags,
        })),
      });
    }

    if (name === "search_notes") {
      const query = String(args.query ?? "").trim();
      if (!query) {
        return JSON.stringify({ results: [], message: "Empty search query" });
      }

      if (userId) {
        const dbMatches = await searchNotesForUser(userId, query, 25);
        return JSON.stringify({
          results: dbMatches.map((n) => ({
            id: n.id,
            title: n.title,
            preview: n.preview.slice(0, 200),
            tags: n.tags,
          })),
          source: "full_library",
        });
      }

      const notes = context?.notes ?? [];
      const q = query.toLowerCase();
      const matches = notes.filter((n) => {
        const hay = `${n.title} ${n.content ?? ""} ${n.preview ?? ""}`.toLowerCase();
        return q.split(/\s+/).some((term) => term && hay.includes(term));
      });
      return JSON.stringify({
        results: matches.map((n) => ({
          id: n.id,
          title: n.title,
          preview: (n.preview ?? n.content ?? "").slice(0, 200),
        })),
        source: "context_only",
      });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { context, totalNotes, totalTasks } = trimAiContext(request.context);
    const userId = request.userId;
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: buildSystemPrompt(context, { totalNotes, totalTasks }),
      },
      ...request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
    ];

    try {
      let response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: CHAT_TOOLS,
        tool_choice: "auto",
      });

      for (let round = 0; round < 3; round++) {
        const choice = response.choices[0];
        if (!choice) break;

        const toolCalls = choice.message.tool_calls;
        if (!toolCalls?.length) {
          const content = choice.message.content?.trim();
          return {
            degraded: false,
            degradedReason: null,
            message: {
              role: "assistant",
              content: content || "I couldn't generate a response. Please try again.",
            },
            model: this.model,
          };
        }

        messages.push(choice.message);
        for (const call of toolCalls) {
          if (call.type !== "function") continue;
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(call.function.arguments || "{}") as Record<
              string,
              unknown
            >;
          } catch {
            parsedArgs = {};
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: await this.runTool(call.function.name, parsedArgs, context, userId),
          });
        }

        response = await this.client.chat.completions.create({
          model: this.model,
          messages,
          tools: CHAT_TOOLS,
          tool_choice: "auto",
        });
      }

      const fallback = response.choices[0]?.message.content?.trim();
      return {
        degraded: false,
        degradedReason: null,
        message: {
          role: "assistant",
          content: fallback || "I couldn't complete that request. Please try again.",
        },
        model: this.model,
      };
    } catch (err) {
      if (isOpenAiContextError(err)) {
        return {
          degraded: true,
          degradedReason: "context_length_exceeded",
          message: {
            role: "assistant",
            content:
              "Your note library is very large, so I couldn't load everything at once. Ask about a specific topic, notebook, or note title and I'll search from there.",
          },
          model: this.model,
        };
      }
      throw err;
    }
  }

  async summarizeNote(
    request: SummarizeNoteRequest,
  ): Promise<SummarizeNoteResponse> {
    const maxLength = request.maxLength ?? 400;
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `Summarize the user's note in clear prose. Max ${maxLength} characters. No markdown headings.`,
        },
        { role: "user", content: request.content },
      ],
      max_tokens: 300,
    });
    const summary =
      completion.choices[0]?.message.content?.trim() ||
      request.content.slice(0, maxLength);
    return { degraded: false, degradedReason: null, summary };
  }

  async generateNoteTitle(
    request: GenerateNoteTitleRequest,
  ): Promise<GenerateNoteTitleResponse> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "Generate a short, specific note title (max 8 words). Return only the title, no quotes.",
        },
        { role: "user", content: request.content },
      ],
      max_tokens: 40,
    });
    const title =
      completion.choices[0]?.message.content?.trim().replace(/^["']|["']$/g, "") ||
      "Untitled";
    return { degraded: false, degradedReason: null, title };
  }

  async extractTasks(request: ExtractTasksRequest): Promise<ExtractTasksResponse> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `Extract actionable tasks from the text. Return JSON: {"tasks":[{"title":"...","priority":"high|med|low|none","time":null,"tags":[]}]}. Priority is optional. time is optional string like "2:00 PM".`,
        },
        { role: "user", content: request.text },
      ],
      response_format: { type: "json_object" },
      max_tokens: 500,
    });
    const raw = completion.choices[0]?.message.content ?? '{"tasks":[]}';
    try {
      const parsed = JSON.parse(raw) as { tasks?: ExtractedTask[] };
      return {
        degraded: false,
        degradedReason: null,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      };
    } catch {
      return { degraded: false, degradedReason: null, tasks: [] };
    }
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    const res = await this.client.embeddings.create({
      model: this.embeddingModel,
      input: texts,
    });
    return res.data.map((row) => row.embedding);
  }

  async semanticSearch(
    request: SemanticSearchRequest,
  ): Promise<SemanticSearchResponse> {
    const limit = request.limit ?? 5;
    const inputs = request.items.map(
      (item) => `${item.title ? `${item.title}\n` : ""}${item.text}`,
    );
    const [queryVec, ...itemVecs] = await this.embedTexts([
      request.query,
      ...inputs,
    ]);
    if (!queryVec) return { degraded: false, degradedReason: null, results: [] };

    const results = request.items
      .map((item, i) => ({
        id: item.id,
        text: item.text,
        title: item.title ?? null,
        score: cosineSimilarity(queryVec, itemVecs[i] ?? []),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return { degraded: false, degradedReason: null, results };
  }

  async dashboardDigest(
    request: DashboardDigestRequest,
  ): Promise<DashboardDigestResponse> {
    const name = request.userName ?? "Ernesto";
    const { context } = trimAiContext({
      userName: name,
      tasks: request.tasks,
      notes: request.notes,
    });
    const payload = {
      userName: name,
      tasks: context?.tasks ?? [],
      notes: (context?.notes ?? []).map((n) => ({
        title: n.title,
        preview: (n.preview ?? n.content ?? "").slice(0, 300),
      })),
      totalNotes: request.notes?.length ?? 0,
    };

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `You are Recall. Write a brief morning digest for ${name}. Return JSON: {"digest":"2-4 sentences","highlights":["bullet 1","bullet 2","bullet 3"]}. Be specific using the data provided.`,
        },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_object" },
      max_tokens: 400,
    });

    const raw =
      completion.choices[0]?.message.content ??
      '{"digest":"Have a productive day.","highlights":[]}';
    try {
      const parsed = JSON.parse(raw) as {
        digest?: string;
        highlights?: string[];
      };
      return {
        degraded: false,
        degradedReason: null,
        digest: parsed.digest ?? "Have a productive day.",
        highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
      };
    } catch {
      return {
        degraded: false,
        degradedReason: null,
        digest: raw,
        highlights: [],
      };
    }
  }

  async classifyCapture(request: ClassifyCaptureRequest): Promise<ClassifyCaptureResponse> {
    const today = currentDateContext();
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            `Classify a short personal capture for Recall. Today is ${today.weekday}, ${today.iso}. ` +
            "Resolve any relative dates (today, tomorrow, tonight, this/next weekday, in N days, next week) to an absolute calendar date in strict YYYY-MM-DD format for suggestedDueDate, computed relative to today. " +
            "Never guess or carry over a year from prior knowledge — always compute from today's date. If no due date is implied, set suggestedDueDate to null. " +
            "Return JSON only: {\"cleanedTitle\":\"...\",\"suggestedType\":\"note|task|reminder|work_note|project_item|reference\",\"suggestedPriority\":\"low|medium|high|urgent\",\"suggestedDueDate\":null,\"suggestedProject\":null,\"suggestedTags\":[],\"suggestedActions\":[]}. Do not infer from any wider note library.",
        },
        {
          role: "user",
          content: JSON.stringify({
            today: today.iso,
            rawText: request.rawText.slice(0, 4000),
            dueDate: request.dueDate ?? null,
            tags: request.tags ?? [],
          }),
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 350,
    });

    const fallback = fallbackCaptureClassification(request);
    const raw = completion.choices[0]?.message.content ?? "{}";
    try {
      const parsed = JSON.parse(raw) as Partial<CaptureClassificationItem>;
      return {
        degraded: false,
        degradedReason: null,
        item: {
          cleanedTitle: parsed.cleanedTitle || fallback.cleanedTitle,
          suggestedType:
            parsed.suggestedType === "task" ||
            parsed.suggestedType === "reminder" ||
            parsed.suggestedType === "work_note" ||
            parsed.suggestedType === "project_item" ||
            parsed.suggestedType === "reference"
              ? parsed.suggestedType
              : fallback.suggestedType,
          suggestedPriority:
            parsed.suggestedPriority === "low" ||
            parsed.suggestedPriority === "high" ||
            parsed.suggestedPriority === "urgent"
              ? parsed.suggestedPriority
              : "medium",
          // An explicitly picked date always wins; otherwise use the model's
          // computed absolute date (validated), else nothing.
          suggestedDueDate:
            request.dueDate ?? normalizeDueDate(parsed.suggestedDueDate, today.iso),
          suggestedProject: parsed.suggestedProject ?? null,
          suggestedTags: Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags : fallback.suggestedTags,
          suggestedActions: Array.isArray(parsed.suggestedActions)
            ? parsed.suggestedActions
            : fallback.suggestedActions,
        },
      };
    } catch {
      return { degraded: true, degradedReason: "classification_parse_failed", item: fallback };
    }
  }

  async generateWorkNote(
    request: GenerateWorkNoteRequest,
  ): Promise<GenerateWorkNoteResponse> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "You create concise IT support work notes from rough troubleshooting dictation. Return JSON only with internalWorkNote, customerUpdate, transferReason, resolutionNote, emailReply. Use only the provided text. Do not invent facts.",
        },
        {
          role: "user",
          content: JSON.stringify({
            rawText: request.rawText.slice(0, 6000),
            tone: request.tone ?? "concise",
          }),
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 900,
    });

    const fallback = fallbackWorkNote(request.rawText);
    const raw = completion.choices[0]?.message.content ?? "{}";
    try {
      const parsed = JSON.parse(raw) as Partial<GenerateWorkNoteResponse>;
      return {
        degraded: false,
        degradedReason: null,
        internalWorkNote: parsed.internalWorkNote || fallback.internalWorkNote,
        customerUpdate: parsed.customerUpdate || fallback.customerUpdate,
        transferReason: parsed.transferReason || fallback.transferReason,
        resolutionNote: parsed.resolutionNote || fallback.resolutionNote,
        emailReply: parsed.emailReply || fallback.emailReply,
      };
    } catch {
      return { degraded: true, degradedReason: "work_note_parse_failed", ...fallback };
    }
  }

  async answerQuery(request: AnswerQueryRequest): Promise<AnswerQueryResponse> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: QUERY_ANSWER_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            today: request.today,
            now: request.now ?? null,
            question: request.question,
            conversation: (() => {
              const turns = (request.conversation ?? []).slice(-12);
              return turns.map((t, i) => truncateConversationTurn(t, i, turns.length));
            })(),
            finance: request.finance ?? null,
            records: request.records.map((r) => ({
              entityType: r.entityType,
              entityId: r.entityId,
              title: r.title,
              // Date is separate so truncation of body text cannot drop the sent time.
              date: r.date ?? null,
              // Keep person name fields intact; other records stay capped.
              text: r.text.slice(
                0,
                answerContextTextCap(r.entityType, { pinned: r.pinned }),
              ),
            })),
          }),
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 700,
    });

    const raw = completion.choices[0]?.message.content ?? "{}";
    try {
      const parsed = JSON.parse(raw) as {
        answer?: string;
        confidence?: number;
        caveats?: string | null;
        suggestedNextAction?: string | null;
      };
      const confidence =
        typeof parsed.confidence === "number"
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0.6;
      return {
        degraded: false,
        degradedReason: null,
        answer: parsed.answer?.trim() || "I couldn't find enough to answer that confidently.",
        confidence,
        caveats: parsed.caveats ?? null,
        suggestedNextAction: parsed.suggestedNextAction ?? null,
      };
    } catch {
      // Never surface raw/partial JSON to the user. If the JSON was truncated,
      // salvage just the "answer" string; otherwise return a clean message.
      const salvaged = salvageAnswerField(raw);
      return {
        degraded: !salvaged,
        degradedReason: salvaged ? null : "query_answer_parse_failed",
        answer:
          salvaged ||
          "I found the information but had trouble formatting the answer. Please ask again.",
        confidence: salvaged ? 0.5 : 0.3,
        caveats: null,
        suggestedNextAction: null,
      };
    }
  }

  async answerQueryStream(
    request: AnswerQueryRequest,
    onToken: (delta: string) => void,
  ): Promise<AnswerQueryStreamResult> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: QUERY_ANSWER_STREAM_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            today: request.today,
            now: request.now ?? null,
            question: request.question,
            conversation: (() => {
              const turns = (request.conversation ?? []).slice(-12);
              return turns.map((t, i) => truncateConversationTurn(t, i, turns.length));
            })(),
            finance: request.finance ?? null,
            records: request.records.map((r) => ({
              entityType: r.entityType,
              entityId: r.entityId,
              title: r.title,
              date: r.date ?? null,
              text: r.text.slice(
                0,
                answerContextTextCap(r.entityType, { pinned: r.pinned }),
              ),
            })),
          }),
        },
      ],
      max_tokens: 700,
      stream: true,
    });

    let answer = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        answer += delta;
        onToken(delta);
      }
    }

    return {
      answer: answer.trim() || "I couldn't find enough to answer that confidently.",
      degraded: false,
    };
  }
}

/**
 * Best-effort extraction of the "answer" string from a malformed/truncated
 * model JSON response, so users never see raw JSON. Returns null if not found.
 */
export function salvageAnswerField(raw: string): string | null {
  const m = raw.match(/"answer"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!m?.[1]) return null;
  let value: string;
  try {
    value = JSON.parse(`"${m[1]}"`);
  } catch {
    value = m[1].replace(/\\"/g, '"').replace(/\\n/g, " ");
  }
  const trimmed = value.trim();
  // Guard against the salvaged value itself being a JSON blob.
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) return null;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let _instance: AiService | null = null;

export function createAiService(): AiService {
  if (_instance) return _instance;

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const embeddingModel =
    process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

  _instance = apiKey
    ? new OpenAiService(apiKey, model, embeddingModel)
    : new DisabledAiService();

  return _instance;
}

/** @internal test helper */
export function resetAiServiceForTests(): void {
  _instance = null;
}

export const aiService = createAiService();
