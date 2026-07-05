import React, { useEffect, useMemo, useRef, useState } from "react";
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

const BLOCKED_TAGS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
]);

/** Strip scripts and event handlers; keep Evernote/web-clip layout (styles, tables, etc.). */
function sanitizeNoteHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";

  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      const tag = child.tagName.toLowerCase();
      if (BLOCKED_TAGS.has(tag)) {
        child.remove();
        continue;
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) {
          child.removeAttribute(attr.name);
        } else if (
          (name === "href" || name === "src") &&
          attr.value.trim().toLowerCase().startsWith("javascript:")
        ) {
          child.removeAttribute(attr.name);
        }
      }
      walk(child);
    }
  };

  walk(root);
  return root.innerHTML;
}

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

function HtmlNoteBody({
  content,
  attachmentMap,
}: {
  content: string;
  attachmentMap: Map<string, NoteAttachmentMeta>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sanitized = useMemo(() => sanitizeNoteHtml(content), [content]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const revoked: string[] = [];
    let cancelled = false;

    const hydrate = async () => {
      const images = container.querySelectorAll("img[data-recall-attachment]");
      for (const img of images) {
        const id = img.getAttribute("data-recall-attachment");
        if (!id) continue;
        const blob = await fetchAttachmentBlob(id);
        if (cancelled || !blob) continue;
        const url = URL.createObjectURL(blob);
        revoked.push(url);
        img.setAttribute("src", url);
        img.classList.add("recall-note-image");
        if (!img.getAttribute("alt")) {
          img.setAttribute("alt", attachmentMap.get(id)?.fileName ?? "Note image");
        }
      }

      const links = container.querySelectorAll("a[data-recall-attachment]");
      for (const link of links) {
        const id = link.getAttribute("data-recall-attachment");
        if (!id) continue;
        const meta = attachmentMap.get(id);
        if (meta?.mimeType !== "application/pdf") continue;

        const wrapper = document.createElement("div");
        wrapper.className = "recall-pdf-embed my-4";

        const label = document.createElement("p");
        label.className = "text-xs text-white/50 mb-2";
        label.textContent = meta.fileName;
        wrapper.appendChild(label);

        const blob = await fetchAttachmentBlob(id);
        if (cancelled || !blob) continue;
        const url = URL.createObjectURL(blob);
        revoked.push(url);

        const iframe = document.createElement("iframe");
        iframe.src = url;
        iframe.title = meta.fileName;
        iframe.className =
          "w-full h-[min(70vh,720px)] rounded-lg border border-white/10 bg-white";
        wrapper.appendChild(iframe);

        link.replaceWith(wrapper);
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
      for (const url of revoked) URL.revokeObjectURL(url);
    };
  }, [sanitized, attachmentMap]);

  return (
    <div
      ref={containerRef}
      className="note-rich-content-evernote text-base text-white/80 leading-relaxed"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

export function NoteRichContent({ noteId, content, contentFormat }: Props) {
  const [attachments, setAttachments] = useState<NoteAttachmentMeta[]>([]);
  const isHtml =
    contentFormat === "html" ||
    content.includes("data-recall-attachment") ||
    /<(div|ul|ol|li|br|p|a|table|h[1-6]|span|td|tr|th|tbody|thead)\b/i.test(content);

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
        {attachments.length > 0 && (
          <div className="mt-6 pt-4 border-t border-white/10">
            <h4 className="text-sm font-semibold text-white/70 mb-3">Attachments</h4>
            <div className="space-y-2">
              {attachments.map((att) => (
                <AttachmentBlock key={att.id} att={att} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="note-rich-content">
      <HtmlNoteBody content={content} attachmentMap={attachmentMap} />

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
