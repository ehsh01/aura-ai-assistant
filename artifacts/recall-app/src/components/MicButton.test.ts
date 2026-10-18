import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MicButton, type MicButtonController } from "./MicButton";

function controller(listening: boolean): MicButtonController {
  return {
    listening,
    transcribing: false,
    supported: true,
    blockReason: null,
    mode: "browser",
    start: vi.fn(),
    stop: vi.fn(),
    toggle: vi.fn(),
  };
}

describe("Talk to Recall ring semantics", () => {
  it("renders the entire ring as one keyboard-native pressed button", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MicButton,
        {
          controller: controller(true),
          onTranscript: vi.fn(),
          title: "Talk to Recall",
          className: "assistant-ring is-listening",
          iconSize: 58,
          holdToTalk: true,
          quiet: true,
        },
        React.createElement("span", null, "R.E.C.A.L.L. LISTENING"),
      ),
    );

    expect(html).toContain('<button type="button"');
    expect(html).toContain('aria-label="Stop listening"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("assistant-ring is-listening");
    expect(html).not.toContain('role="button"');
  });
});
