/** Shared mock data passed to Recall AI as request context until DB persistence ships. */

export interface RecallTask {
  id: string;
  title: string;
  time?: string;
  priority: "high" | "med" | "low" | "none";
  tags?: string[];
  completed: boolean;
}

export interface RecallNote {
  id: string;
  title: string;
  preview: string;
  content: string;
  tags: string[];
  date: string;
  pinned: boolean;
}

export const RECALL_USER_NAME = "Ernesto";

export const MOCK_TASKS: RecallTask[] = [
  { id: "1", title: "Review Q3 metrics", time: "9:00 AM", priority: "high", tags: ["Work"], completed: false },
  { id: "2", title: "Finish project proposal", time: "10:30 AM", priority: "high", tags: ["Deep Work"], completed: false },
  { id: "3", title: "Sync with design team", time: "11:30 AM", priority: "med", completed: false },
  { id: "4", title: "Call Dr. Martinez", time: "2:00 PM", priority: "high", tags: ["Personal"], completed: false },
  { id: "5", title: "Review pull request #442", priority: "med", tags: ["Dev"], completed: false },
  { id: "6", title: "Grocery run", time: "5:00 PM", priority: "low", completed: false },
  { id: "7", title: "Morning workout", time: "7:00 AM", priority: "low", completed: true },
  { id: "8", title: "Inbox zero", time: "8:30 AM", priority: "med", completed: true },
];

export const MOCK_NOTES: RecallNote[] = [
  {
    id: "1",
    title: "Project Recall Q3 Strategy",
    preview: "Focusing on context-aware responses and faster local generation.",
    tags: ["Work", "Meeting"],
    date: "10m ago",
    pinned: true,
    content:
      "We need to align on the upcoming Q3 deliverables for the Recall assistant. The core focus will be on improving context-aware processing by integrating better local caching mechanisms. Key objectives: implement local vector storage, refine glassmorphic UI, draft privacy policy.",
  },
  {
    id: "2",
    title: "System Architecture V2",
    preview: "Drafting the new microservices layout for the data ingestion pipeline.",
    tags: ["Code", "Work"],
    date: "2h ago",
    pinned: true,
    content: "Microservices layout for ingestion pipeline with event bus and worker pools.",
  },
  {
    id: "3",
    title: "Weekly Reflection",
    preview: "Felt really productive this week.",
    tags: ["Personal"],
    date: "Yesterday",
    pinned: false,
    content: "Productive week. Fixed routing bug and shipped dashboard polish.",
  },
  {
    id: "4",
    title: "1-on-1 with Sarah",
    preview: "Discussed transition to the new frontend team.",
    tags: ["Meeting", "Work"],
    date: "Oct 10",
    pinned: false,
    content: "Sarah moving to frontend team. Goals: mentorship, component library ownership.",
  },
];

export function tasksForAiContext(tasks: RecallTask[]) {
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    completed: t.completed,
    priority: t.priority,
    time: t.time ?? null,
    tags: t.tags,
  }));
}

export function notesForAiContext(notes: RecallNote[]) {
  return notes.map((n) => ({
    id: n.id,
    title: n.title,
    content: n.content,
    preview: n.preview,
    tags: n.tags,
  }));
}

export function notesForSemanticSearch(notes: RecallNote[]) {
  return notes.map((n) => ({
    id: n.id,
    title: n.title,
    text: `${n.title}\n${n.preview}\n${n.content}`,
  }));
}
