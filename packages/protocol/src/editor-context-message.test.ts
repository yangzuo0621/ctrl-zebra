import { describe, expect, it } from "vitest";

import {
  editorContextMessageSchema,
  extensionToWebviewMessageSchema,
  protocolVersion,
  webviewToExtensionMessageSchema,
} from "./index.js";

const context = {
  source: {
    uri: { scheme: "file", authority: "", path: "src/index.ts" },
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 4 },
    },
    languageId: "typescript",
    documentVersion: 3,
    stale: false,
    truncated: false,
  },
  text: "const",
} as const;

describe("T1905 editor context messages", () => {
  it("round-trips strict ready, stale, cleared, unavailable and intents", () => {
    const ready = {
      protocolVersion,
      type: "extension/editor-context",
      requestId: "host-ready",
      viewGeneration: 1,
      sessionGeneration: 0,
      eventSequence: 1,
      status: "ready",
      cardGeneration: 1,
      captureId: "capture-1",
      contextId: "context-1",
      scope: "selection",
      context,
    } as const;
    const stale = {
      ...ready,
      requestId: "host-stale",
      eventSequence: 2,
      status: "stale",
      reason: "selection-changed",
      context: { ...context, source: { ...context.source, stale: true } },
    } as const;
    const cleared = {
      protocolVersion,
      type: "extension/editor-context",
      requestId: "host-clear",
      viewGeneration: 1,
      sessionGeneration: 0,
      eventSequence: 3,
      status: "cleared",
      cardGeneration: 1,
      contextId: "context-1",
      reason: "disabled",
    } as const;
    const unavailable = {
      protocolVersion,
      type: "extension/editor-context",
      requestId: "host-unavailable",
      viewGeneration: 1,
      sessionGeneration: 0,
      eventSequence: 4,
      status: "unavailable",
      scope: "active-editor",
      code: "no-editor",
    } as const;
    const refresh = {
      protocolVersion,
      type: "webview/editor-context-refresh",
      requestId: "web-refresh",
      viewGeneration: 1,
      sessionGeneration: 0,
      cardGeneration: 1,
      contextId: "context-1",
      scope: "selection",
    } as const;
    const remove = {
      protocolVersion,
      type: "webview/editor-context-remove",
      requestId: "web-remove",
      viewGeneration: 1,
      sessionGeneration: 0,
      cardGeneration: 1,
      contextId: "context-1",
    } as const;
    const useStale = {
      ...remove,
      type: "webview/editor-context-use-stale",
      requestId: "web-stale",
    } as const;

    for (const event of [ready, stale, cleared, unavailable]) {
      expect(
        extensionToWebviewMessageSchema.parse(JSON.parse(JSON.stringify(event)) as unknown),
      ).toEqual(event);
    }
    expect(
      editorContextMessageSchema.safeParse({ ...cleared, captureId: "forbidden" }).success,
    ).toBe(false);
    for (const intent of [refresh, remove, useStale]) {
      expect(
        webviewToExtensionMessageSchema.parse(JSON.parse(JSON.stringify(intent)) as unknown),
      ).toEqual(intent);
    }
  });

  it("rejects extra fields, stale=false stale projections, and captureId on non-capture statuses", () => {
    const base = {
      protocolVersion,
      type: "extension/editor-context",
      requestId: "host",
      viewGeneration: 1,
      sessionGeneration: 0,
      eventSequence: 1,
      status: "cleared",
      cardGeneration: 1,
      contextId: "context-1",
      reason: "disabled",
    } as const;
    expect(editorContextMessageSchema.safeParse({ ...base, captureId: "forbidden" }).success).toBe(
      false,
    );
    expect(editorContextMessageSchema.safeParse({ ...base, extra: true }).success).toBe(false);
    expect(
      editorContextMessageSchema.safeParse({
        ...base,
        status: "stale",
        captureId: "capture-1",
        scope: "active-editor",
        reason: "document-changed",
        context: { ...context, source: { ...context.source, stale: false } },
      }).success,
    ).toBe(false);
  });
});
