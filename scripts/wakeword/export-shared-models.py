#!/usr/bin/env python3
"""Regenerate openWakeWord's shared feature models from permissive sources."""

import argparse
import os
from pathlib import Path

import numpy as np


def canonicalize_onnx(path: Path, graph_name: str) -> None:
    """Replace exporter-generated tensor suffixes with stable names."""
    import onnx

    model = onnx.load(path)
    graph = model.graph
    public_names = {value.name for value in graph.input}
    public_names.update(value.name for value in graph.output)
    names: dict[str, str] = {}
    initializer_names = {initializer.name for initializer in graph.initializer}
    constant_index = 0
    for node in graph.node:
        for input_name in node.input:
            if input_name in initializer_names and input_name not in names:
                names[input_name] = f"constant_{constant_index:03d}"
                constant_index += 1
    for initializer in graph.initializer:
        if initializer.name not in public_names and initializer.name not in names:
            names[initializer.name] = f"constant_{constant_index:03d}"
            constant_index += 1
    tensor_index = 0
    for node in graph.node:
        for output_name in node.output:
            if output_name and output_name not in public_names:
                names[output_name] = f"tensor_{tensor_index:03d}"
                tensor_index += 1

    for initializer in graph.initializer:
        initializer.name = names.get(initializer.name, initializer.name)
    ordered_initializers = sorted(graph.initializer, key=lambda value: value.name)
    del graph.initializer[:]
    graph.initializer.extend(ordered_initializers)
    for index, node in enumerate(graph.node):
        node.name = f"node_{index:03d}_{node.op_type.lower()}"
        for input_index, input_name in enumerate(node.input):
            node.input[input_index] = names.get(input_name, input_name)
        for output_index, output_name in enumerate(node.output):
            node.output[output_index] = names.get(output_name, output_name)
    for value in graph.value_info:
        value.name = names.get(value.name, value.name)

    dynamic_dims: dict[str, str] = {}
    for value in [*graph.input, *graph.output, *graph.value_info]:
        tensor_type = value.type.tensor_type
        for dimension in tensor_type.shape.dim:
            if dimension.dim_param.startswith("unk__"):
                if dimension.dim_param not in dynamic_dims:
                    dynamic_dims[dimension.dim_param] = (
                        f"dynamic_{len(dynamic_dims):03d}"
                    )
                dimension.dim_param = dynamic_dims[dimension.dim_param]

    graph.name = graph_name
    model.doc_string = ""
    del model.metadata_props[:]
    onnx.checker.check_model(model)
    path.write_bytes(model.SerializeToString(deterministic=True))


