export function rmsInt16(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (const sample of frame) {
    const normalized = sample / 32768;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / frame.length);
}

export function encodePcmWav(frames: Int16Array[]): Blob {
  const sampleCount = frames.reduce((total, frame) => total + frame.length, 0);
  const dataBytes = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (const frame of frames) {
    for (const sample of frame) {
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}
