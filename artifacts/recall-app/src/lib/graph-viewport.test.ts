import { describe, expect, it } from "vitest";
import {
  calculateGraphFit,
  clampGraphLabelBox,
  shouldRenderGraphLabel,
} from "./graph-viewport";

describe("graph viewport fit", () => {
  it("centers a desktop graph between the top and bottom bars", () => {
    const fit = calculateGraphFit({
      canvasWidth: 1280,
      canvasHeight: 800,
      viewport: { left: 32, top: 150, right: 1248, bottom: 700 },
      graph: { left: -300, top: -200, right: 300, bottom: 200 },
    });
    expect(fit).toMatchObject({ stretchX: 1, stretchY: 1 });
    expect(400 + fit.y).toBeCloseTo(425);
    expect(fit.scale).toBeGreaterThan(1);
  });

  it("uses a taller mobile projection to fill the available 390x844 space", () => {
    const fit = calculateGraphFit({
      canvasWidth: 390,
      canvasHeight: 768,
      viewport: { left: 18, top: 68, right: 372, bottom: 650 },
      graph: { left: -240, top: -220, right: 240, bottom: 220 },
    });
    expect(fit.stretchX).toBe(0.64);
    expect(fit.stretchY).toBe(1.08);
    const renderedHeight = 440 * fit.stretchY * fit.scale;
    expect(renderedHeight).toBeGreaterThan(500);
    expect(renderedHeight).toBeLessThanOrEqual(582);
  });
});

describe("graph labels", () => {
  it("clamps labels inside the unobscured viewport", () => {
    expect(
      clampGraphLabelBox(
        { left: -40, top: 700 },
        120,
        14,
        { left: 18, top: 68, right: 372, bottom: 650 },
      ),
    ).toEqual({ left: 18, top: 636, right: 138, bottom: 650 });
  });

  it("shows only hubs or hovered nodes at low zoom", () => {
    const base = {
      labelsEnabled: true,
      scale: 0.5,
      mobile: true,
    };
    expect(shouldRenderGraphLabel({ ...base, hub: true, hovered: false })).toBe(
      true,
    );
    expect(shouldRenderGraphLabel({ ...base, hub: false, hovered: true })).toBe(
      true,
    );
    expect(
      shouldRenderGraphLabel({ ...base, hub: false, hovered: false }),
    ).toBe(false);
  });
});
