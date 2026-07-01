import { Router, type IRouter } from "express";
import aiRouter from "./ai";
import healthRouter from "./health";
import { aiRateLimiter } from "../middleware/security";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiRateLimiter, aiRouter);

export default router;
