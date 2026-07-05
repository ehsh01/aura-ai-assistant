import { toast } from "@/hooks/use-toast";
import { ApiError } from "@workspace/api-client-react";
import { formatFileSize } from "@/lib/enex-upload";

type ImportFileResult = {
  parsed: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
  notebookId: string | null;
  firstNoteId: string | null;
};

export async function importEvernoteFiles(
  files: FileList | null,
  opts: {
    importing: boolean;
    setImporting: (v: boolean) => void;
    importFile: (file: File, onProgress?: (percent: number) => void) => Promise<ImportFileResult>;
    onSuccess: (result: ImportFileResult) => void | Promise<void>;
    onFinally?: () => void;
  },
): Promise<void> {
  const { importing, setImporting, importFile, onSuccess, onFinally } = opts;
  if (!files?.length || importing) return;

  setImporting(true);
  let totalImported = 0;
  let totalUpdated = 0;
  let totalParsed = 0;
  let totalSkipped = 0;
  const allErrors: string[] = [];
  let lastResult: ImportFileResult | null = null;

  try {
    for (const file of Array.from(files)) {
      const name = file.name.toLowerCase();
      const sizeLabel = formatFileSize(file.size);

      if (name.endsWith(".zip")) {
        allErrors.push(`${file.name}: unzip first, then select the .enex file inside`);
        continue;
      }

      toast({
        title: "Importing notebook…",
        description: `Uploading ${file.name} (${sizeLabel})…`,
      });

      const result = await importFile(file, (percent) => {
        if (percent >= 99) {
          toast({
            title: "Processing notes…",
            description: `${file.name}: import running on the server — keep this tab open`,
          });
        } else if (percent > 0 && percent < 100) {
          toast({
            title: "Uploading…",
            description: `${file.name}: ${percent}%`,
          });
        }
      });

      totalImported += result.imported;
      totalUpdated += result.updated;
      totalParsed += result.parsed;
      totalSkipped += result.skipped;
      allErrors.push(...result.errors);
      lastResult = result;
    }

    if (totalParsed === 0) {
      toast({
        title: "Import failed",
        description:
          allErrors[0] ??
          "No notes found. In Evernote: right-click notebook → Export → Evernote Export (.enex)",
        variant: "destructive",
      });
      return;
    }

    if (totalImported === 0 && totalUpdated === 0) {
      toast({
        title: "Nothing new imported",
        description:
          totalSkipped > 0
            ? `All ${totalParsed} notes are already in Recall.`
            : "Could not save notes — try signing out and back in.",
        variant: "destructive",
      });
      return;
    }

    if (lastResult) {
      await onSuccess({
        ...lastResult,
        parsed: totalParsed,
        imported: totalImported,
        updated: totalUpdated,
        skipped: totalSkipped,
        errors: allErrors,
      });
    }

    const parts: string[] = [];
    if (totalImported > 0) {
      parts.push(`Imported ${totalImported} new note${totalImported === 1 ? "" : "s"}.`);
    }
    if (totalUpdated > 0) {
      parts.push(`Updated ${totalUpdated} existing note${totalUpdated === 1 ? "" : "s"} with content and attachments.`);
    }
    if (totalSkipped > 0) {
      parts.push(`${totalSkipped} duplicate${totalSkipped === 1 ? "" : "s"} skipped.`);
    }
    toast({
      title: "Evernote import complete",
      description: parts.join(" "),
    });

    if (allErrors.length > 0) {
      toast({
        title: "Import warnings",
        description: allErrors.slice(0, 2).join(" "),
      });
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      toast({
        title: "Import failed — not signed in",
        description: "Sign out, sign back in, then try the import again.",
        variant: "destructive",
      });
      return;
    }
    const message = err instanceof Error ? err.message : "Could not save notes to the server.";
    toast({
      title: "Import failed",
      description:
        message.includes("413") || message.includes("Payload") || message.includes("too large")
          ? "Upload failed. Very large files upload in parts — keep this tab open until import finishes."
          : message,
      variant: "destructive",
    });
  } finally {
    setImporting(false);
    onFinally?.();
  }
}
