import React, { useEffect, useMemo, useState } from "react";
import {
  attachmentUrl,
  fetchAttachmentBlob,
  fetchNoteAttachments,
  type NoteAttachmentMeta,
} from "@/lib/note-attachments";

type Props = {
  noteId: string;
  content: string;
  contentFormat?: "plain" | "html";
};

function useAttachmentBlob(attachmentId: string): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;

    void (async () => {
      const blob = await fetchAttachmentBlob(attachmentId);
      if (!blob || cancelled) return;
      revoked = URL.createObjectURL(blob);
      setSrc(revoked);
    })();

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [attachmentId]);

  return src;
}

function AuthenticatedImage({ attachmentId, alt }: { attachmentId: string; alt: string }) {
  const src = useAttachmentBlob(attachmentId);

  if (!src) {
    return (
      <div className="my-3 h-32 rounded-lg bg-white/5 animate-pulse flex items-center justify-center text-xs text-white/30">
        Loading image…
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="recall-note-image my-3 max-w-full rounded-lg border border-white/10"
    />
  );
}

function EmbeddedPdf({ attachmentId, fileName }: { attachmentId: string; fileName: string }) {
  const src = useAttachmentBlob(attachmentId);

  if (!src) {
    return (
      <div className="my-3 h-48 rounded-lg bg-white/5 animate-pulse flex items-center justify-center text-xs text-white/30">
        Loading PDF…
      </div>
    );
  }

  return (
    <div className="my-4">
      <p className="text-xs text-white/50 mb-2">{fileName}</p>
      <iframe
        src={src}
        title={fileName}
        className="w-full h-[min(70vh,720px)] rounded-lg border border-white/10 bg-white"
      />
    </div>
  );
}

function AttachmentLink({
  attachmentId,
  label,
  meta,
}: {
  attachmentId: string;
  label: string;
  meta?: NoteAttachmentMeta;
}) {
  const handleOpen = async (e: React.MouseEvent) => {
    e.preventDefault();
    const blob = await fetchAttachmentBlob(attachmentId);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <a
      href={attachmentUrl(attachmentId)}
      onClick={(e) => void handleOpen(e)}
      className="recall-attachment-link text-indigo-300 hover:text-indigo-200 underline"
    >
      {label}
      {meta && !meta.isImage && meta.mimeType !== "application/pdf" ? ` (${formatBytes(meta.sizeBytes)})` : ""}
    </a>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function AttachmentBlock({ att }: { att: NoteAttachmentMeta }) {
  if (att.isImage) {
    return <AuthenticatedImage attachmentId={att.id} alt={att.fileName} />;
  }
  if (att.mimeType === "application/pdf") {
    return <EmbeddedPdf attachmentId={att.id} fileName={att.fileName} />;
  }
  return (
    <div className="my-2">
      <AttachmentLink attachmentId={att.id} label={att.fileName} meta={att} />
    </div>
  );
}

export function NoteRichContent({ noteId, content, contentFormat }: Props) {
  const [attachments, setAttachments] = useState<NoteAttachmentMeta[]>([]);
  const isHtml =
    contentFormat === "html" ||
    content.includes("data-recall-attachment") ||
    /<(div|ul|ol|li|br|p|a|table|h[1-6])\b/i.test(content);

  useEffect(() => {
    void fetchNoteAttachments(noteId).then(setAttachments);
  }, [noteId]);

  const attachmentMap = useMemo(
    () => new Map(attachments.map((a) => [a.id, a])),
    [attachments],
  );

  const unusedAttachments = attachments.filter(
    (a) => !content.includes(`data-recall-attachment="${a.id}"`),
  );

  if (!isHtml) {
    return (
      <div className="note-rich-content">
        <div className="whitespace-pre-wrap text-base text-white/80 leading-relaxed">
          {content}
        </div>
        {unusedAttachments.length > 0 && (
          <div className="mt-6 pt-4 border-t border-white/10">
            <h4 className="text-sm font-semibold text-white/70 mb-3">Attachments</h4>
            <div className="space-y-2">
              {unusedAttachments.map((att) => (
                <AttachmentBlock key={att.id} att={att} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${content}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) {
    return <div className="text-white/80 whitespace-pre-wrap">{content}</div>;
  }

  const renderNode = (node: ChildNode, key: string): React.ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as HTMLElement;
    const attId = el.getAttribute("data-recall-attachment");

    if (attId && el.tagName === "IMG") {
      const meta = attachmentMap.get(attId);
      return <AuthenticatedImage key={key} attachmentId={attId} alt={meta?.fileName ?? "Image"} />;
    }

    if (attId && el.tagName === "A") {
      const meta = attachmentMap.get(attId);
      if (meta?.mimeType === "application/pdf") {
        return <EmbeddedPdf key={key} attachmentId={attId} fileName={meta.fileName} />;
      }
      return (
        <AttachmentLink
          key={key}
          attachmentId={attId}
          label={el.textContent?.trim() || meta?.fileName || "Attachment"}
          meta={meta}
        />
      );
    }

    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes).map((child, i) =>
      renderNode(child, `${key}-${i}`),
    );

    if (tag === "h4") {
      return (
        <h4 key={key} className="text-sm font-semibold text-white/70 mt-4 mb-2">
          {children}
        </h4>
      );
    }
    if (tag === "ul") {
      return (
        <ul key={key} className="list-disc pl-5 space-y-1 text-sm text-white/75">
          {children}
        </ul>
      );
    }
    if (tag === "li") {
      return <li key={key}>{children}</li>;
    }
    if (tag === "div" && el.classList.contains("recall-attachments")) {
      return (
        <div key={key} className="mt-6 pt-4 border-t border-white/10">
          {children}
        </div>
      );
    }
    if (tag === "br") {
      return <br key={key} />;
    }

    return (
      <div key={key} className="my-1">
        {children}
      </div>
    );
  };

  return (
    <div className="note-rich-content text-base text-white/80 leading-relaxed space-y-1">
      {Array.from(root.childNodes).map((node, i) => renderNode(node, `n-${i}`))}

      {unusedAttachments.length > 0 && (
        <div className="mt-6 pt-4 border-t border-white/10">
          <h4 className="text-sm font-semibold text-white/70 mb-3">Attachments</h4>
          <div className="space-y-2">
            {unusedAttachments.map((att) => (
              <AttachmentBlock key={att.id} att={att} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
