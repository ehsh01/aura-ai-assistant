import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

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
}

export interface ChatResponse extends AiDegradedMeta {
  message: ChatMessage;
  model: string | null;
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
}

const DISABLED_REASON =
  "OPENAI_API_KEY is not configured. Add it to artifacts/api-server/.env to enable Recall AI.";

function degradedMeta(reason: string = DISABLED_REASON): AiDegradedMeta {
  return { degraded: true, degradedReason: reason };
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

function buildSystemPrompt(context?: AiContext): string {
  const name = context?.userName ?? "Ernesto";
  const parts = [
    `You are Recall, a concise and helpful AI personal assistant for ${name}.`,
    "You help with notes, tasks, and planning. Be warm, direct, and actionable.",
    "When listing tasks, use bullet points with priority cues when known.",
    "If you lack information, say so briefly instead of inventing facts.",
  ];

  if (context?.tasks?.length) {
    const taskLines = context.tasks.map((t) => {
      const status = t.completed ? "done" : "open";
      const pri = t.priority ? ` [${t.priority}]` : "";
      const time = t.time ? ` @ ${t.time}` : "";
      return `- (${status}) ${t.title}${pri}${time} (id: ${t.id})`;
    });
    parts.push(`Current tasks:\n${taskLines.join("\n")}`);
  }

  if (context?.notes?.length) {
    const noteLines = context.notes.map((n) => {
      const body = (n.content ?? n.preview ?? "").slice(0, 500);
      return `- ${n.title} (id: ${n.id})${body ? `: ${body}` : ""}`;
    });
    parts.push(`Available notes:\n${noteLines.join("\n")}`);
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
      description: "Keyword search across note titles and content in context",
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

  private runTool(
    name: string,
    args: Record<string, unknown>,
    context?: AiContext,
  ): string {
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
      const query = String(args.query ?? "").toLowerCase();
      const notes = context?.notes ?? [];
      const matches = notes.filter((n) => {
        const hay = `${n.title} ${n.content ?? ""} ${n.preview ?? ""}`.toLowerCase();
        return query.split(/\s+/).some((term) => term && hay.includes(term));
      });
      return JSON.stringify({
        results: matches.map((n) => ({
          id: n.id,
          title: n.title,
          preview: (n.preview ?? n.content ?? "").slice(0, 200),
        })),
      });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const context = request.context;
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: buildSystemPrompt(context) },
      ...request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
    ];

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
          content: this.runTool(call.function.name, parsedArgs, context),
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
    const payload = {
      userName: name,
      tasks: request.tasks ?? [],
      notes: (request.notes ?? []).map((n) => ({
        title: n.title,
        preview: (n.preview ?? n.content ?? "").slice(0, 300),
      })),
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
