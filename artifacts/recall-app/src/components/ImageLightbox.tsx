import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export type LightboxImage = {
  src: string;
  alt: string;
};

type Props = {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
};

export function ImageLightbox({ images, index, onClose, onIndexChange }: Props) {
  const current = images[index];
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && hasNext) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasNext, hasPrev, index, onClose, onIndexChange]);

  if (!current) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/95 recall-safe-top recall-safe-bottom"
      role="dialog"
      aria-modal="true"
      aria-label={current.alt || "Image preview"}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
        <p className="min-w-0 flex-1 truncate text-sm text-white/70">{current.alt || "Photo"}</p>
        {images.length > 1 && (
          <span className="shrink-0 text-xs text-white/40">
            {index + 1} / {images.length}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        className="relative flex flex-1 min-h-0 items-center justify-center overflow-auto p-4"
        onClick={onClose}
      >
        {hasPrev && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange(index - 1);
            }}
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/90 hover:bg-black/70 transition-colors"
            aria-label="Previous image"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        <img
          src={current.src}
          alt={current.alt}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[calc(100dvh-7rem)] max-w-full w-auto h-auto object-contain select-none"
          draggable={false}
        />

        {hasNext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange(index + 1);
            }}
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/90 hover:bg-black/70 transition-colors"
            aria-label="Next image"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      <p className="shrink-0 pb-4 text-center text-xs text-white/35">Tap outside to close · Pinch to zoom</p>
    </div>,
    document.body,
  );
}
