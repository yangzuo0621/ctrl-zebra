import { describe, expect, it, vi } from "vitest";

import { PerformanceBaselineRecorder } from "./performance-baseline.js";

describe("PerformanceBaselineRecorder", () => {
  it("records activation, idle RSS, and the first Webview display with bounded integers", () => {
    const info = vi.fn();
    const times = [112.4, 150.8];
    const recorder = new PerformanceBaselineRecorder({
      startedAt: 100.2,
      now: () => times.shift() ?? 500,
      readRssBytes: () => 52_428_801.6,
      logger: { info },
    });

    recorder.recordActivationComplete();
    recorder.recordFirstWebviewDisplay();
    recorder.recordFirstWebviewDisplay();

    expect(recorder.getSnapshot()).toEqual({
      activationDurationMs: 12,
      firstWebviewDisplayDurationMs: 51,
      memoryBytes: 52_428_802,
    });

    expect(info.mock.calls).toEqual([
      [
        {
          event: "extension_activated",
          component: "extension",
          outcome: "success",
          durationMs: 12,
        },
      ],
      [
        {
          event: "extension_idle_memory_sampled",
          component: "extension",
          outcome: "success",
          memoryBytes: 52_428_802,
        },
      ],
      [
        {
          event: "agent_view_first_displayed",
          component: "agent_view",
          outcome: "success",
          durationMs: 51,
        },
      ],
    ]);
  });

  it("normalizes invalid clocks and memory samples without throwing", () => {
    const info = vi.fn();
    const recorder = new PerformanceBaselineRecorder({
      startedAt: Number.NaN,
      now: () => -1,
      readRssBytes: () => Number.POSITIVE_INFINITY,
      logger: { info },
    });

    recorder.recordActivationComplete();
    recorder.recordFirstWebviewDisplay();

    expect(recorder.getSnapshot()).toEqual({
      activationDurationMs: 0,
      firstWebviewDisplayDurationMs: 0,
      memoryBytes: 0,
    });

    expect(info.mock.calls).toEqual([
      [expect.objectContaining({ durationMs: 0 })],
      [expect.objectContaining({ memoryBytes: 0 })],
      [expect.objectContaining({ durationMs: 0 })],
    ]);
  });

  it("emits each completed sample without changing the public snapshot", () => {
    const samples: unknown[] = [];
    const recorder = new PerformanceBaselineRecorder({
      startedAt: 10,
      now: () => 20,
      readRssBytes: () => 30,
      logger: { info: vi.fn() },
      onSample: (sample) => samples.push(sample),
    });

    recorder.recordActivationComplete();
    recorder.recordFirstWebviewDisplay();

    expect(samples).toEqual([
      { activationDurationMs: 10, memoryBytes: 30 },
      {
        activationDurationMs: 10,
        firstWebviewDisplayDurationMs: 10,
        memoryBytes: 30,
      },
    ]);
  });
});