def export_embedding(output: Path) -> None:
    os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")
    import tensorflow as tf
    import tensorflow_hub as hub
    import tf2onnx

    source = hub.KerasLayer(
        "https://tfhub.dev/google/speech_embedding/1",
        trainable=False,
    )

    def leaky_relu():
        alpha = 0.20000000298023224
        return lambda value: tf.maximum(alpha * value, value)

    def batch_norm_and_activation(value):
        value = tf.keras.layers.BatchNormalization()(value)
        value = leaky_relu()(value)
        return tf.maximum(value, -0.4000000059604645)

    inputs = tf.keras.Input((76, 32, 1), name="input_1")
    value = tf.keras.layers.ZeroPadding2D((0, 1))(inputs)
    value = tf.keras.layers.Conv2D(
        24,
        (3, 3),
        use_bias=False,
        padding="valid",
    )(value)
    value = batch_norm_and_activation(value)

    def pair(value, current_channels, next_channels, pool_size, strides, padding):
        value = tf.keras.layers.Conv2D(
            current_channels,
            (1, 3),
            use_bias=False,
            padding="same",
        )(value)
        value = batch_norm_and_activation(value)
        value = tf.keras.layers.Conv2D(
            current_channels,
            (3, 1),
            use_bias=False,
            padding="valid",
        )(value)
        value = batch_norm_and_activation(value)
        value = tf.keras.layers.MaxPool2D(
            pool_size,
            strides,
            padding=padding,
        )(value)
        value = tf.keras.layers.Conv2D(
            next_channels,
            (1, 3),
            use_bias=False,
            padding="same",
        )(value)
        value = batch_norm_and_activation(value)
        value = tf.keras.layers.Conv2D(
            next_channels,
            (3, 1),
            use_bias=False,
            padding="valid",
        )(value)
        return batch_norm_and_activation(value)

    value = pair(value, 24, 48, (2, 2), (2, 2), "valid")
    value = pair(value, 48, 72, (1, 2), (1, 2), "same")
    value = pair(value, 72, 96, (2, 2), (2, 2), "valid")
    value = pair(value, 96, 96, (1, 2), (1, 2), "valid")

    value = tf.keras.layers.Conv2D(
        96,
        (1, 3),
        use_bias=False,
        padding="same",
    )(value)
    value = batch_norm_and_activation(value)
    value = tf.keras.layers.Conv2D(
        96,
        (3, 1),
        use_bias=False,
        padding="valid",
    )(value)
    value = batch_norm_and_activation(value)
    value = tf.keras.layers.MaxPool2D(
        (2, 2),
        (2, 2),
        padding="valid",
    )(value)
    outputs = tf.keras.layers.Conv2D(
        96,
        (3, 1),
        use_bias=False,
        padding="valid",
        name="embedding",
    )(value)
    model = tf.keras.Model(inputs=inputs, outputs=outputs)
    model.set_weights(source.get_weights())

    # The source layer constrains its first convolution kernel to zero mean.
    first_kernel = model.layers[2].get_weights()[0]
    first_kernel -= np.mean(first_kernel, axis=(0, 1), keepdims=True)
    model.layers[2].set_weights([first_kernel])

    signature = [tf.TensorSpec((None, 76, 32, 1), tf.float32, name="input_1")]
    tf2onnx.convert.from_keras(
        model,
        input_signature=signature,
        opset=13,
        output_path=str(output),
    )
    canonicalize_onnx(output, "recall_openwakeword_embedding")


def export_melspectrogram(output: Path) -> None:
    import torch
    import torchlibrosa as tl

    def power_to_db(self, input_value):
        ref_value = self.ref
        ten = torch.tensor(10.0, dtype=input_value.dtype)
        amin = torch.tensor(self.amin, dtype=input_value.dtype)
        log_spec = 10.0 * torch.log(torch.clamp(input_value, min=self.amin))
        log_spec /= torch.log(ten)
        log_spec -= 10.0 * torch.log(
            torch.maximum(amin, torch.tensor(ref_value, dtype=input_value.dtype))
        ) / torch.log(ten)
        if self.top_db is not None:
            log_spec = torch.clamp(log_spec, min=log_spec.max() - self.top_db)
        return log_spec

    tl.stft.LogmelFilterBank.power_to_db = power_to_db
    feature_extractor = torch.nn.Sequential(
        tl.Spectrogram(
            center=False,
            n_fft=512,
            hop_length=160,
            win_length=400,
        ),
        tl.LogmelFilterBank(
            n_fft=512,
            sr=16_000,
            n_mels=32,
            fmin=60,
            fmax=3_800,
            is_log=True,
        ),
    )
    example = torch.zeros(1, 32_000)
    torch.onnx.export(
        feature_extractor,
        example,
        str(output),
        opset_version=12,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={
            "input": {0: "batch_size", 1: "samples"},
            "output": {0: "batch_size", 1: "time"},
        },
        dynamo=False,
    )
    canonicalize_onnx(output, "recall_openwakeword_melspectrogram")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output_dir", type=Path)
    parser.add_argument(
        "--component",
        choices=("all", "embedding", "melspectrogram"),
        default="all",
    )
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.component in ("all", "embedding"):
        export_embedding(args.output_dir / "embedding_model.onnx")
    if args.component in ("all", "melspectrogram"):
        export_melspectrogram(args.output_dir / "melspectrogram.onnx")


if __name__ == "__main__":
    main()
