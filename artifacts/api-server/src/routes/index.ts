import { Router, type IRouter } from "express";
import aiRouter from "./ai";
import authRouter from "./auth";
import captureRouter from "./capture";
import healthRouter from "./health";
import notesRouter from "./notes";
import attachmentsRouter from "./attachments";
import notebooksRouter from "./notebooks";
import projectsRouter from "./projects";
import tasksRouter from "./tasks";
import { requireAuth } from "../middleware/auth";
import { aiRateLimiter } from "../middleware/security";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(notebooksRouter);
router.use(notesRouter);
router.use(attachmentsRouter);
router.use(projectsRouter);
router.use(captureRouter);
router.use(tasksRouter);
router.use(aiRateLimiter, requireAuth, aiRouter);

export default router;
