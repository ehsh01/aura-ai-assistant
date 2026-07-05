#!/usr/bin/env python3
"""Generate PNG PWA icons for Recall from public/recall-icon-source.png."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SOURCE = PUBLIC / "recall-icon-source.png"

THEME_BG = (6, 6, 16, 255)  # #060610 — matches PWA manifest background


def fit_icon(source: Image.Image, size: int, *, maskable: bool = False) -> Image.Image:
    """Resize source art into a square PNG, with safe-zone padding for maskable icons."""
    canvas = Image.new("RGBA", (size, size), THEME_BG if maskable else (0, 0, 0, 0))
    max_side = int(size * 0.82) if maskable else size
    fitted = source.copy()
    fitted.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    x = (size - fitted.width) // 2
    y = (size - fitted.height) // 2
    canvas.paste(fitted, (x, y), fitted)
    return canvas


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Missing source icon: {SOURCE}")

    PUBLIC.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGBA")

    outputs: list[tuple[int, Path, bool]] = [
        (16, PUBLIC / "favicon-16.png", False),
        (32, PUBLIC / "favicon-32.png", False),
        (180, PUBLIC / "apple-touch-icon.png", False),
        (192, PUBLIC / "pwa-192x192.png", False),
        (512, PUBLIC / "pwa-512x512.png", False),
        (512, PUBLIC / "pwa-512x512-maskable.png", True),
    ]

    for size, path, maskable in outputs:
        fit_icon(source, size, maskable=maskable).save(path, format="PNG")
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
