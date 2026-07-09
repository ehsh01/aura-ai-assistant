import { z } from "zod";
import { CAPTURE_PROCESSED_STATUSES } from "../services/captures";

/**
 * Request validation for the Capture Layer.
 *
 * Defined locally (Zod) rather than in the generated `@workspace/api-zod`
 * contract because these endpoints are a backend foundation with no frontend
 * consumer yet. The global error handler in `app.ts` already maps thrown
 * ZodErrors to a 400 VALIDATION_ERROR, so this integrates with existing
 * error semantics. When the browser extension / UI consume these routes, the
 * contract should be promoted into `openapi.yaml` (the codegen source of truth).
 */

const captureProcessedStatus = z.enum(CAPTURE_PROCESSED_STATUSES);

export const CreateCaptureBody = z.object({
  rawText: z.string().min(1, "rawText is required").max(1_000_000),
  sourceType: z.string().trim().min(1).max(32).optional(),
  sourceName: z.string().max(255).nullish(),
  sourceUrl: z.string().max(2048).nullish(),
  title: z.string().max(500).nullish(),
  rawHtml: z.string().max(5_000_000).nullish(),
  rawMetadata: z.record(z.unknown()).optional(),
  capturedAt: z.string().datetime().optional(),
});
export type CreateCaptureBody = z.infer<typeof CreateCaptureBody>;

export const UpdateCaptureStatusBody = z
  .object({
    processedStatus: captureProcessedStatus.optional(),
    processingError: z.string().max(4000).nullish(),
    title: z.string().max(500).nullish(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be provided",
  );
export type UpdateCaptureStatusBody = z.infer<typeof UpdateCaptureStatusBody>;

export const ListCapturesQuery = z.object({
  status: captureProcessedStatus.optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});
export type ListCapturesQuery = z.infer<typeof ListCapturesQuery>;
