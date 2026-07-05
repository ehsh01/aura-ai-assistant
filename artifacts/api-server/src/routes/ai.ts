import { Router, type IRouter } from "express";
import {
  AiChatBody,
  AiChatResponse,
  DashboardDigestBody,
  DashboardDigestResponse,
  ExtractTasksBody,
  ExtractTasksResponse,
  GenerateNoteTitleBody,
  GenerateNoteTitleResponse,
  GenerateWorkNoteBody,
  GenerateWorkNoteResponse,
  GetAiStatusResponse,
  SemanticSearchBody,
  SemanticSearchResponse,
  SummarizeNoteBody,
  SummarizeNoteResponse,
} from "@workspace/api-zod";
import { aiService, type AiContext, type NoteContextItem } from "../services/ai";
import { searchNotesForUser } from "../services/notes";

function mergeSearchHitsIntoContext(
  context: AiContext | undefined,
  hits: Awaited<ReturnType<typeof searchNotesForUser>>,
): AiContext | undefined {
  if (hits.length === 0) return context;

  const byId = new Map<string, NoteContextItem>();
  for (const note of context?.notes ?? []) {
    byId.set(note.id, note);
  }
  for (const hit of hits) {
    if (!byId.has(hit.id)) {
      byId.set(hit.id, {
        id: hit.id,
        title: hit.title,
        preview: hit.preview,
        tags: hit.tags,
      });
    }
  }

  return {
    ...context,
    notes: Array.from(byId.values()),
  };
}

const router: IRouter = Router();

// All routes here require authentication (enforced in routes/index.ts)

router.get("/ai/status", (_req, res) => {
  const data = GetAiStatusResponse.parse(aiService.getStatus());
  res.json(data);
});

router.post("/ai/chat", async (req, res, next) => {
  try {
    const body = AiChatBody.parse(req.body);
    const userId = req.user!.id;
    const lastUserMessage = [...body.messages].reverse().find((m) => m.role === "user");
    let context = body.context;

    if (lastUserMessage?.content.trim()) {
      const hits = await searchNotesForUser(userId, lastUserMessage.content, 20);
      context = mergeSearchHitsIntoContext(context, hits);
    }

    const result = await aiService.chat({ ...body, context, userId });
    res.json(AiChatResponse.parse(result));
  } catch (err) {
    next(err);
  }
});

router.post("/ai/notes/summarize", async (req, res, next) => {
  try {
    const body = SummarizeNoteBody.parse(req.body);
    const result = await aiService.summarizeNote(body);
    res.json(SummarizeNoteResponse.parse(result));
  } catch (err) {
    next(err);
  }
});

router.post("/ai/notes/title", async (req, res, next) => {
  try {
    const body = GenerateNoteTitleBody.parse(req.body);
    const result = await aiService.generateNoteTitle(body);
    res.json(GenerateNoteTitleResponse.parse(result));
  } catch (err) {
    next(err);
  }
});

router.post("/ai/tasks/extract", async (req, res, next) => {
  try {
    const body = ExtractTasksBody.parse(req.body);
    const result = await aiService.extractTasks(body);
    res.json(ExtractTasksResponse.parse(result));
  } catch (err) {
    next(err);
  }
});

router.post("/ai/search/semantic", async (req, res, next) => {
  try {
    const body = SemanticSearchBody.parse(req.body);
    const result = await aiService.semanticSearch(body);
    res.json(SemanticSearchResponse.parse(result));
  } catch (err) {
    next(err);
  }
});

router.post("/ai/dashboard/digest", async (req, res, next) => {
  try {
    const body = DashboardDigestBody.parse(req.body);
    const result = await aiService.dashboardDigest(body);
    res.json(DashboardDigestResponse.parse(result));
  } catch (err) {
    next(err);
  }
});

router.post("/ai/generate-work-note", async (req, res, next) => {
  try {
    const body = GenerateWorkNoteBody.parse(req.body);
    const result = await aiService.generateWorkNote(body);
    res.json(GenerateWorkNoteResponse.parse(result));
  } catch (err) {
    next(err);
  }
});

export default router;
