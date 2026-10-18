#!/usr/bin/env python3
import argparse
import subprocess
import urllib.request
import wave
from pathlib import Path

from piper import PiperVoice, SynthesisConfig

BASE_URL = (
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
    "en/en_US/libritts/high/"
)

HARD_NEGATIVES = [
    "hey we call",
    "hey Rico",
    "hey Rachel",
    "hey Nicole",
    "hey Paul",
    "hey y'all",
    "they recall",
    "I recall",
    "you recall",
    "please recall",
    "recall",
    "a recall",
    "he recalled",
    "we called",
    "hey record",
    "hey, call",
    "take the call",
    "make a call",
    "may recall",
    "total recall",
]

NEGATIVE_SENTENCES = [
    "The meeting starts after lunch.",
    "Please send the document before Friday.",
    "What time does the train arrive?",
    "I left the keys beside the front door.",
    "Can you add milk to the shopping list?",
    "The quarterly report needs another review.",
    "We should call the electrician tomorrow.",
    "Rachel will join the video call at noon.",
    "I remember where the contract was filed.",
    "Turn down the music in the living room.",
    "The weather should clear by this evening.",
    "Put the appointment on my calendar.",
    "There are three unread messages.",
    "The project deadline moved to next week.",
    "Please remind me to water the plants.",
    "Where did I save the insurance policy?",
    "The package is waiting at reception.",
    "We need to record the customer interview.",
    "Nicole shared the latest design draft.",
    "Paul is taking the first support call.",
    "I can recall some details from the trip.",
    "They called while you were away.",
    "The coffee machine needs more water.",
    "Open the notes from yesterday's workshop.",
    "Find the receipt for the new laptop.",
    "Our reservation is under a different name.",
    "Read the next item on the task list.",
    "Set a timer for twenty five minutes.",
    "The garage door was closed this morning.",
    "Move the dentist visit to Thursday.",
    "The budget includes travel and supplies.",
    "Show me the photos from the conference.",
    "The invoice has already been paid.",
    "This room is quieter in the afternoon.",
    "We can finish the presentation tomorrow.",
    "The phone is charging on the desk.",
    "Check whether the flight is still on time.",
    "Archive the completed project notes.",
    "The blue folder contains the warranty.",
    "Someone left a message about the delivery.",
]


def download(name: str, destination: Path) -> None:
    if destination.exists():
        return
    print(f"downloading {name}", flush=True)
    urllib.request.urlretrieve(BASE_URL + name, destination)


def synthesize(
    voice: PiperVoice,
    text: str,
    destination: Path,
    speaker: int,
    length_scale: float,
) -> None:
    if destination.exists():
        return
    raw = destination.with_suffix(".raw.wav")
    with wave.open(str(raw), "wb") as wav_file:
        voice.synthesize_wav(
            text,
            wav_file,
            SynthesisConfig(
                speaker_id=speaker,
                length_scale=length_scale,
                noise_scale=0.72,
                noise_w_scale=0.85,
            ),
        )
    subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(raw),
            "-ar",
            "16000",
            "-ac",
            "1",
            "-sample_fmt",
            "s16",
            str(destination),
        ],
        check=True,
    )
    raw.unlink()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("/tmp/recall-wake-training"),
    )
    args = parser.parse_args()
    root = args.output.resolve()
    voice_path = root / "en_US-libritts-high.onnx"
    config_path = root / "en_US-libritts-high.onnx.json"

    root.mkdir(parents=True, exist_ok=True)
    download(voice_path.name, voice_path)
    download(config_path.name, config_path)
    voice = PiperVoice.load(voice_path, config_path)

    train = root / "corpus"
    held_out = root / "held-out"
    for directory in [
        train / "pos",
        train / "hard",
        train / "neg",
        held_out / "pos",
        held_out / "hard",
        held_out / "neg",
    ]:
        directory.mkdir(parents=True, exist_ok=True)

    # 80 training speakers x 3 speaking rates = 240 positive examples.
    for speaker in range(80):
        for rate_index, rate in enumerate((0.82, 1.0, 1.18)):
            synthesize(
                voice,
                "hey recall",
                train / "pos" / f"speaker-{speaker:03d}-rate-{rate_index}.wav",
                speaker,
                rate,
            )

    # Confusable phrases are deliberately over-represented.
    for phrase_index, phrase in enumerate(HARD_NEGATIVES):
        for speaker in range(80, 92):
            synthesize(
                voice,
                phrase,
                train / "hard" / f"phrase-{phrase_index:02d}-speaker-{speaker:03d}.wav",
                speaker,
                (0.88, 1.0, 1.12)[speaker % 3],
            )

    for index, sentence in enumerate(NEGATIVE_SENTENCES):
        for repeat in range(3):
            speaker = 120 + index * 3 + repeat
            synthesize(
                voice,
                sentence,
                train / "neg" / f"sentence-{index:02d}-{repeat}.wav",
                speaker,
                (0.9, 1.0, 1.1)[repeat],
            )

    # Speakers 800+ never appear in training.
    for index, speaker in enumerate(range(800, 850)):
        synthesize(
            voice,
            "hey recall",
            held_out / "pos" / f"speaker-{speaker:03d}.wav",
            speaker,
            (0.85, 1.0, 1.15)[index % 3],
        )
    for index, phrase in enumerate(HARD_NEGATIVES):
        speaker = 850 + index
        synthesize(
            voice,
            phrase,
            held_out / "hard" / f"phrase-{index:02d}.wav",
            speaker,
            1.0,
        )
    for index, sentence in enumerate(NEGATIVE_SENTENCES):
        speaker = 700 + index
        synthesize(
            voice,
            sentence,
            held_out / "neg" / f"sentence-{index:02d}.wav",
            speaker,
            1.0,
        )
    print("CORPUS_READY", flush=True)


if __name__ == "__main__":
    main()
