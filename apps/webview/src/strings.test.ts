import { describe, expect, it } from "vitest";

import { strings } from "./strings.js";

function collectStaticStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStaticStrings);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(collectStaticStrings);
  }
  return [];
}

describe("Webview product language", () => {
  it("keeps the static catalog in the Marketplace target language", () => {
    const values = collectStaticStrings(strings);

    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => value.trim().length > 0)).toBe(true);
    expect(values.some((value) => /[\u3400-\u9fff]/u.test(value))).toBe(false);
  });

  it("uses one English vocabulary for visible and screen-reader reasoning states", () => {
    expect(strings.reasoning.regionLabel).toBe(strings.reasoning.title);
    expect(strings.app.reasoningStatusLabel).toMatch(/status$/u);
    expect(strings.reasoning.toggle(true)).toBe("Collapse reasoning summary");
    expect(strings.reasoning.toggle(false, " 2")).toBe("Expand reasoning summary 2");
    expect(strings.reasoning.truncated).toBe("This summary was truncated.");
  });

  it("formats dynamic status and bounded values without changing language", () => {
    expect(strings.app.currentSession(undefined)).toBe("Current Session: New chat");
    expect(strings.app.currentSession("session-1")).toBe("Current Session: session-1");
    expect(strings.checkpoint.fileCount(2)).toBe("2 file(s)");
    expect(strings.mcpAnnouncements.connected("local-tools")).toBe(
      "Connected to MCP Server local-tools.",
    );
    expect(strings.command.name).toBe("run_command");
    expect(strings.onboarding.joiner).toBe(" and ");
    expect(strings.onboarding.pendingSuffix).toBe("…");
  });
});
