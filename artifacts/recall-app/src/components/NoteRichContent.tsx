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

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif)$/i;

function isImageAttachment(
  id: string,
  attachmentMap: Map<string, NoteAttachmentMeta>,
  label?: string | null,
): boolean {
  const meta = attachmentMap.get(id);
  if (meta?.isImage) return true;
  if (meta && !meta.mimeType.startsWith("image/")) return false;
  return IMAGE_EXT.test(label ?? "");
}

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

function NoteImageGallery({ images }: { images: NoteAttachmentMeta[] }) {
  if (images.length === 0) return null;

  return (
    <div className="note-image-gallery mb-6 pb-6 border-b border-white/10">
      <h4 className="text-sm font-semibold text-white/70 mb-3">
        {images.length === 1 ? "Photo" : `Photos (${images.length})`}
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {images.map((att) => (
          <AuthenticatedImage key={att.id} attachmentId={att.id} alt={att.fileName} />
        ))}
      </div>
    </div>
  );
}

async function setImageSrc(img: HTMLImageElement, attachmentId: string, revoked: string[]): Promise<void> {
  const blob = await fetchAttachmentBlob(attachmentId);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  revoked.push(url);
  img.src = url;
  img.classList.add("recall-note-image");
}

async function hydrateAttachmentElements(
  container: HTMLElement,
  attachmentMap: Map<string, NoteAttachmentMeta>,
  revoked: string[],
): Promise<void> {
  const images = container.querySelectorAll("img[data-recall-attachment]");
  for (const img of images) {
    if (!(img instanceof HTMLImageElement)) continue;
    const id = img.getAttribute("data-recall-attachment");
    if (!id || img.src.startsWith("blob:")) continue;
    await setImageSrc(img, id, revoked);
    if (!img.alt) {
      img.alt = attachmentMap.get(id)?.fileName ?? "Note image";
    }
  }

  const links = container.querySelectorAll("a[data-recall-attachment]");
  for (const link of links) {
    if (!(link instanceof HTMLAnchorElement)) continue;
    const id = link.getAttribute("data-recall-attachment");
    if (!id) continue;

    const meta = attachmentMap.get(id);
    const label = link.textContent?.trim() || meta?.fileName || "Attachment";

    if (isImageAttachment(id, attachmentMap, label)) {
      const img = document.createElement("img");
      img.setAttribute("data-recall-attachment", id);
      img.alt = meta?.fileName ?? label;
      img.className = "recall-note-image";
      await setImageSrc(img, id, revoked);
      link.replaceWith(img);
      continue;
    }

    if (meta?.mimeType === "application/pdf") {
      const wrapper = document.createElement("div");
      wrapper.className = "recall-pdf-embed my-4";

      const title = document.createElement("p");
      title.className = "text-xs text-white/50 mb-2";
      title.textContent = meta.fileName;
      wrapper.appendChild(title);

      const blob = await fetchAttachmentBlob(id);
      if (!blob) continue;
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
  }
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
    container.innerHTML = sanitized;
  }, [sanitized]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const revoked: string[] = [];
    let cancelled = false;

    void (async () => {
      await hydrateAttachmentElements(container, attachmentMap, revoked);
      if (cancelled) {
        for (const url of revoked) URL.revokeObjectURL(url);
      }
    })();

    return () => {
      cancelled = true;
      for (const url of revoked) URL.revokeObjectURL(url);
    };
  }, [sanitized, attachmentMap]);

  return (
    <div
      ref={containerRef}
      className="note-rich-content-evernote text-base text-white/80 leading-relaxed"
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

  const imageAttachments = attachments.filter((a) => a.isImage);
  const nonImageAttachments = attachments.filter((a) => !a.isImage);
  const hasInlineImageRefs = /<img[^>]+data-recall-attachment/i.test(content);
  const showImageGallery = imageAttachments.length > 0 && !hasInlineImageRefs;

  const unusedNonImageAttachments = nonImageAttachments.filter(
    (a) => !content.includes(`data-recall-attachment="${a.id}"`),
  );

  if (!isHtml) {
    return (
      <div className="note-rich-content">
        <NoteImageGallery images={showImageGallery ? imageAttachments : []} />
        <div className="whitespace-pre-wrap text-base text-white/80 leading-relaxed">
          {content}
        </div>
        {attachments.length > 0 && (
          <div className="mt-6 pt-4 border-t border-white/10">
            {nonImageAttachments.length > 0 && (
              <>
                <h4 className="text-sm font-semibold text-white/70 mb-3">Attachments</h4>
                <div className="space-y-2">
                  {nonImageAttachments.map((att) => (
                    <AttachmentBlock key={att.id} att={att} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="note-rich-content">
      <NoteImageGallery images={showImageGallery ? imageAttachments : []} />
      <HtmlNoteBody content={content} attachmentMap={attachmentMap} />

      {unusedNonImageAttachments.length > 0 && (
        <div className="mt-6 pt-4 border-t border-white/10">
          <h4 className="text-sm font-semibold text-white/70 mb-3">Attachments</h4>
          <div className="space-y-2">
            {unusedNonImageAttachments.map((att) => (
              <AttachmentBlock key={att.id} att={att} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
