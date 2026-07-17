import { Router, type IRouter } from "express";
import { z } from "zod";
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
import {
  linkSourceToProject,
  listProjectSourcesForUser,
  searchSourcesForProjectLink,
  unlinkSourceFromProject,
} from "../services/project-sources";
import { getSubjectTimelineForUser } from "../services/subject-timeline";

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
    // Prefer unified subject timeline (mail/txns/docs + notes/tasks).
    const unified = await getSubjectTimelineForUser(
      req.user!.id,
      "project",
      req.params.projectId,
    );
    if (unified) {
      res.json(unified);
      return;
    }
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

router.get("/projects/:projectId/sources", async (req, res, next) => {
  try {
    const sources = await listProjectSourcesForUser(req.user!.id, req.params.projectId);
    if (!sources) {
      res.status(404).json({ error: "NOT_FOUND", message: "Project not found" });
      return;
    }
    res.json(sources);
  } catch (err) {
    next(err);
  }
});

router.get("/projects/:projectId/sources/search", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "");
    const type = String(req.query.type ?? "gmail_message");
    if (type !== "gmail_message" && type !== "finance_transaction") {
      res.status(400).json({ error: "BAD_REQUEST", message: "Invalid type" });
      return;
    }
    const results = await searchSourcesForProjectLink(req.user!.id, q, type);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

router.post("/projects/:projectId/sources/link", async (req, res, next) => {
  try {
    const body = z.object({ sourceRecordId: z.string().min(1).max(64) }).parse(req.body);
    const result = await linkSourceToProject(
      req.user!.id,
      req.params.projectId,
      body.sourceRecordId,
    );
    if (!result.ok) {
      res.status(404).json({ error: "NOT_FOUND", message: result.error });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/projects/:projectId/sources/unlink", async (req, res, next) => {
  try {
    const body = z.object({ sourceRecordId: z.string().min(1).max(64) }).parse(req.body);
    const ok = await unlinkSourceFromProject(
      req.user!.id,
      req.params.projectId,
      body.sourceRecordId,
    );
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Link not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
