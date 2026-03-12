import { describe, expect, it } from "vitest";
import { buildToolContextMeta } from "./tool-cards.ts";

describe("buildToolContextMeta", () => {
  it("marks context as in-flight when calls exceed results", () => {
    const meta = buildToolContextMeta([
      { kind: "call", name: "fetch" },
      { kind: "call", name: "search" },
      { kind: "result", name: "fetch", text: "ok" },
    ]);

    expect(meta.calls).toBe(2);
    expect(meta.results).toBe(1);
    expect(meta.inFlight).toBe(true);
  });

  it("marks context as settled when results catch up", () => {
    const meta = buildToolContextMeta([
      { kind: "call", name: "fetch" },
      { kind: "result", name: "fetch", text: "ok" },
    ]);

    expect(meta.calls).toBe(1);
    expect(meta.results).toBe(1);
    expect(meta.inFlight).toBe(false);
  });
});
