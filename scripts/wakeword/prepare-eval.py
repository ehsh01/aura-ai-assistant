#!/usr/bin/env python3
import argparse
import shutil
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("held_out", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    groups = [
        ("pos", "pos"),
        ("hard", "neg_hard"),
        ("neg", "neg_speech"),
    ]
    for source_name, prefix in groups:
        for index, source in enumerate(
            sorted((args.held_out / source_name).glob("*.wav")),
        ):
            shutil.copyfile(
                source,
                args.output / f"{prefix}_{index:03d}.wav",
            )


if __name__ == "__main__":
    main()
