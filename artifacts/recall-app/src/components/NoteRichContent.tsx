import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  attachmentUrl,
  fetchAttachmentBlob,
  fetchNoteAttachments,
  type NoteAttachmentMeta,
} from "@/lib/note-attachments";
import { ImageLightbox, type LightboxImage } from "@/components/ImageLightbox";

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
        } else if (name === "href") {
          const rewritten = rewriteEvernoteHref(attr.value);
          if (rewritten) child.setAttribute("href", rewritten);
        }
      }
      walk(child);
    }
  };

  walk(root);
  return root.innerHTML;
}

/**
 * Map Evernote deep links (evernote:///view/…/{guid}/…) to in-app note URLs.
 * Prefer the last UUID in the path (the note guid).
 */
function rewriteEvernoteHref(href: string): string | null {
  const raw = href.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (!lower.startsWith("evernote:") && !lower.includes("evernote.com")) {
    return null;
  }
  const uuidMatch = raw.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  );
  const guid = uuidMatch?.[uuidMatch.length - 1];
  if (!guid) return null;
  return `/notes?note=${encodeURIComponent(`note-en-${guid}`)}`;
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

function AuthenticatedImage({
  attachmentId,
  alt,
  onOpen,
}: {
  attachmentId: string;
  alt: string;
  onOpen?: (src: string, alt: string) => void;
}) {
  const src = useAttachmentBlob(attachmentId);

  if (!src) {
    return (
      <div className="my-3 h-32 rounded-lg bg-white/5 animate-pulse flex items-center justify-center text-xs text-white/30">
        Loading image…
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen?.(src, alt)}
      className="recall-note-image-btn block w-full text-left cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 rounded-lg"
      aria-label={`View full size: ${alt}`}
    >
      <img
        src={src}
        alt={alt}
        className="recall-note-image my-3 max-w-full rounded-lg border border-white/10 pointer-events-none"
      />
    </button>
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

function AttachmentBlock({
  att,
  onOpen,
}: {
  att: NoteAttachmentMeta;
  onOpen?: (src: string, alt: string) => void;
}) {
  if (att.isImage) {
    return <AuthenticatedImage attachmentId={att.id} alt={att.fileName} onOpen={onOpen} />;
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

function NoteImageGallery({
  images,
  onOpen,
}: {
  images: NoteAttachmentMeta[];
  onOpen?: (src: string, alt: string) => void;
}) {
  if (images.length === 0) return null;

  return (
    <div className="note-image-gallery mb-6 pb-6 border-b border-white/10">
      <h4 className="text-sm font-semibold text-white/70 mb-3">
        {images.length === 1 ? "Photo" : `Photos (${images.length})`}
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {images.map((att) => (
          <AuthenticatedImage key={att.id} attachmentId={att.id} alt={att.fileName} onOpen={onOpen} />
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
  img.classList.add("recall-note-image", "cursor-zoom-in");
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
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);
  const noteContentRef = useRef<HTMLDivElement>(null);
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

  const openLightbox = useCallback((src: string, alt: string) => {
    const container = noteContentRef.current;
    const images: LightboxImage[] = container
      ? Array.from(container.querySelectorAll("img.recall-note-image"))
          .filter((img): img is HTMLImageElement => img instanceof HTMLImageElement && Boolean(img.src))
          .map((img) => ({ src: img.src, alt: img.alt || "Note image" }))
      : [{ src, alt }];

    const index = images.findIndex((img) => img.src === src);
    setLightbox({ images, index: index >= 0 ? index : 0 });
  }, []);

  const handleContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!target.classList.contains("recall-note-image")) return;
      if (!target.src) return;
      openLightbox(target.src, target.alt || "Note image");
    },
    [openLightbox],
  );

  const contentShell = (children: React.ReactNode) => (
    <>
      <div ref={noteContentRef} className="note-rich-content" onClick={handleContentClick}>
        {children}
      </div>
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndexChange={(index) => setLightbox((prev) => (prev ? { ...prev, index } : null))}
        />
      )}
    </>
  );

  if (!isHtml) {
    return contentShell(
      <>
        <NoteImageGallery images={showImageGallery ? imageAttachments : []} onOpen={openLightbox} />
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
                    <AttachmentBlock key={att.id} att={att} onOpen={openLightbox} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </>,
    );
  }

  return contentShell(
    <>
      <NoteImageGallery images={showImageGallery ? imageAttachments : []} onOpen={openLightbox} />
      <HtmlNoteBody content={content} attachmentMap={attachmentMap} />

      {unusedNonImageAttachments.length > 0 && (
        <div className="mt-6 pt-4 border-t border-white/10">
          <h4 className="text-sm font-semibold text-white/70 mb-3">Attachments</h4>
          <div className="space-y-2">
            {unusedNonImageAttachments.map((att) => (
              <AttachmentBlock key={att.id} att={att} onOpen={openLightbox} />
            ))}
          </div>
        </div>
      )}
    </>,
  );
}
