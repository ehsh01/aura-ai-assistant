import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  bulkUpsertNotes,
  bulkUpsertTasks,
  createNote as apiCreateNote,
  createTask as apiCreateTask,
  deleteNote as apiDeleteNote,
  deleteTask as apiDeleteTask,
  getNote as apiGetNote,
  listNotebooks,
  listNotes,
  listTasks,
  updateNote as apiUpdateNote,
  updateTask as apiUpdateTask,
} from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import type { RecallNote, RecallNotebook, RecallTask } from "@/lib/recall-context";
import {
  clearUserData,
  loadUserData,
  noteDateLabel,
  previewFromContent,
} from "@/lib/recall-storage";
import { uploadEnexFile } from "@/lib/enex-upload";

interface RecallDataContextValue {
  notes: RecallNote[];
  notebooks: RecallNotebook[];
  tasks: RecallTask[];
  isReady: boolean;
  addNote: (partial?: Partial<RecallNote>) => RecallNote;
  updateNote: (id: string, patch: Partial<RecallNote>) => void;
  deleteNote: (id: string) => void;
  addTask: (title: string) => void;
  updateTask: (id: string, patch: Partial<RecallTask>) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  importNotes: (incoming: Partial<RecallNote>[]) => Promise<{ imported: number; skipped: number }>;
  importEnexUpload: (
    file: File,
    onProgress?: (percent: number) => void,
  ) => Promise<{
    parsed: number;
    imported: number;
    updated: number;
    skipped: number;
    errors: string[];
    firstNoteId: string | null;
    notebookId: string | null;
  }>;
  reloadNotes: () => Promise<void>;
  reloadNotebooks: () => Promise<void>;
  reloadTasks: () => Promise<void>;
  loadNote: (id: string) => Promise<RecallNote | null>;
  resetAll: () => void;
}

const RecallDataContext = createContext<RecallDataContextValue | null>(null);

const NOTE_SAVE_DELAY_MS = 600;

