#!/usr/bin/env python3
"""Generate transparent PNG PWA icons for Recall from public/recall-icon-source.png."""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SOURCE = PUBLIC / "recall-icon-source.png"

THEME_BG = (10, 10, 15, 255)  # #0a0a0f — maskable icon safe background only


def remove_black_background(img: Image.Image, threshold: int = 36) -> Image.Image:
    """Flood-fill near-black edge pixels to transparent (removes square PNG backdrop)."""
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size

    def is_backdrop(x: int, y: int) -> bool:
        r, g, b, a = pixels[x, y]
        return a > 0 and r <= threshold and g <= threshold and b <= threshold

    seen = [[False] * h for _ in range(w)]
    queue: deque[tuple[int, int]] = deque()

    for x in range(w):
        for y in (0, h - 1):
            if is_backdrop(x, y) and not seen[x][y]:
                seen[x][y] = True
                queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_backdrop(x, y) and not seen[x][y]:
                seen[x][y] = True
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        pixels[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[nx][ny] and is_backdrop(nx, ny):
                seen[nx][ny] = True
                queue.append((nx, ny))

    return img


def crop_to_content(img: Image.Image, pad: int = 4) -> Image.Image:
    bbox = img.getbbox()
    if not bbox:
        return img
    left, top, right, bottom = bbox
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(img.width, right + pad)
    bottom = min(img.height, bottom + pad)
    return img.crop((left, top, right, bottom))


def prepare_source(raw: Image.Image) -> Image.Image:
    cleaned = crop_to_content(remove_black_background(raw))
    cleaned.save(PUBLIC / "recall-icon-transparent.png", format="PNG")
    return cleaned


def fit_icon(source: Image.Image, size: int, *, maskable: bool = False) -> Image.Image:
    """Scale brain art large; transparent except maskable Android icon."""
    bg = THEME_BG if maskable else (0, 0, 0, 0)
    canvas = Image.new("RGBA", (size, size), bg)
    max_side = int(size * 0.80) if maskable else int(size * 0.98)
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
    source = prepare_source(Image.open(SOURCE))

    outputs: list[tuple[int, Path, bool]] = [
        (16, PUBLIC / "favicon-16.png", False),
        (32, PUBLIC / "favicon-32.png", False),
        (64, PUBLIC / "recall-logo-64.png", False),
        (128, PUBLIC / "recall-logo-128.png", False),
        (256, PUBLIC / "recall-logo-256.png", False),
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
