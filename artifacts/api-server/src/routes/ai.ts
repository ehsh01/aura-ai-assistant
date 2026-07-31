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
import { getExtractionJobStatus, ingestCaptureForUser } from "../services/capture-pipeline";
import { routeIntentForText } from "../services/intent-router";
import { writeAuditLog } from "../services/audit";
import {
  confirmProposedAction,
  type ProposedActionType,
} from "../services/action-orchestrator";
import { OPENAI_TTS_VOICES, synthesizeSpeech } from "../services/tts";
import {
  createAskThreadForUser,
  getAskThreadForUser,
  listAskThreadsForUser,
} from "../services/ask-threads";
import { recordAskFeedbackForUser } from "../services/ask-feedback";
import multer from "multer";
import {
  getTranscriptionProvider,
  MAX_VOICE_AUDIO_BYTES,
  receiveVoiceCapture,
  TranscriptionUnavailableError,
  TranscriptionValidationError,
} from "../services/voice-first";

const voiceAudioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VOICE_AUDIO_BYTES, files: 1 },
});

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

// Server-Sent Events variant: streams `meta` (sources) first, then `token`
// deltas as the answer is generated, then a final `done` event. Falls back to
// POST /ai/query on the client when streaming is unavailable.
router.post("/ai/query/stream", async (req, res, next) => {
  let body: z.infer<typeof AiQueryBody>;
  try {
    body = AiQueryBody.parse(req.body);
  } catch (err) {
    next(err);
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Disable proxy buffering (nginx) so tokens flush immediately.
  res.setHeader("X-Accel-Buffering", "no");
  (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    (res as unknown as { flush?: () => void }).flush?.();
  };

  try {
    const result = await queryRecallForUser(req.user!.id, body.question, {
      threadId: body.threadId ?? null,
      stream: {
        onMeta: (meta) => send("meta", meta),
        onToken: (delta) => send("token", { delta }),
      },
    });
    send("done", {
      threadId: result.threadId,
      assistantMessageId: result.assistantMessageId ?? null,
      answer: result.answer,
      confidence: result.confidence,
      caveats: result.caveats,
      relatedRecords: result.relatedRecords,
      evidence: result.evidence,
      images: result.images,
      suggestedNextAction: result.suggestedNextAction,
      promptVersion: result.promptVersion,
      degraded: result.degraded,
      privacy: result.privacy,
    });
    res.end();
  } catch (err) {
    // Headers are already sent, so surface the failure as an SSE error event.
    send("error", {
      message: err instanceof Error ? err.message : "Ask failed",
    });
    res.end();
  }
});

const AiClassifyBody = z.object({
  text: z.string().min(1).max(8000),
});

const AiSubmitBody = z.object({
  text: z.string().min(1).max(8000),
  threadId: z.string().min(1).max(64).optional().nullable(),
});

// Classification only — never performs a side effect. Lets the client preview
// how an input would be routed (question vs. capture) before submitting.
router.post("/ai/intent/classify", async (req, res, next) => {
  try {
    const body = AiClassifyBody.parse(req.body);
    const decision = await routeIntentForText(body.text);
    await writeAuditLog({
      userId: req.user!.id,
      action: "ask_input_classified",
      metadata: {
        route: decision.route,
        primaryIntent: decision.result.primaryIntent,
        confidence: decision.result.confidence,
        source: decision.source,
        degraded: decision.degraded,
        requiresConfirmation: decision.result.requiresConfirmation,
      },
    });
    res.json({
      route: decision.route,
      source: decision.source,
      degraded: decision.degraded,
      result: decision.result,
    });
  } catch (err) {
    next(err);
  }
});

// Unified Ask/Capture bridge: classify, then route to the EXISTING Ask engine
// (questions) or the EXISTING capture pipeline / AI Inbox (everything else).
// Raw input is always preserved. This does not replace /ai/query or the inbox.
router.post("/ai/submit", async (req, res, next) => {
  try {
    const body = AiSubmitBody.parse(req.body);
    const userId = req.user!.id;
    const decision = await routeIntentForText(body.text);

    await writeAuditLog({
      userId,
      action: "ask_input_classified",
      metadata: {
        route: decision.route,
        primaryIntent: decision.result.primaryIntent,
        confidence: decision.result.confidence,
        source: decision.source,
        degraded: decision.degraded,
        requiresConfirmation: decision.result.requiresConfirmation,
        threadId: body.threadId ?? null,
      },
    });

    const routing = {
      route: decision.route,
      source: decision.source,
      degraded: decision.degraded,
      result: decision.result,
    };

    if (decision.route === "question") {
      const question = await queryRecallForUser(userId, body.text, {
        threadId: body.threadId ?? null,
      });
      res.json({ mode: "question" as const, routing, question });
      return;
    }

    // Capture path: canonical raw capture + async extraction, carrying an Ask
    // thread reference so the two surfaces stay linked. Lands in the AI Inbox.
    const { capture, jobId } = await ingestCaptureForUser(userId, {
      rawText: body.text,
      sourceType: "ask",
      sourceName: "Ask",
      rawMetadata: {
        askThreadId: body.threadId ?? null,
        intent: {
          primaryIntent: decision.result.primaryIntent,
          secondaryIntents: decision.result.secondaryIntents,
          confidence: decision.result.confidence,
          source: decision.source,
          requiresConfirmation: decision.result.requiresConfirmation,
        },
      },
    });
    res.status(202).json({ mode: "capture" as const, routing, capture, jobId });
  } catch (err) {
    next(err);
  }
});

// Unified plan endpoint: classify, then either answer (questions) or return
// draft review cards (captures). Nothing is written except the raw source.
router.post("/ai/plan", async (req, res, next) => {
  try {
    const body = AiSubmitBody.parse(req.body);
    const plan = await receiveVoiceCapture({
      userId: req.user!.id,
      text: body.text,
      source: "ask",
      sessionId: body.threadId ?? null,
    });
    // Clients expect the PlanResult shape; temporal extras are additive.
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

/** Server-side STT for PWA / browsers where Web Speech is unavailable. */
router.post("/ai/transcribe", (req, res, next) => {
  voiceAudioUpload.single("audio")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({
          error: "AUDIO_TOO_LARGE",
          message: `Recording exceeds the ${Math.round(MAX_VOICE_AUDIO_BYTES / (1024 * 1024))}MB limit`,
        });
        return;
      }
      next(err);
      return;
    }
    void (async () => {
      try {
        const file = req.file;
        if (!file?.buffer?.length) {
          res.status(400).json({ error: "MISSING_AUDIO", message: "Audio file is required" });
          return;
        }
        const locale =
          typeof req.body?.locale === "string" ? req.body.locale.slice(0, 16) : undefined;
        const result = await getTranscriptionProvider().transcribe({
          userId: req.user!.id,
          audio: file.buffer,
          mimeType: file.mimetype || "audio/webm",
          filename: file.originalname || "utterance.webm",
          locale,
        });
        await writeAuditLog({
          userId: req.user!.id,
          action: "voice_transcribed",
          entityType: "query",
          metadata: {
            provider: result.provider,
            model: result.model,
            durationMs: result.durationMs,
            byteLength: file.size,
            // Never log transcript text.
            textLength: result.text.length,
          },
        });
        res.json({
          text: result.text,
          provider: result.provider,
          model: result.model,
          durationMs: result.durationMs,
        });
      } catch (e) {
        if (e instanceof TranscriptionUnavailableError) {
          res.status(503).json({ error: "TRANSCRIBE_UNAVAILABLE", message: e.message });
          return;
        }
        if (e instanceof TranscriptionValidationError) {
          res.status(400).json({ error: "TRANSCRIBE_INVALID", message: e.message });
          return;
        }
        next(e);
      }
    })();
  });
});