export function RecallDataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notes, setNotes] = useState<RecallNote[]>([]);
  const [notebooks, setNotebooks] = useState<RecallNotebook[]>([]);
  const [tasks, setTasks] = useState<RecallTask[]>([]);
  const [isReady, setIsReady] = useState(false);
  const notePatchTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingNotePatches = useRef<Map<string, Partial<RecallNote>>>(new Map());

  useEffect(() => {
    if (!user) {
      setNotes([]);
      setNotebooks([]);
      setTasks([]);
      setIsReady(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setIsReady(false);
      try {
        const [notesRes, tasksRes, notebooksRes] = await Promise.all([
          listNotes(),
          listTasks(),
          listNotebooks(),
        ]);
        let serverNotes = (notesRes.notes as RecallNote[]).map((n) => ({
          ...n,
          content: n.content ?? "",
        }));
        let serverTasks = tasksRes.tasks as RecallTask[];
        let serverNotebooks = notebooksRes.notebooks as RecallNotebook[];

        const local = loadUserData(user.id);
        const hasLocal = local.notes.length > 0 || local.tasks.length > 0;
        const hasServer = serverNotes.length > 0 || serverTasks.length > 0;

        if (hasLocal && !hasServer) {
          const [migratedNotes, migratedTasks] = await Promise.all([
            local.notes.length
              ? bulkUpsertNotes({
                  notes: local.notes.map((n) => ({
                    id: n.id,
                    title: n.title,
                    content: n.content,
                    tags: n.tags,
                    pinned: n.pinned,
                  })),
                })
              : Promise.resolve({ notes: [] }),
            local.tasks.length
              ? bulkUpsertTasks({
                  tasks: local.tasks.map((t) => ({
                    id: t.id,
                    title: t.title,
                    time: t.time ?? null,
                    priority: t.priority,
                    tags: t.tags,
                    completed: t.completed,
                  })),
                })
              : Promise.resolve({ tasks: [] }),
          ]);
          serverNotes = migratedNotes.notes as RecallNote[];
          serverTasks = migratedTasks.tasks as RecallTask[];
          clearUserData(user.id);
        }

        if (!cancelled) {
          setNotes(serverNotes);
          setNotebooks(serverNotebooks);
          setTasks(serverTasks);
          setIsReady(true);
        }
      } catch {
        const local = loadUserData(user.id);
        if (!cancelled) {
          setNotes(local.notes);
          setNotebooks([]);
          setTasks(local.tasks);
          setIsReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const flushNotePatch = useCallback(async (id: string) => {
    const patch = pendingNotePatches.current.get(id);
    pendingNotePatches.current.delete(id);
    notePatchTimers.current.delete(id);
    if (!patch) return;

    try {
      const updated = await apiUpdateNote(id, {
        title: patch.title,
        content: patch.content,
        tags: patch.tags,
        pinned: patch.pinned,
        notebookId: patch.notebookId,
        projectId: patch.projectId,
        contentFormat: patch.contentFormat,
        primaryPersonId: patch.primaryPersonId,
      });
      setNotes((prev) => prev.map((n) => (n.id === id ? (updated as RecallNote) : n)));
      if (patch.notebookId !== undefined) {
        void listNotebooks().then((res) => setNotebooks(res.notebooks as RecallNotebook[]));
      }
    } catch {
      // Keep optimistic local state if save fails
    }
  }, []);

  const addNote = useCallback((partial?: Partial<RecallNote>) => {
    const optimistic: RecallNote = {
      id: partial?.id ?? `note-${Date.now()}`,
      title: partial?.title ?? "Untitled",
      content: partial?.content ?? "",
      preview: partial?.preview ?? previewFromContent(partial?.content ?? ""),
      tags: partial?.tags ?? [],
      date: partial?.date ?? noteDateLabel(),
      pinned: partial?.pinned ?? false,
      notebookId: partial?.notebookId ?? null,
      projectId: partial?.projectId ?? null,
      contentFormat: partial?.contentFormat ?? "plain",
      attachmentCount: partial?.attachmentCount ?? 0,
      createdAt: partial?.createdAt ?? new Date().toISOString(),
      updatedAt: partial?.updatedAt ?? new Date().toISOString(),
    };
    setNotes((prev) => [optimistic, ...prev]);

    void (async () => {
      try {
        const saved = await apiCreateNote({
          id: partial?.id,
          title: optimistic.title,
          content: optimistic.content,
          tags: optimistic.tags,
          pinned: optimistic.pinned,
          notebookId: optimistic.notebookId,
          projectId: optimistic.projectId,
          contentFormat: optimistic.contentFormat,
        });
        setNotes((prev) =>
          prev.map((n) => (n.id === optimistic.id ? (saved as RecallNote) : n)),
        );
        if (optimistic.notebookId) {
          void listNotebooks().then((res) => setNotebooks(res.notebooks as RecallNotebook[]));
        }
      } catch {
        // Note remains in local state until next reload
      }
    })();

    return optimistic;
  }, []);

  const updateNote = useCallback(
    (id: string, patch: Partial<RecallNote>) => {
      pendingNotePatches.current.set(id, {
        ...pendingNotePatches.current.get(id),
        ...patch,
      });

      setNotes((prev) =>
        prev.map((n) => {
          if (n.id !== id) return n;
          const next = { ...n, ...patch, date: noteDateLabel() };
          if (patch.content !== undefined) {
            next.preview = previewFromContent(patch.content);
          }
          return next;
        }),
      );

      const existing = notePatchTimers.current.get(id);
      if (existing) clearTimeout(existing);
      notePatchTimers.current.set(
        id,
        setTimeout(() => {
          void flushNotePatch(id);
        }, NOTE_SAVE_DELAY_MS),
      );
    },
    [flushNotePatch],
  );

  const deleteNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    pendingNotePatches.current.delete(id);
    const timer = notePatchTimers.current.get(id);
    if (timer) clearTimeout(timer);
    notePatchTimers.current.delete(id);
    void apiDeleteNote(id).catch(() => {});
  }, []);

  const addTask = useCallback((title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;

    const optimistic: RecallTask = {
      id: `task-${Date.now()}`,
      title: trimmed,
      priority: "none",
      completed: false,
      projectId: null,
    };
    setTasks((prev) => [...prev, optimistic]);

    void (async () => {
      try {
        const saved = await apiCreateTask({ title: trimmed });
        setTasks((prev) =>
          prev.map((t) => (t.id === optimistic.id ? (saved as RecallTask) : t)),
        );
      } catch {
        // keep optimistic
      }
    })();
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<RecallTask>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
    void apiUpdateTask(id, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.time !== undefined ? { time: patch.time } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.completed !== undefined ? { completed: patch.completed } : {}),
      ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
      ...(patch.requesterPersonId !== undefined
        ? { requesterPersonId: patch.requesterPersonId }
        : {}),
    })
      .then((saved) => {
        setTasks((prev) =>
          prev.map((t) => (t.id === id ? (saved as RecallTask) : t)),
        );
      })
      .catch(() => {});
  }, []);

  const toggleTask = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, completed: !t.completed };
        void apiUpdateTask(id, { completed: next.completed }).catch(() => {});
        return next;
      }),
    );
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    void apiDeleteTask(id).catch(() => {});
  }, []);

  const reloadNotes = useCallback(async () => {
    const res = await listNotes();
    setNotes((prev) => {
      const contentById = new Map(prev.map((n) => [n.id, n.content]));
      return (res.notes as RecallNote[]).map((n) => ({
        ...n,
        content: contentById.get(n.id) ?? n.content ?? "",
      }));
    });
  }, []);

  const loadNote = useCallback(async (id: string): Promise<RecallNote | null> => {
    try {
      const note = (await apiGetNote(id)) as RecallNote;
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...note } : n)));
      return note;
    } catch {
      return null;
    }
  }, []);

  const reloadNotebooks = useCallback(async () => {
    const res = await listNotebooks();
    setNotebooks(res.notebooks as RecallNotebook[]);
  }, []);

  const reloadTasks = useCallback(async () => {
    const res = await listTasks();
    setTasks(res.tasks as RecallTask[]);
  }, []);

  const importEnexUpload = useCallback(
    async (file: File, onProgress?: (percent: number) => void) => {
      const result = await uploadEnexFile(file, onProgress);
      await Promise.all([reloadNotes(), reloadNotebooks()]);
      return {
        parsed: result.parsed,
        imported: result.imported,
        updated: result.updated ?? 0,
        skipped: result.skipped,
        errors: result.errors,
        firstNoteId: result.notes[0]?.id ?? null,
        notebookId: result.notebook?.id ?? null,
      };
    },
    [reloadNotes, reloadNotebooks],
  );

  const importNotes = useCallback(async (incoming: Partial<RecallNote>[]) => {
    const existingIds = new Set(notes.map((n) => n.id));
    const toSend = incoming
      .map((n, index) => ({
        id: n.id ?? `note-import-${Date.now()}-${index}`,
        title: n.title ?? "Untitled",
        content: n.content ?? "",
        tags: n.tags ?? [],
        pinned: n.pinned ?? false,
      }))
      .filter((n) => !existingIds.has(n.id));

    const skipped = incoming.length - toSend.length;

    if (toSend.length === 0) {
      return { imported: 0, skipped };
    }

    const CHUNK = 40;
    const importedNotes: RecallNote[] = [];

    for (let i = 0; i < toSend.length; i += CHUNK) {
      const chunk = toSend.slice(i, i + CHUNK);
      const result = await bulkUpsertNotes({ notes: chunk });
      importedNotes.push(...(result.notes as RecallNote[]));
    }

    setNotes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      for (const n of importedNotes) {
        byId.set(n.id, n);
      }
      return Array.from(byId.values()).sort(
        (a, b) => (b.date > a.date ? 1 : -1),
      );
    });

    return { imported: importedNotes.length, skipped };
  }, [notes]);

  const resetAll = useCallback(() => {
    if (!user) return;
    clearUserData(user.id);
    setNotes([]);
    setNotebooks([]);
    setTasks([]);
  }, [user]);

  const value = useMemo(
    () => ({
      notes,
      notebooks,
      tasks,
      isReady,
      addNote,
      updateNote,
      deleteNote,
      addTask,
      updateTask,
      toggleTask,
      deleteTask,
      importNotes,
      importEnexUpload,
      reloadNotes,
      reloadNotebooks,
      reloadTasks,
      loadNote,
      resetAll,
    }),
    [
      notes,
      notebooks,
      tasks,
      isReady,
      addNote,
      updateNote,
      deleteNote,
      addTask,
      updateTask,
      toggleTask,
      deleteTask,
      importNotes,
      importEnexUpload,
      reloadNotes,
      reloadNotebooks,
      reloadTasks,
      loadNote,
      resetAll,
    ],
  );

  return (
    <RecallDataContext.Provider value={value}>{children}</RecallDataContext.Provider>
  );
}

export function useRecallData(): RecallDataContextValue {
  const ctx = useContext(RecallDataContext);
  if (!ctx) {
    throw new Error("useRecallData must be used within RecallDataProvider");
  }
  return ctx;
}
