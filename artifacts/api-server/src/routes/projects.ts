import { Router, type IRouter } from "express";
import {
  CreateProjectBody,
  GetProjectResponse,
  ListProjectsResponse,
  UpdateProjectBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middleware/auth";
import {
  createProjectForUser,
  getProjectDetailForUser,
  getProjectTimelineForUser,
  listProjectsForUser,
  updateProjectForUser,
} from "../services/projects";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/projects", async (req, res, next) => {
  try {
    const projects = await listProjectsForUser(req.user!.id);
    res.json(ListProjectsResponse.parse({ projects }));
  } catch (err) {
    next(err);
  }
});

router.post("/projects", async (req, res, next) => {
  try {
    const body = CreateProjectBody.parse(req.body);
    const project = await createProjectForUser(req.user!.id, body);
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

router.get("/projects/:projectId", async (req, res, next) => {
  try {
    const detail = await getProjectDetailForUser(req.user!.id, req.params.projectId);
    if (!detail) {
      res.status(404).json({ error: "NOT_FOUND", message: "Project not found" });
      return;
    }
    res.json(GetProjectResponse.parse(detail));
  } catch (err) {
    next(err);
  }
});

router.get("/projects/:projectId/timeline", async (req, res, next) => {
  try {
    const timeline = await getProjectTimelineForUser(req.user!.id, req.params.projectId);
    if (!timeline) {
      res.status(404).json({ error: "NOT_FOUND", message: "Project not found" });
      return;
    }
    res.json(timeline);
  } catch (err) {
    next(err);
  }
});

router.patch("/projects/:projectId", async (req, res, next) => {
  try {
    const body = UpdateProjectBody.parse(req.body);
    const project = await updateProjectForUser(req.user!.id, req.params.projectId, body);
    if (!project) {
      res.status(404).json({ error: "NOT_FOUND", message: "Project not found" });
      return;
    }
    res.json(project);
  } catch (err) {
    next(err);
  }
});

export default router;
