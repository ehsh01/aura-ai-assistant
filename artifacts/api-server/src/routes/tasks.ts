import { Router, type IRouter } from "express";
import {
  BulkUpsertTasksBody,
  CreateTaskBody,
  ListTasksResponse,
  UpdateTaskBody,
  UpdateTaskResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middleware/auth";
import {
  bulkUpsertTasksForUser,
  createTaskForUser,
  deleteTaskForUser,
  listTasksForUser,
  updateTaskForUser,
} from "../services/tasks";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/tasks", async (req, res, next) => {
  try {
    const tasks = await listTasksForUser(req.user!.id);
    res.json(ListTasksResponse.parse({ tasks }));
  } catch (err) {
    next(err);
  }
});

router.post("/tasks", async (req, res, next) => {
  try {
    const body = CreateTaskBody.parse(req.body);
    const task = await createTaskForUser(req.user!.id, body);
    res.status(201).json(UpdateTaskResponse.parse(task));
  } catch (err) {
    next(err);
  }
});

router.post("/tasks/bulk", async (req, res, next) => {
  try {
    const body = BulkUpsertTasksBody.parse(req.body);
    const tasks = await bulkUpsertTasksForUser(req.user!.id, body.tasks);
    res.json(ListTasksResponse.parse({ tasks }));
  } catch (err) {
    next(err);
  }
});

router.patch("/tasks/:taskId", async (req, res, next) => {
  try {
    const body = UpdateTaskBody.parse(req.body);
    const task = await updateTaskForUser(
      req.user!.id,
      req.params.taskId,
      body,
    );
    if (!task) {
      res.status(404).json({ error: "NOT_FOUND", message: "Task not found" });
      return;
    }
    res.json(UpdateTaskResponse.parse(task));
  } catch (err) {
    next(err);
  }
});

router.delete("/tasks/:taskId", async (req, res, next) => {
  try {
    const ok = await deleteTaskForUser(req.user!.id, req.params.taskId);
    if (!ok) {
      res.status(404).json({ error: "NOT_FOUND", message: "Task not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
