#!/usr/bin/env python3
"""Generate PNG PWA icons for Recall (run from artifacts/recall-app)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"

PRIMARY = (99, 102, 241, 255)
WHITE = (255, 255, 255, 255)


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    inset = max(1, size // 16)
    radius = max(8, size // 5)
    draw.rounded_rectangle(
        [inset, inset, size - inset, size - inset],
        radius=radius,
        fill=PRIMARY,
    )

    cx = cy = size // 2
    arm = size // 5
    half = max(2, size // 28)
    star = [
        (cx, cy - arm * 2),
        (cx + half, cy - half),
        (cx + arm * 2, cy),
        (cx + half, cy + half),
        (cx, cy + arm * 2),
        (cx - half, cy + half),
        (cx - arm * 2, cy),
        (cx - half, cy - half),
    ]
    draw.polygon(star, fill=WHITE)

    dot_r = max(3, size // 18)
    dot_cx = cx - arm
    dot_cy = cy + arm // 2
    draw.ellipse(
        [dot_cx - dot_r, dot_cy - dot_r, dot_cx + dot_r, dot_cy + dot_r],
        fill=WHITE,
    )
    return img


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    outputs = {
        180: PUBLIC / "apple-touch-icon.png",
        192: PUBLIC / "pwa-192x192.png",
        512: PUBLIC / "pwa-512x512.png",
    }
    for size, path in outputs.items():
        draw_icon(size).save(path, format="PNG")
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
