import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { MessageGroup } from "../types/chat-types.ts";
import { renderMessageGroup } from "./grouped-render.ts";

function buildAssistantGroup(text: string): MessageGroup {
  return {
    kind: "group",
    key: "g1",
    role: "assistant",
    timestamp: Date.now(),
    isStreaming: false,
    messages: [
      {
        key: "m1",
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
          timestamp: Date.now(),
        },
      },
    ],
  };
}

describe("grouped chat render", () => {
  it("renders clickable result links for structured assistant payloads", () => {
    const container = document.createElement("div");
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      renderMessageGroup(
        buildAssistantGroup('{"indexUrl":"https://example.com/files/index.html"}'),
        {
          showReasoning: false,
        },
      ),
      container,
    );

    const linkButtons = container.querySelectorAll(".chat-result-link");
    expect(linkButtons).toHaveLength(1);

    linkButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(openSpy).toHaveBeenCalledWith(
      "https://example.com/files/index.html",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("does not render result links for normal assistant markdown", () => {
    const container = document.createElement("div");
    render(
      renderMessageGroup(buildAssistantGroup("Visit https://example.com/docs for docs."), {
        showReasoning: false,
      }),
      container,
    );

    expect(container.querySelector(".chat-result-links")).toBeNull();
  });
});
