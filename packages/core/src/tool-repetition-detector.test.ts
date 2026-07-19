import { describe, expect, it } from "vitest";

import { ToolRepetitionDetector } from "./tool-repetition-detector.js";

describe("ToolRepetitionDetector", () => {
  it("reaches the threshold for consecutive calls with the same tool and input", () => {
    const detector = new ToolRepetitionDetector(3);

    expect(detector.observe(call("call-1", "read_file", { path: "a.ts" }))).toEqual({
      consecutiveCount: 1,
      thresholdReached: false,
    });
    expect(detector.observe(call("call-2", "read_file", { path: "a.ts" }))).toEqual({
      consecutiveCount: 2,
      thresholdReached: false,
    });
    expect(detector.observe(call("call-3", "read_file", { path: "a.ts" }))).toEqual({
      consecutiveCount: 3,
      thresholdReached: true,
    });
  });

  it("treats different object key order as the same JSON input", () => {
    const detector = new ToolRepetitionDetector(2);

    detector.observe(call("call-1", "search_files", { query: "x", options: { limit: 5 } }));

    expect(
      detector.observe(call("call-2", "search_files", { options: { limit: 5 }, query: "x" })),
    ).toEqual({ consecutiveCount: 2, thresholdReached: true });
  });

  it("resets when the input changes", () => {
    const detector = new ToolRepetitionDetector(2);

    detector.observe(call("call-1", "read_file", { path: "a.ts" }));

    expect(detector.observe(call("call-2", "read_file", { path: "b.ts" }))).toEqual({
      consecutiveCount: 1,
      thresholdReached: false,
    });
  });

  it("resets across interleaved tool calls", () => {
    const detector = new ToolRepetitionDetector(2);

    detector.observe(call("call-1", "read_file", null));
    detector.observe(call("call-2", "list_files", null));

    expect(detector.observe(call("call-3", "read_file", null))).toEqual({
      consecutiveCount: 1,
      thresholdReached: false,
    });
  });

  it.each([0, 11, 1.5, Number.NaN])("rejects an invalid threshold: %s", (threshold) => {
    expect(() => new ToolRepetitionDetector(threshold)).toThrow(RangeError);
  });
});

function call(id: string, name: "read_file" | "search_files" | "list_files", input: object | null) {
  return { id, name, input };
}
