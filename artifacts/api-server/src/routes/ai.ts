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
  GetAiStatusResponse,
  SemanticSearchBody,
  SemanticSearchResponse,
  SummarizeNoteBody,
  SummarizeNoteResponse,
} from "@workspace/api-zod";
import { aiService } from "../services/ai";

const router: IRouter = Router();

router.get("/ai/status", (_req, res) => {
  const data = GetAiStatusResponse.parse(aiService.getStatus());
  res.json(data);
});

router.post("/ai/chat", async (req, res, next) => {
  try {
    const body = AiChatBody.parse(req.body);
    const result = await aiService.chat(body);
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

export default router;
