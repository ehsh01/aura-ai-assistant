import React, { useMemo, useState } from "react";
import { generateWorkNote, listProjects } from "@workspace/api-client-react";
import { ingestCaptureReliable } from "@/lib/capture-queue";
import { MicButton } from "@/components/MicButton";
import { useRecallData } from "@/context/RecallDataContext";
import { toast } from "@/hooks/use-toast";
import type { RecallProject } from "@/lib/recall-context";

type Props = {
  open: boolean;
  onClose: () => void;
};

function firstLineTitle(text: string): string {
  const line = text.trim().split(/\r?\n/).find(Boolean) ?? "Quick capture";
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

const TEXT_FILE_RE = /\.(txt|md|csv|json|log)$/i;
const TEXT_FILE_CAP = 10_000;

export function CaptureModal({ open, onClose }: Props) {
  const { notebooks, addNote, addTask } = useRecallData();
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notebookId, setNotebookId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [binaryNames, setBinaryNames] = useState<string[]>([]);
  const [projects, setProjects] = useState<RecallProject[]>([]);
  const [workNote, setWorkNote] = useState<null | {
    internalWorkNote: string;
    customerUpdate: string;
    transferReason: string;
    resolutionNote: string;
    emailReply: string;
  }>(null);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (!open) return;
    void listProjects().then((res) => setProjects(res.projects as RecallProject[])).catch(() => {});
  }, [open]);

  const attachmentSummary = useMemo(() => {
    if (binaryNames.length === 0) return "";
    return `\n\nAttachments selected: ${binaryNames.join(", ")}`;
  }, [binaryNames]);

  if (!open) return null;

  const reset = () => {
    setText("");
    setSourceUrl("");
    setDueDate("");
    setNotebookId("");
    setProjectId("");
    setBinaryNames([]);
    setWorkNote(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  // Text-like files are inlined into the capture so the AI sees their content;
  // binaries keep filename-only placeholders (no OCR pipeline yet).
  const handleFiles = async (list: File[]) => {
    const textParts: string[] = [];
    const binaries: string[] = [];
    for (const file of list) {
      const isText = TEXT_FILE_RE.test(file.name) || file.type.startsWith("text/");
      if (isText) {
        try {
          const content = (await file.text()).slice(0, TEXT_FILE_CAP);
          textParts.push(`--- ${file.name} ---\n${content}`);
        } catch {
          binaries.push(file.name);
        }
      } else {
        binaries.push(file.name);
      }
    }
    setBinaryNames(binaries);
    if (textParts.length > 0) {
      setText((prev) => [prev.trim(), ...textParts].filter(Boolean).join("\n\n"));
    }
  };

  const requireText = () => {
    const rawText = `${text.trim()}${attachmentSummary}`;
    if (!rawText.trim()) {
      toast({ title: "Capture is empty", description: "Type or dictate something first." });
      return null;
    }
    return rawText;
  };

  const saveAsNote = () => {
    const rawText = requireText();
    if (!rawText) return;
    addNote({
      title: firstLineTitle(text),
      content: rawText,
      notebookId: notebookId || null,
      projectId: projectId || null,
      tags: ["capture"],
    });
    toast({ title: "Saved as note", description: "Your capture was added to Notes." });
    close();
  };

  const saveAsTask = () => {
    const rawText = requireText();
    if (!rawText) return;
    addTask(`${firstLineTitle(text)}${dueDate ? ` — due ${dueDate}` : ""}`);
    toast({ title: "Saved as task", description: "Your capture was added to Tasks." });
    close();
  };

  const sendToInbox = async () => {
    const rawText = requireText();
    if (!rawText || saving) return;
    setSaving(true);
    try {
      const result = await ingestCaptureReliable({
        rawText,
        sourceType: "manual",
        sourceName: "Capture Modal",
        title: firstLineTitle(text),
        sourceUrl: sourceUrl.trim() || undefined,
      });
      toast({
        title: result.queued ? "Saved offline" : "Sent to AI Inbox",
        description: result.queued
          ? "Will sync to AI Inbox when you're back online."
          : "Raw capture stored. Recall is processing it in the background.",
      });
      close();
    } catch {
      toast({
        title: "Capture failed",
        description: "Could not save this capture. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const createWorkNote = async () => {
    const rawText = requireText();
    if (!rawText || saving) return;
    setSaving(true);
    try {
      const result = await generateWorkNote({ rawText, tone: "concise" });
      setWorkNote(result);
      toast({ title: "Work note generated", description: "Review and save or copy the outputs." });
    } catch {
      toast({ title: "Could not generate work note", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const saveWorkNote = () => {
    if (!workNote) return;
    addNote({
      title: `IT Work Note — ${firstLineTitle(text)}`,
      content: [
        "Internal Work Note",
        workNote.internalWorkNote,
        "",
        "Customer Update",
        workNote.customerUpdate,
        "",
        "Transfer Reason",
        workNote.transferReason,
        "",
        "Resolution Note",
        workNote.resolutionNote,
        "",
        "Email Reply",
        workNote.emailReply,
      ].join("\n"),
      tags: ["work", "it-support"],
      notebookId: notebookId || null,
      projectId: projectId || null,
    });
    toast({ title: "Saved work note", description: "The generated IT note was saved." });
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl max-h-[92dvh] sm:max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-white/10 bg-[#101018] shadow-2xl recall-safe-bottom">
        <div className="flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-white/10 sticky top-0 bg-[#101018] z-10">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white">Quick Capture</h2>
            <p className="text-sm text-white/45">Dump anything. Recall can save it now or route it to the AI Inbox.</p>
          </div>
          <button type="button" onClick={close} className="text-white/50 hover:text-white shrink-0 px-2 py-1">
            Close
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="flex items-start gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type or dictate anything: a task, reminder, work note, permit detail, follow-up, idea..."
              className="min-h-44 flex-1 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/85 outline-none placeholder:text-white/30"
            />
            <MicButton
              onTranscript={(transcript) =>
                setText((prev) => `${prev}${prev.trim() ? " " : ""}${transcript}`)
              }
              className="rounded-xl border border-white/10 bg-white/[0.05] p-3 text-indigo-300"
              title="Dictate capture"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80"
            />
            <select
              value={notebookId}
              onChange={(e) => setNotebookId(e.target.value)}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80"
            >
              <option value="">No notebook</option>
              {notebooks.map((notebook) => (
                <option key={notebook.id} value={notebook.id}>
                  {notebook.name}
                </option>
              ))}
            </select>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80"
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="Link (optional) — paste a URL this capture came from"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none placeholder:text-white/30"
          />

          <label className="block rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-3 text-sm text-white/55">
            Optional files — .txt/.md/.csv/.json/.log are inlined into the capture
            <input
              type="file"
              multiple
              className="mt-2 block w-full text-xs text-white/45"
              onChange={(e) => void handleFiles(Array.from(e.target.files ?? []))}
            />
            <span className="mt-1 block text-xs text-white/35">
              Images/PDFs keep a filename placeholder for now — their content isn't analyzed yet.
            </span>
          </label>
          {binaryNames.length > 0 && (
            <p className="text-xs text-white/40">
              Attached by name: {binaryNames.join(", ")}
            </p>
          )}

          {workNote && (
            <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4 text-sm text-white/75">
              <h3 className="mb-3 font-semibold text-indigo-200">Generated IT Work Note</h3>
              {Object.entries(workNote).map(([key, value]) => (
                <div key={key} className="mb-3">
                  <p className="mb-1 text-xs uppercase tracking-[0.2em] text-white/35">
                    {key.replace(/([A-Z])/g, " $1")}
                  </p>
                  <p className="whitespace-pre-wrap">{value}</p>
                </div>
              ))}
              <button
                type="button"
                onClick={saveWorkNote}
                className="rounded-xl bg-indigo-500 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-400"
              >
                Save generated work note
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:justify-end gap-2 p-4 sm:p-5 border-t border-white/10 sticky bottom-0 bg-[#101018]">
          <button type="button" onClick={() => void createWorkNote()} className="rounded-xl bg-white/10 px-3 py-2.5 text-sm text-white hover:bg-white/15 col-span-2 sm:col-span-1">
            Create Work Note
          </button>
          <button type="button" onClick={saveAsNote} className="rounded-xl bg-white/10 px-3 py-2.5 text-sm text-white hover:bg-white/15">
            Save as note
          </button>
          <button type="button" onClick={saveAsTask} className="rounded-xl bg-white/10 px-3 py-2.5 text-sm text-white hover:bg-white/15">
            Save as task
          </button>
          <button
            type="button"
            onClick={() => void sendToInbox()}
            disabled={saving}
            className="rounded-xl bg-indigo-500 px-3 py-2.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50 col-span-2 sm:col-span-1"
          >
            Send to AI Inbox
          </button>
        </div>
      </div>
    </div>
  );
}
