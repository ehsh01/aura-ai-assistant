import { eq } from "drizzle-orm";
import { users } from "@workspace/db/schema";
import { getDb } from "../lib/db";

export type WorkingContextDto = {
  personId: string | null;
  personName: string | null;
  projectId: string | null;
  projectName: string | null;
  updatedAt: string | null;
};

export async function getWorkingContextForUser(userId: string): Promise<WorkingContextDto> {
  const [row] = await getDb()
    .select({
      personId: users.workingPersonId,
      projectId: users.workingProjectId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const personId = row?.personId ?? null;
  const projectId = row?.projectId ?? null;
  let personName: string | null = null;
  let projectName: string | null = null;

  if (personId) {
    const { getPersonForUser } = await import("./people");
    const person = await getPersonForUser(userId, personId);
    if (!person) {
      return { personId: null, personName: null, projectId, projectName: null, updatedAt: null };
    }
    personName = person.displayName;
  }
  if (projectId) {
    const { listProjectsForUser } = await import("./projects");
    const project = (await listProjectsForUser(userId)).find((p) => p.id === projectId);
    if (!project) {
      return { personId, personName, projectId: null, projectName: null, updatedAt: null };
    }
    projectName = project.name;
  }

  return { personId, personName, projectId, projectName, updatedAt: null };
}

export async function setWorkingContextForUser(
  userId: string,
  input: { personId?: string | null; projectId?: string | null },
): Promise<WorkingContextDto> {
  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.personId !== undefined) {
    const personId = input.personId?.trim() || null;
    if (personId) {
      const { getPersonForUser } = await import("./people");
      const person = await getPersonForUser(userId, personId);
      if (!person) {
        const err = new Error("Person not found") as Error & { status?: number };
        err.status = 404;
        throw err;
      }
    }
    patch.workingPersonId = personId;
  }
  if (input.projectId !== undefined) {
    const projectId = input.projectId?.trim() || null;
    if (projectId) {
      const { listProjectsForUser } = await import("./projects");
      const project = (await listProjectsForUser(userId)).find((p) => p.id === projectId);
      if (!project) {
        const err = new Error("Project not found") as Error & { status?: number };
        err.status = 404;
        throw err;
      }
    }
    patch.workingProjectId = projectId;
  }

  if (Object.keys(patch).length > 0) {
    await getDb().update(users).set(patch).where(eq(users.id, userId));
  }
  return getWorkingContextForUser(userId);
}

export async function getSmsSessionForUser(userId: string): Promise<{
  proposalId: string | null;
  threadId: string | null;
}> {
  const [row] = await getDb()
    .select({
      proposalId: users.lastSmsProposalId,
      threadId: users.lastSmsThreadId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return { proposalId: row?.proposalId ?? null, threadId: row?.threadId ?? null };
}

export async function setSmsSessionForUser(
  userId: string,
  input: { proposalId?: string | null; threadId?: string | null },
): Promise<void> {
  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.proposalId !== undefined) patch.lastSmsProposalId = input.proposalId;
  if (input.threadId !== undefined) patch.lastSmsThreadId = input.threadId;
  if (Object.keys(patch).length === 0) return;
  await getDb().update(users).set(patch).where(eq(users.id, userId));
}

export async function getLastHomeSeenAt(userId: string): Promise<Date | null> {
  const [row] = await getDb()
    .select({ lastHomeSeenAt: users.lastHomeSeenAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.lastHomeSeenAt ?? null;
}

export async function markHomeSeen(userId: string, at: Date = new Date()): Promise<void> {
  await getDb().update(users).set({ lastHomeSeenAt: at }).where(eq(users.id, userId));
}
