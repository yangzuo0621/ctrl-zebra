import type {
  EditorContextRemoveMessage,
  EditorContextUseStaleMessage,
  ExtensionToWebviewMessage,
  IdeTextContextDto,
} from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";

import { createEditorContextSourceFingerprint } from "../adapters/vscode-editor-context.js";
import {
  EditorContextEntryController,
  type EditorContextMessageChannel,
} from "./editor-context-entry.js";

const context: IdeTextContextDto = {
  source: {
    uri: { scheme: "file", authority: "", path: "src/index.ts" },
    languageId: "typescript",
    documentVersion: 1,
    stale: false,
    truncated: false,
  },
  text: "const answer = 42;",
};

describe("EditorContextEntryController", () => {
  it("owns asynchronous Host transition fencing and ignores stale availability", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    const availabilityResolvers: Array<(value: "untrusted-workspace" | undefined) => void> = [];
    let availabilityReads = 0;
    const controller = createController(messages, {
      getAvailability: () => {
        availabilityReads += 1;
        if (availabilityReads === 1) return Promise.resolve(undefined);
        return new Promise((resolve) => {
          availabilityResolvers.push(resolve);
        });
      },
    });
    await controller.entry.ask("active-editor");

    controller.entry.notifyHostTransition("document-changed", "active-editor");
    controller.entry.notifyHostTransition("editor-changed", "active-editor");
    availabilityResolvers[0]?.("untrusted-workspace");
    await Promise.resolve();
    expect(messages).toHaveLength(1);

    availabilityResolvers[1]?.(undefined);
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    expect(messages.at(-1)).toMatchObject({ status: "stale", reason: "editor-changed" });
  });

  it("delivers one ready card and keeps the capture editable at the Host boundary", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    const controller = createController(messages);
    await controller.entry.ask("active-editor");

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "extension/editor-context",
      status: "ready",
      viewGeneration: 1,
      sessionGeneration: 0,
      eventSequence: 1,
      cardGeneration: 1,
      scope: "active-editor",
      context,
    });
    expect(
      (
        messages[0] as Extract<
          ExtensionToWebviewMessage,
          { type: "extension/editor-context"; status: "ready" }
        >
      ).captureId,
    ).toBeDefined();
  });

  it("drops a cancelled capture and emits no unavailable or late event", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    let release: (() => void) | undefined;
    const controller = createController(messages, {
      readContext: async (_scope, signal) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        signal.throwIfAborted();
        return context;
      },
    });
    const capture = controller.entry.ask("selection");
    await vi.waitFor(() => expect(release).toBeDefined());
    controller.actions.clearForNewChat();
    release?.();
    await capture;
    expect(messages).toEqual([]);
  });

  it("cancels an in-flight selection capture on a selection transition", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    let release: (() => void) | undefined;
    const controller = createController(messages, {
      readContext: async (_scope, signal) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        signal.throwIfAborted();
        return context;
      },
    });
    const capture = controller.entry.ask("selection");
    await vi.waitFor(() => expect(release).toBeDefined());
    controller.entry.notifyTransition(["selection-changed"]);
    release?.();
    await capture;
    expect(messages).toEqual([]);
  });

  it("keeps an active-editor capture open through a selection transition", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    let release: (() => void) | undefined;
    const controller = createController(messages, {
      readContext: async (scope, signal) => {
        expect(scope).toBe("active-editor");
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        signal.throwIfAborted();
        return context;
      },
    });
    const capture = controller.entry.ask("active-editor");
    await vi.waitFor(() => expect(release).toBeDefined());
    controller.entry.notifyTransition(["selection-changed"]);
    release?.();
    await capture;
    expect(messages.filter((message) => message.type === "extension/editor-context")).toHaveLength(
      1,
    );
    expect(messages[0]).toMatchObject({ status: "ready", scope: "active-editor" });
  });

  it("emits one stale transition per owner and then one Host clear", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    const controller = createController(messages);
    await controller.entry.ask("selection");
    controller.entry.notifyTransition(["document-changed", "selection-changed"], "source-a");
    controller.entry.notifyTransition(["selection-changed", "document-changed"], "source-a");
    expect(messages.filter((message) => message.type === "extension/editor-context")).toHaveLength(
      2,
    );
    expect(messages[1]).toMatchObject({ status: "stale", reason: "selection-changed" });
    expect(
      (
        messages[1] as Extract<
          ExtensionToWebviewMessage,
          { type: "extension/editor-context"; status: "stale" }
        >
      ).context.source.stale,
    ).toBe(true);

    controller.entry.invalidate("disabled");
    expect(messages).toHaveLength(3);
    expect(messages[2]).toMatchObject({ status: "cleared", reason: "disabled" });
    expect("captureId" in messages[2]).toBe(false);
  });

  it("closes capture A before Refresh B and only lets B commit", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    const releases: Array<() => void> = [];
    let readCount = 0;
    const controller = createController(messages, {
      readContext: async (_scope, signal) => {
        const index = readCount++;
        await new Promise<void>((resolve) => (releases[index] = resolve));
        signal.throwIfAborted();
        return context;
      },
    });
    const first = controller.entry.ask("active-editor");
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const second = controller.entry.ask("active-editor");
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[0]?.();
    releases[1]?.();
    await Promise.all([first, second]);
    expect(
      messages.filter(
        (message) => message.type === "extension/editor-context" && message.status === "ready",
      ),
    ).toHaveLength(1);
  });

  it("deduplicates an identical Refresh intent without starting another capture", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    let readCount = 0;
    let release: (() => void) | undefined;
    const controller = createController(messages, {
      readContext: async (_scope, signal) => {
        readCount += 1;
        if (readCount > 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        signal.throwIfAborted();
        return context;
      },
    });
    await controller.entry.ask("active-editor");
    const ready = messages[0] as Extract<
      ExtensionToWebviewMessage,
      { type: "extension/editor-context"; status: "ready" }
    >;
    const refresh = {
      protocolVersion: 1 as const,
      type: "webview/editor-context-refresh" as const,
      requestId: "refresh-duplicate",
      viewGeneration: ready.viewGeneration,
      sessionGeneration: ready.sessionGeneration,
      cardGeneration: ready.cardGeneration,
      contextId: ready.contextId,
      scope: ready.scope,
    };
    controller.actions.refresh(refresh);
    controller.actions.refresh(refresh);
    await vi.waitFor(() => expect(readCount).toBe(2));
    expect(
      messages.filter(
        (message) => message.type === "extension/editor-context" && message.status === "ready",
      ),
    ).toHaveLength(1);
    release?.();
    await vi.waitFor(() =>
      expect(
        messages.filter(
          (message) => message.type === "extension/editor-context" && message.status === "ready",
        ),
      ).toHaveLength(2),
    );
  });

  it("closes the owner when ready delivery is rejected", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    const lifetime = { onDidDispose: (_listener: () => void) => ({ dispose() {} }) };
    const entry = new EditorContextEntryController({
      readContext: async () => context,
      isEnabled: () => true,
      createId: (() => {
        let next = 0;
        return () => `id-${++next}`;
      })(),
    });
    const actions = entry.attachView(
      {
        postMessage(message) {
          messages.push(message);
          return Promise.resolve(false);
        },
      },
      lifetime,
    );
    await entry.ask("active-editor");
    await Promise.resolve();
    entry.notifyTransition(["document-changed"]);
    expect(messages.filter((message) => message.type === "extension/editor-context")).toHaveLength(
      1,
    );
    actions.dispose();
  });

  it("keeps collapsed selection snapshots and scopes selection transitions to selection owners", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    const controller = createController(messages, {
      readContext: async (scope) => ({
        ...context,
        source: {
          ...context.source,
          ...(scope === "selection"
            ? {
                range: {
                  start: { line: 2, character: 4 },
                  end: { line: 2, character: 4 },
                },
              }
            : {}),
        },
        text: scope === "selection" ? "" : context.text,
      }),
    });
    await controller.entry.ask("selection");
    expect(messages[0]).toMatchObject({
      status: "ready",
      scope: "selection",
      context: { text: "" },
    });
    controller.entry.notifyTransition(["selection-changed"]);
    expect(messages.filter((message) => message.type === "extension/editor-context")).toHaveLength(
      2,
    );
    expect(messages[1]).toMatchObject({ status: "stale", reason: "selection-changed" });

    const activeMessages: ExtensionToWebviewMessage[] = [];
    const activeController = createController(activeMessages);
    await activeController.entry.ask("active-editor");
    activeController.entry.notifyTransition(["selection-changed"]);
    expect(activeMessages).toHaveLength(1);
  });

  it("keeps source transition fingerprints opaque and bounded", () => {
    const fingerprint = createEditorContextSourceFingerprint({
      scheme: "file",
      authority: "",
      path: "/workspace/src/index.ts",
      documentVersion: 7,
      languageId: "typescript",
      range: {
        start: { line: 1, character: 2 },
        end: { line: 3, character: 4 },
      },
    });
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(fingerprint).not.toContain("/workspace/src/index.ts");
    expect(fingerprint).not.toContain("typescript");
  });

  it("closes the owner when synchronous event delivery throws", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    let posts = 0;
    const lifetime = { onDidDispose: (_listener: () => void) => ({ dispose() {} }) };
    const entry = new EditorContextEntryController({
      readContext: async () => context,
      isEnabled: () => true,
      createId: (() => {
        let next = 0;
        return () => `id-${++next}`;
      })(),
    });
    const actions = entry.attachView(
      {
        postMessage(message) {
          messages.push(message);
          posts += 1;
          if (posts > 1) throw new Error("closed channel");
          return Promise.resolve(true);
        },
      },
      lifetime,
    );
    await entry.ask("active-editor");
    entry.notifyTransition(["document-changed"]);
    entry.notifyTransition(["document-changed"]);
    expect(messages).toHaveLength(2);
    actions.dispose();
  });

  it("accepts only the exact owner tuple for Remove and Use stale", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    const controller = createController(messages);
    await controller.entry.ask("selection");
    const ready = messages[0] as Extract<
      ExtensionToWebviewMessage,
      { type: "extension/editor-context"; status: "ready" }
    >;

    const wrongContext = {
      protocolVersion: 1 as const,
      type: "webview/editor-context-remove" as const,
      requestId: "remove-wrong-context",
      viewGeneration: ready.viewGeneration,
      sessionGeneration: ready.sessionGeneration,
      cardGeneration: ready.cardGeneration,
      contextId: "not-the-owner",
    } satisfies EditorContextRemoveMessage;
    controller.actions.remove(wrongContext);

    const wrongGeneration = {
      ...wrongContext,
      requestId: "remove-wrong-generation",
      viewGeneration: ready.viewGeneration + 1,
    } satisfies EditorContextRemoveMessage;
    controller.actions.remove(wrongGeneration);

    const wrongStale = {
      protocolVersion: 1 as const,
      type: "webview/editor-context-use-stale" as const,
      requestId: "stale-wrong-context",
      viewGeneration: ready.viewGeneration,
      sessionGeneration: ready.sessionGeneration,
      cardGeneration: ready.cardGeneration,
      contextId: "not-the-owner",
    } satisfies EditorContextUseStaleMessage;
    controller.actions.useStale(wrongStale);

    expect(messages).toHaveLength(1);
    controller.actions.remove({
      ...wrongContext,
      requestId: "remove-owner",
      contextId: ready.contextId,
    });
    controller.entry.notifyTransition(["document-changed"]);
    expect(messages).toHaveLength(1);
  });

  it("reports an unavailable capture when the source cannot be read", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    const entry = new EditorContextEntryController({
      readContext: async () => {
        throw new Error("readContext should not run for an unavailable source");
      },
      isEnabled: () => true,
      getAvailability: () => "unsupported-document",
      createId: (() => {
        let next = 0;
        return () => `availability-${++next}`;
      })(),
    });
    const actions = entry.attachView(
      {
        postMessage(message) {
          messages.push(message);
          return Promise.resolve(true);
        },
      },
      { onDidDispose: () => ({ dispose() {} }) },
    );

    await entry.ask("selection");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      status: "unavailable",
      scope: "selection",
      code: "unsupported-document",
    });
    actions.dispose();
  });

  it("treats an explicit AbortError as cancellation without publishing unavailable", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    const entry = new EditorContextEntryController({
      readContext: async () => {
        const error = new Error("cancelled");
        error.name = "AbortError";
        throw error;
      },
      isEnabled: () => true,
      createId: (() => {
        let next = 0;
        return () => `abort-${++next}`;
      })(),
    });
    const actions = entry.attachView(
      {
        postMessage(message) {
          messages.push(message);
          return Promise.resolve(true);
        },
      },
      { onDidDispose: () => ({ dispose() {} }) },
    );

    await entry.ask("active-editor");
    expect(messages).toEqual([]);
    actions.dispose();
  });

  it("invalidates once on setting changes and makes disposal idempotent", async () => {
    const messages: ExtensionToWebviewMessage[] = [];
    const controller = createController(messages);
    await controller.entry.ask("active-editor");
    controller.entry.notifyTransition([]);
    controller.entry.onSettingChanged(false);
    controller.entry.onSettingChanged();
    expect(messages.at(-1)).toMatchObject({ status: "cleared", reason: "disabled" });

    controller.entry.dispose();
    controller.entry.dispose();
    await controller.entry.ask("selection");
    expect(messages).toHaveLength(2);
    controller.actions.dispose();
  });
});

function createController(
  messages: ExtensionToWebviewMessage[],
  overrides: {
    readonly readContext?: (
      scope: "selection" | "active-editor",
      signal: AbortSignal,
    ) => Promise<IdeTextContextDto>;
    readonly getAvailability?: () => Promise<"untrusted-workspace" | undefined>;
  } = {},
) {
  const lifetime = { onDidDispose: (_listener: () => void) => ({ dispose() {} }) };
  const channel: EditorContextMessageChannel = {
    postMessage(message) {
      messages.push(message);
      return Promise.resolve(true);
    },
  };
  const entry = new EditorContextEntryController({
    readContext: overrides.readContext ?? (async () => context),
    isEnabled: () => true,
    getAvailability: overrides.getAvailability,
    getSourceFingerprint: () => "source",
    createId: (() => {
      let next = 0;
      return () => `id-${++next}`;
    })(),
  });
  const actions = entry.attachView(channel, lifetime);
  return { entry, actions };
}