const ACTION_TYPES = [
  "create_task",
  "create_reminder",
  "save_memory",
  "create_note",
  "send_to_inbox",
] as const satisfies readonly ProposedActionType[];

const AiConfirmActionBody = z.object({
  type: z.enum(ACTION_TYPES),
  draft: z.object({
    title: z.string().min(1).max(500),
    content: z.string().min(1).max(8000),
    dueAt: z.string().max(64).nullable().default(null),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    tags: z.array(z.string().max(64)).max(24).default([]),
    domain: z.string().max(64).nullable().default(null),
    kind: z.enum(["deadline", "appointment", "follow_up", "other"]).nullable().default(null),
    // Ownership is re-verified server-side; these are untrusted client input.
    personId: z.string().min(1).max(64).nullable().default(null),
    projectId: z.string().min(1).max(64).nullable().default(null),
  }),
  rawCaptureId: z.string().min(1).max(64).nullable().default(null),
  threadId: z.string().min(1).max(64).nullable().default(null),
  proposalId: z.string().min(1).max(64).nullable().default(null),
});

// Execute one user-confirmed proposed action via existing domain services.
router.post("/ai/actions/confirm", async (req, res, next) => {
  try {
    const body = AiConfirmActionBody.parse(req.body);
    const result = await confirmProposedAction(req.user!.id, {
      type: body.type,
      draft: body.draft,
      rawCaptureId: body.rawCaptureId,
      threadId: body.threadId,
      proposalId: body.proposalId,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

const AiCancelActionBody = z.object({
  proposalId: z.string().min(1).max(64),
});

router.post("/ai/actions/cancel", async (req, res, next) => {
  try {
    const body = AiCancelActionBody.parse(req.body);
    const { cancelProposalForUser } = await import("../services/action-proposals");
    const cancelled = await cancelProposalForUser(req.user!.id, body.proposalId);
    if (!cancelled) {
      res.status(404).json({ error: "NOT_FOUND", message: "Proposal not found or not cancellable" });
      return;
    }
    res.json({ ok: true, proposal: cancelled });
  } catch (err) {
    next(err);
  }
});

const AiCorrectActionBody = z.object({
  proposalId: z.string().min(1).max(64),
  correction: z.string().min(1).max(2000),
});

router.post("/ai/actions/correct", async (req, res, next) => {
  try {
    const body = AiCorrectActionBody.parse(req.body);
    const { correctProposalForUser } = await import("../services/action-proposals");
    const { getBriefingPrefsForUser } = await import("../services/notification-settings");
    const prefs = await getBriefingPrefsForUser(req.user!.id).catch(() => null);
    const timezone = prefs?.timezone ?? process.env.RECALL_TIMEZONE ?? "America/New_York";
    const result = await correctProposalForUser(
      req.user!.id,
      body.proposalId,
      body.correction,
      timezone,
    );
    if (!result.ok) {
      res.status(400).json({ error: "CORRECTION_FAILED", message: result.error });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/ai/messages/:messageId/feedback", async (req, res, next) => {
  try {
    const body = z
      .object({
        rating: z.enum(["up", "down"]),
        note: z.string().max(1000).nullish(),
      })
      .parse(req.body);
    const result = await recordAskFeedbackForUser(req.user!.id, {
      messageId: req.params.messageId,
      rating: body.rating,
      note: body.note,
    });
    if (!result.ok) {
      res.status(404).json({ error: "NOT_FOUND", message: result.error });
      return;
    }
    res.json({ ok: true });
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
