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
import { pickBestNoteToOpen, userWantsNoteOpened } from "../lib/note-open-intent";
import { z } from "zod";
import { queryRecallForUser } from "../services/query-engine";
import { getExtractionJobStatus } from "../services/capture-pipeline";
import { OPENAI_TTS_VOICES, synthesizeSpeech } from "../services/tts";
import {
  createAskThreadForUser,
  getAskThreadForUser,
  listAskThreadsForUser,
} from "../services/ask-threads";

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
    let searchHits: Awaited<ReturnType<typeof searchNotesForUser>> = [];

    if (lastUserMessage?.content.trim()) {
      searchHits = await searchNotesForUser(userId, lastUserMessage.content, 20);
      context = mergeSearchHitsIntoContext(context, searchHits);
    }

    const result = await aiService.chat({ ...body, context, userId });

    const openTarget =
      lastUserMessage && userWantsNoteOpened(lastUserMessage.content)
        ? pickBestNoteToOpen(searchHits)
        : null;

    res.json(
      AiChatResponse.parse({
        ...result,
        openNote: openTarget ? { id: openTarget.id, title: openTarget.title } : null,
      }),
    );
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

const AiQueryBody = z.object({
  question: z.string().min(1).max(4000),
  threadId: z.string().min(1).max(64).optional().nullable(),
});

const AiTtsBody = z.object({
  text: z.string().min(1).max(4096),
  voice: z.enum(OPENAI_TTS_VOICES).optional(),
});

router.post("/ai/tts", async (req, res, next) => {
  try {
    const body = AiTtsBody.parse(req.body);
    const { buffer, contentType } = await synthesizeSpeech(body.text, body.voice);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", String(buffer.length));
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.get("/ai/threads", async (req, res, next) => {
  try {
    const threads = await listAskThreadsForUser(req.user!.id);
    res.json({ threads });
  } catch (err) {
    next(err);
  }
});

router.post("/ai/threads", async (req, res, next) => {
  try {
    const thread = await createAskThreadForUser(req.user!.id);
    res.status(201).json({ thread, messages: [] });
  } catch (err) {
    next(err);
  }
});

router.get("/ai/threads/:threadId", async (req, res, next) => {
  try {
    const detail = await getAskThreadForUser(req.user!.id, req.params.threadId);
    if (!detail) {
      res.status(404).json({ error: "NOT_FOUND", message: "Thread not found" });
      return;
    }
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

router.post("/ai/query", async (req, res, next) => {
  try {
    const body = AiQueryBody.parse(req.body);
    const result = await queryRecallForUser(req.user!.id, body.question, {
      threadId: body.threadId ?? null,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/ai/runs/:jobId", async (req, res, next) => {
  try {
    const job = await getExtractionJobStatus(req.user!.id, req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "NOT_FOUND", message: "Extraction job not found" });
      return;
    }
    res.json(job);
  } catch (err) {
    next(err);
  }
});

export default router;
