import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { Image as ImageIcon } from "lucide-react";
import { ImageLightbox, type LightboxImage } from "@/components/ImageLightbox";
import { fetchAttachmentBlob } from "@/lib/note-attachments";
import { notesPath } from "@/lib/recall-nav";
import type { AskAnswerImage } from "@/lib/recall-api";

function useAttachmentBlobs(images: AskAnswerImage[]): Map<string, string> {
  const [srcs, setSrcs] = useState<Map<string, string>>(new Map());
  const idsKey = images.map((i) => i.attachmentId).join(",");

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    const list = idsKey
      ? idsKey.split(",").map((attachmentId) => {
          const meta = images.find((i) => i.attachmentId === attachmentId);
          return meta ?? { attachmentId, noteId: "", noteTitle: "", fileName: "", mimeType: "" };
        })
      : [];

    void (async () => {
      const next = new Map<string, string>();
      await Promise.all(
        list.map(async (image) => {
          const blob = await fetchAttachmentBlob(image.attachmentId);
          if (!blob || cancelled) return;
          const url = URL.createObjectURL(blob);
          created.push(url);
          next.set(image.attachmentId, url);
        }),
      );
      if (!cancelled) setSrcs(next);
    })();

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by attachment ids
  }, [idsKey]);

  return srcs;
}

type Props = {
  images: AskAnswerImage[];
};

/** Inline gallery for Ask answers that include saved note attachments. */
export function AskAnswerImages({ images }: Props) {
  const srcs = useAttachmentBlobs(images);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (images.length === 0) return null;

  const noteLinks = [...new Map(images.map((i) => [i.noteId, i.noteTitle])).entries()];
  const lightboxImages: LightboxImage[] = images
    .map((image) => {
      const src = srcs.get(image.attachmentId);
      if (!src) return null;
      return { src, alt: image.fileName || image.noteTitle };
    })
    .filter((x): x is LightboxImage => Boolean(x));

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/45">
        <ImageIcon size={14} className="text-indigo-300" />
        Saved images ({images.length})
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((image, index) => {
          const src = srcs.get(image.attachmentId);
          if (!src) {
            return (
              <div
                key={image.attachmentId}
                className="aspect-[4/3] w-full animate-pulse rounded-xl bg-white/5"
              />
            );
          }
          return (
            <button
              key={image.attachmentId}
              type="button"
              onClick={() => setLightboxIndex(index)}
              className="group block w-full overflow-hidden rounded-xl border border-white/10 bg-black/20 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
              aria-label={`View full size: ${image.fileName || image.noteTitle}`}
            >
              <img
                src={src}
                alt={image.fileName || image.noteTitle}
                className="aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
              <div className="truncate px-2.5 py-1.5 text-[11px] text-white/50">
                {image.fileName}
              </div>
            </button>
          );
        })}
      </div>
      {noteLinks.length > 0 && (
        <p className="text-xs text-white/40">
          From{" "}
          {noteLinks.map(([id, title], i) => (
            <React.Fragment key={id}>
              {i > 0 ? ", " : ""}
              <Link href={notesPath({ noteId: id })} className="text-indigo-300 hover:underline">
                {title}
              </Link>
            </React.Fragment>
          ))}
        </p>
      )}
      {lightboxIndex != null && lightboxImages.length > 0 && (
        <ImageLightbox
          images={lightboxImages}
          index={Math.min(lightboxIndex, lightboxImages.length - 1)}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </section>
  );
}
