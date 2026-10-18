import { describe, expect, it } from "vitest";
import { encodePcmWav, rmsInt16 } from "./wake-word-pcm";

describe("wake-word PCM capture", () => {
  it("encodes exact 16 kHz mono PCM WAV duration and headers", async () => {
    const wav = encodePcmWav([new Int16Array(16_000)]);
    const bytes = new Uint8Array(await wav.arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(wav.type).toBe("audio/wav");
    expect(wav.size).toBe(32_044);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(32_000);
  });

  it("computes normalized RMS from signed PCM", () => {
    expect(rmsInt16(new Int16Array([0, 0]))).toBe(0);
    expect(rmsInt16(new Int16Array([16_384, -16_384]))).toBeCloseTo(0.5);
  });
});
