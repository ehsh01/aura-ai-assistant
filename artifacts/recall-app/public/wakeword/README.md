# Recall "Hey Recall" wake-word model

This directory contains only the shared openWakeWord feature extractors and
Recall's own trained wake-word head. It does **not** contain any of
openWakeWord's bundled wake-word models.

## Files and licenses

| File                   | Purpose                                                               | License          |
| ---------------------- | --------------------------------------------------------------------- | ---------------- |
| `melspectrogram.onnx`  | openWakeWord shared mel feature extractor                             | Apache-2.0 + MIT |
| `embedding_model.onnx` | openWakeWord conversion of Google's `speech_embedding/1` shared model | Apache-2.0       |
| `mic-worklet.js`       | openWakeWord same-origin microphone worklet                           | Apache-2.0       |
| `hey_recall.onnx`      | Recall-trained classifier head                                        | CC BY 4.0        |

The shared binaries were regenerated locally; the ambiguous prebuilt
openWakeWord v0.5.1 binaries are not shipped. `melspectrogram.onnx` was exported
from openWakeWord's Apache-2.0 conversion notebook and torchlibrosa's MIT
implementation. `embedding_model.onnx` was reconstructed from Google's
Apache-2.0 [`speech_embedding/1`](https://tfhub.dev/google/speech_embedding/1)
checkpoint using the architecture documented by openWakeWord. The reproducible
exporter is `scripts/wakeword/export-shared-models.py`, based on openWakeWord
v0.6.0 commit `c8ef6912c5feccf1037b852d9bc6c7ed644135ba`.

The regenerated models were compared with the historical v0.5.1 models on
seeded tensors: both produced identical shapes and bit-identical outputs
(`max_abs_error=0.0`). The historical binaries were used only as a validation
oracle and are not included. Two clean regeneration runs produced the same
SHA-256 values listed below. License texts are in
`LICENSE-APACHE-2.0.txt` and `LICENSE-TORCHLIBROSA-MIT.txt`.

The complete feature extraction and head training were then rerun using only
the regenerated shared models. The regenerated feature arrays and
`hey_recall.onnx` were byte-identical to the first run, including the custom
head SHA-256 listed below.

The dynamically loaded browser pipeline is `openwakeword-web@0.1.0`
(Apache-2.0) with `onnxruntime-web@1.30.0` (MIT). The package contains no model
files. ONNX Runtime's notice is in `LICENSE-ONNXRUNTIME-MIT.txt`.

`hey_recall.onnx` was trained for Recall from synthetic speech generated with
Piper's `en_US-libritts-high` voice. The voice is trained from LibriTTS
train-clean-360, licensed CC BY 4.0. Attribution:
[OpenSLR 60 / LibriTTS](https://www.openslr.org/60/) and the
[Piper voice model](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/libritts/high).
The resulting head is offered under CC BY 4.0 and permits commercial use with
attribution. A copy of that license is in `LICENSE-CC-BY-4.0.txt`.

## Training

Training used the openWakeWord synthetic-data stages on this repository's free
4-vCPU VM: synthetic Piper speech, confusable negatives, gain/timing/background
augmentation, the frozen openWakeWord feature pipeline, and a small DNN
classifier head. No GPU, paid API, or paid compute was used.

Data:

- 240 positive clips: 80 LibriTTS speakers saying "hey recall" at three rates.
- 240 hard negatives: 20 confusable phrases (for example "hey we call",
  "hey Rachel", "they recall", and "hey record") across 12 other speakers.
- 120 ordinary-speech negatives: 40 sentences across three other speakers.
- Each positive and hard-negative clip received 16 deterministic placements,
  gain changes, and speech/noise backgrounds before feature extraction.
- Held out by speaker: 50 positive, 20 hard-negative, and 40 ordinary-speech
  clips. None of those speakers were used to train the head.

The runtime threshold is documented in `src/lib/wake-word-runtime.ts`.
Evaluation uses streaming 80 ms windows with 1.5 seconds of silence on each
side, matching the browser inference path.

After detection, the browser captures only the question as 16 kHz mono PCM WAV.
The backend validates the actual PCM byte count against the 60-second cap before
calling OpenAI, so compressed-container metadata cannot bypass the STT quota.

Model sizes and SHA-256:

| File                   |     Bytes | SHA-256                                                            |
| ---------------------- | --------: | ------------------------------------------------------------------ |
| `melspectrogram.onnx`  | 1,087,757 | `153d111d6a63aa1158218cf644bac27916207d58043f0484d0440fd1112c5658` |
| `embedding_model.onnx` | 1,320,340 | `34c183ab7c79c1ae7c18c8964809dd43003b1f9b99f82cfdd4d5b09c164e744a` |
| `hey_recall.onnx`      |   415,224 | `c6337bb313ac5bd286ada97e7a63bea7ce417da51cb2adcf501357d854d3b5f3` |

## Reproduce or retrain

From the repository root:

```bash
python3 -m venv /tmp/recall-shared-model-venv
/tmp/recall-shared-model-venv/bin/pip install --upgrade pip
/tmp/recall-shared-model-venv/bin/pip install \
  -r scripts/wakeword/requirements-shared-models.txt
TF_USE_LEGACY_KERAS=1 \
  /tmp/recall-shared-model-venv/bin/python \
  scripts/wakeword/export-shared-models.py \
  /tmp/recall-shared-models

python3 -m venv /tmp/recall-wake-venv
/tmp/recall-wake-venv/bin/pip install --upgrade pip piper-tts onnx
/tmp/recall-wake-venv/bin/python \
  scripts/wakeword/generate-hey-recall.py \
  --output /tmp/recall-wake-training

git clone https://github.com/9zax/wakekit.git /tmp/wakekit
git -C /tmp/wakekit checkout f07112a0424e8ca5cdd36e6a6d5613956d897d4a
git -C /tmp/wakekit apply "$PWD/scripts/wakeword/openwakeword-int16.patch"
cp /tmp/recall-shared-models/{melspectrogram,embedding_model}.onnx \
  /tmp/wakekit/models/

npm --prefix /tmp/wakekit install --omit=dev
cd /tmp/wakekit
node scripts/featurize.mjs \
  /tmp/recall-wake-training/corpus \
  /tmp/recall-wake-training/features
/tmp/recall-wake-venv/bin/python scripts/train.py \
  /tmp/recall-wake-training/features \
  /tmp/recall-wake-training/hey_recall.onnx \
  --base models/lada.onnx \
  --steps 3000 \
  --neg-weight 16

cd -
python3 scripts/wakeword/prepare-eval.py \
  /tmp/recall-wake-training/held-out \
  /tmp/recall-wake-training/eval
cd /tmp/wakekit
node scripts/eval.mjs \
  /tmp/recall-wake-training/eval \
  /tmp/recall-wake-training/hey_recall.onnx \
  0.97
```

The pinned WakeKit scripts are an Apache-2.0 CPU implementation of the same
openWakeWord feature pipeline and DNN head. The checked-in patch restores
openWakeWord's int16 PCM scale before the shared melspectrogram model. The base
head supplies only an ONNX graph template; the trainer asserts and replaces
every weight tensor.

## Evaluation

At threshold `0.97`, on speakers excluded from training:

| Set                       | Clips | Result                                           |
| ------------------------- | ----: | ------------------------------------------------ |
| "hey recall" positives    |    50 | 49 detected; 2.0% false-reject rate              |
| confusable hard negatives |    20 | 0 fired                                          |
| ordinary-speech negatives |    40 | 0 fired                                          |
| all negatives             |    60 | 0.00 false fires/minute over the generated clips |

The missed positive peaked at `0.560`. The next-lowest positive peaked at
`0.971`; the highest negative peaked at `0.966`, so the selected threshold has
a narrow synthetic margin. These generated results validate the pipeline but
do not predict performance for every real microphone, accent, room,
television, or overlapping conversation. Before widening rollout, collect
opt-in real-room positives and long negative recordings, then retrain and tune
the threshold against false accepts per hour.
