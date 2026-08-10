import {
  type ExtensionToWebviewMessage,
  maxReasoningBlockCodePoints,
  maxReasoningBlocksPerRun,
  maxReasoningBlockUtf8Bytes,
  maxReasoningRunCodePoints,
  maxReasoningRunUtf8Bytes,
  maxTokenCount,
  measureReasoningText,
  type ReasoningRestoredMessage,
  type RunStatus,
  type SessionSummary,
  type TokenUsage,
  type ToolCall,
  type ToolErrorResult,
  type ToolStateMessage,
  type ToolStateSourceDto,
  type ToolSuccessResult,
  takeReasoningTextPrefix,
} from "@ctrl-zebra/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { WebviewHost } from "./vscode-api.js";

export interface DisplayReasoningBlock {
  readonly blockId: string;
  readonly content: string;
  readonly state: "streaming" | "complete" | "partial";
  readonly truncated: boolean;
  readonly expanded: boolean;
}

export interface DisplayMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly toolCalls: readonly DisplayToolCall[];
  readonly reasoningBlocks: readonly DisplayReasoningBlock[];
  readonly reasoningRunTruncated: boolean;
}

export type DisplayTokenUsage = TokenUsage;

export type DisplayToolCall =
  | {
      readonly call: ToolCall;
      readonly source?: ToolStateSourceDto;
      readonly status: "pending" | "running";
    }
  | {
      readonly call: ToolCall;
      readonly source?: ToolStateSourceDto;
      readonly status: "success";
      readonly result: ToolSuccessResult;
    }
  | {
      readonly call: ToolCall;
      readonly source?: ToolStateSourceDto;
      readonly status: "error";
      readonly result: ToolErrorResult;
    };

interface ChatState {
  readonly messages: readonly DisplayMessage[];
  readonly status: "idle" | "interrupted" | RunStatus;
  readonly activeRequestId?: string;
  readonly sessions: readonly SessionSummary[];
  readonly selectedSessionId?: string;
  readonly sessionSelectionId?: string;
  readonly sessionSwitchPending: boolean;
  readonly restoring: boolean;
  readonly sessionError?: string;
  readonly runError?: string;
  readonly reasoningAnnouncement: string;
  readonly sessionAnnouncement: string;
  readonly usage?: DisplayTokenUsage;
  submit(content: string): boolean;
  cancel(): void;
  newChat(): boolean;
  loadSessions(): void;
  selectSession(sessionId: string): void;
  restoreSelectedSession(): boolean;
  toggleReasoningBlock(messageId: string, blockId: string): void;
  announceReasoning(message: string): void;
  receive(message: ExtensionToWebviewMessage): void;
  dispose(): void;
}

type ScheduleFlush = (callback: () => void) => () => void;

export interface ChatStoreOptions {
  readonly host: WebviewHost;
  readonly createRequestId?: () => string;
  readonly scheduleFlush?: ScheduleFlush;
}

interface LiveReasoningBlock {
  readonly blockId: string;
  content: string;
  pendingParts: string[];
  codePoints: number;
  utf8Bytes: number;
  state: "streaming" | "complete" | "partial";
  truncated: boolean;
  expanded: boolean;
  discardText: boolean;
}

const defaultScheduleFlush: ScheduleFlush = (callback) => {
  let pending = true;
  const flush = () => {
    if (!pending) {
      return;
    }
    pending = false;
    cancelAnimationFrame(frameId);
    clearTimeout(timeoutId);
    callback();
  };
  const frameId = requestAnimationFrame(flush);
  const timeoutId = setTimeout(flush, 50);

  return () => {
    if (!pending) {
      return;
    }
    pending = false;
    cancelAnimationFrame(frameId);
    clearTimeout(timeoutId);
  };
};

export function createChatStore({
  host,
  createRequestId = () => crypto.randomUUID(),
  scheduleFlush = defaultScheduleFlush,
}: ChatStoreOptions): StoreApi<ChatState> {
  let pendingTextDelta = "";
  let cancelScheduledFlush: (() => void) | undefined;
  let listRequestId: string | undefined;
  let restoreRequestId: string | undefined;
  let restoreTargetSessionId: string | undefined;
  const mismatchedSessionRequests = new Set<string>();
  let stagedReasoningRestore: ReasoningRestoredMessage | undefined;
  let activeAssistantMessageId: string | undefined;
  let openReasoningBlockId: string | undefined;
  let reasoningRunCodePoints = 0;
  let reasoningRunUtf8Bytes = 0;
  let reasoningRunTruncated = false;
  let reasoningTextLimited = false;
  let reasoningBlockCountLimited = false;
  let reasoningDirty = false;
  let pendingReasoningAnnouncement: string | undefined;
  const liveReasoningBlocks = new Map<string, LiveReasoningBlock>();

  const cancelFlush = () => {
    cancelScheduledFlush?.();
    cancelScheduledFlush = undefined;
  };

  const resetLiveReasoning = () => {
    openReasoningBlockId = undefined;
    reasoningRunCodePoints = 0;
    reasoningRunUtf8Bytes = 0;
    reasoningRunTruncated = false;
    reasoningTextLimited = false;
    reasoningBlockCountLimited = false;
    reasoningDirty = false;
    pendingReasoningAnnouncement = undefined;
    liveReasoningBlocks.clear();
  };

  const store = createStore<ChatState>()((set, get) => {
    const reasoningSnapshots = (): readonly DisplayReasoningBlock[] =>
      [...liveReasoningBlocks.values()]
        .filter((block) => block.content.length > 0 || block.pendingParts.length > 0)
        .map((block) => {
          const pending = block.pendingParts.join("");
          block.pendingParts = [];
          block.content += pending;
          return {
            blockId: block.blockId,
            content: block.content,
            state: block.state,
            truncated: block.truncated,
            expanded: block.expanded,
          };
        });

    const applyPendingStreams = (terminalStatus?: RunStatus) => {
      cancelFlush();
      const textDelta = pendingTextDelta;
      pendingTextDelta = "";
      const updateReasoning = reasoningDirty;
      reasoningDirty = false;
      const blocks = updateReasoning ? reasoningSnapshots() : undefined;
      const announcement = pendingReasoningAnnouncement;
      pendingReasoningAnnouncement = undefined;
      const targetMessageId = activeAssistantMessageId;

      set((state) => ({
        messages:
          targetMessageId === undefined || (textDelta.length === 0 && blocks === undefined)
            ? state.messages
            : state.messages.map((message) =>
                message.id === targetMessageId
                  ? {
                      ...message,
                      content: message.content + textDelta,
                      reasoningBlocks: blocks ?? message.reasoningBlocks,
                      reasoningRunTruncated:
                        blocks === undefined
                          ? message.reasoningRunTruncated
                          : reasoningRunTruncated,
                    }
                  : message,
              ),
        status: terminalStatus ?? state.status,
        activeRequestId: terminalStatus === undefined ? state.activeRequestId : undefined,
        reasoningAnnouncement: announcement ?? state.reasoningAnnouncement,
      }));
    };

    const schedulePendingFlush = () => {
      cancelScheduledFlush ??= scheduleFlush(() => applyPendingStreams());
    };

    const queueTextDelta = (text: string) => {
      pendingTextDelta += text;
      schedulePendingFlush();
    };

    const queueReasoningDelta = (block: LiveReasoningBlock, text: string) => {
      if (block.discardText || reasoningTextLimited) {
        return;
      }

      const measurement = measureReasoningText(text);
      if (measurement === undefined) {
        return;
      }
      const blockCodePointsRemaining = maxReasoningBlockCodePoints - block.codePoints;
      const blockUtf8BytesRemaining = maxReasoningBlockUtf8Bytes - block.utf8Bytes;
      const runCodePointsRemaining = maxReasoningRunCodePoints - reasoningRunCodePoints;
      const runUtf8BytesRemaining = maxReasoningRunUtf8Bytes - reasoningRunUtf8Bytes;
      const prefix = takeReasoningTextPrefix(
        text,
        Math.min(blockCodePointsRemaining, runCodePointsRemaining),
        Math.min(blockUtf8BytesRemaining, runUtf8BytesRemaining),
      );
      if (prefix === undefined) {
        return;
      }

      const wasVisible = block.content.length > 0 || block.pendingParts.length > 0;
      if (prefix.text.length > 0) {
        block.pendingParts.push(prefix.text);
        block.codePoints += prefix.measurement.codePoints;
        block.utf8Bytes += prefix.measurement.utf8Bytes;
        reasoningRunCodePoints += prefix.measurement.codePoints;
        reasoningRunUtf8Bytes += prefix.measurement.utf8Bytes;
        reasoningDirty = true;
        if (!wasVisible) {
          pendingReasoningAnnouncement = "推理摘要已开始生成。";
        }
        schedulePendingFlush();
      }

      if (!prefix.complete) {
        block.truncated = true;
        block.discardText = true;
        reasoningDirty = true;
        if (
          runCodePointsRemaining <= blockCodePointsRemaining ||
          runUtf8BytesRemaining <= blockUtf8BytesRemaining
        ) {
          reasoningRunTruncated = true;
          reasoningTextLimited = true;
        }
        pendingReasoningAnnouncement = "推理摘要已截断。";
        schedulePendingFlush();
      }
    };

    const applyToolState = (message: ToolStateMessage) => {
      set((state) => ({
        messages: state.messages.map((displayMessage) => {
          if (displayMessage.id !== activeAssistantMessageId) {
            return displayMessage;
          }

          const toolCall = toDisplayToolCall(message);
          const existingIndex = displayMessage.toolCalls.findIndex(
            (existing) => existing.call.id === toolCall.call.id,
          );
          return {
            ...displayMessage,
            toolCalls:
              existingIndex < 0
                ? [...displayMessage.toolCalls, toolCall]
                : displayMessage.toolCalls.map((existing, index) =>
                    index === existingIndex ? toolCall : existing,
                  ),
          };
        }),
      }));
    };

    const applyTokenUsage = (usage: TokenUsage) => {
      set((state) => ({ usage: mergeTokenUsage(state.usage, usage) }));
    };

    const restoreMessages = (
      message: Extract<ExtensionToWebviewMessage, { type: "extension/session-restored" }>,
      staged: ReasoningRestoredMessage | undefined,
    ): readonly DisplayMessage[] => {
      const restoredBlocks: readonly DisplayReasoningBlock[] =
        staged?.sessionId === message.session.sessionId
          ? staged.blocks.map((block) => ({
              blockId: block.blockId,
              content: block.content,
              state: block.state,
              truncated: block.truncated,
              expanded: false,
            }))
          : [];
      const restoredMessages: DisplayMessage[] = message.session.messages.map((restored) => ({
        id: restored.messageId,
        role: restored.role,
        content: restored.content,
        toolCalls: [],
        reasoningBlocks: [],
        reasoningRunTruncated: false,
      }));
      if (restoredBlocks.length === 0) {
        return restoredMessages;
      }

      let assistantIndex = -1;
      for (let index = restoredMessages.length - 1; index >= 0; index -= 1) {
        if (restoredMessages[index]?.role === "assistant") {
          assistantIndex = index;
          break;
        }
      }
      if (assistantIndex >= 0) {
        restoredMessages[assistantIndex] = {
          ...restoredMessages[assistantIndex],
          reasoningBlocks: restoredBlocks,
          reasoningRunTruncated: staged?.runTruncated ?? false,
        };
      } else {
        restoredMessages.push({
          id: `${message.session.sessionId}:assistant-reasoning`,
          role: "assistant",
          content: "",
          toolCalls: [],
          reasoningBlocks: restoredBlocks,
          reasoningRunTruncated: staged?.runTruncated ?? false,
        });
      }
      return restoredMessages;
    };

    return {
      messages: [],
      status: "idle",
      usage: undefined,
      sessions: [],
      sessionSwitchPending: false,
      restoring: false,
      reasoningAnnouncement: "",
      sessionAnnouncement: "",
      submit(content) {
        const state = get();
        if (
          state.activeRequestId !== undefined ||
          restoreRequestId !== undefined ||
          state.sessionSwitchPending ||
          content.trim().length === 0
        ) {
          return false;
        }

        cancelFlush();
        pendingTextDelta = "";
        stagedReasoningRestore = undefined;
        resetLiveReasoning();
        const requestId = createRequestId();
        const sessionId = state.selectedSessionId;
        const assistantMessageId = `${requestId}:assistant`;
        activeAssistantMessageId = assistantMessageId;
        set((state) => ({
          messages: [
            ...state.messages,
            {
              id: `${requestId}:user`,
              role: "user",
              content,
              toolCalls: [],
              reasoningBlocks: [],
              reasoningRunTruncated: false,
            },
            {
              id: assistantMessageId,
              role: "assistant",
              content: "",
              toolCalls: [],
              reasoningBlocks: [],
              reasoningRunTruncated: false,
            },
          ],
          status: "preparing",
          activeRequestId: requestId,
          runError: undefined,
          usage: state.usage,
          reasoningAnnouncement: "",
          sessionAnnouncement:
            sessionId === undefined ? "Starting a new Session." : "Continuing the current Session.",
        }));
        host.submit(requestId, content, sessionId);
        return true;
      },
      cancel() {
        const { activeRequestId } = get();
        if (activeRequestId !== undefined) {
          host.cancel(activeRequestId);
        }
      },
      newChat() {
        const state = get();
        if (
          state.activeRequestId !== undefined ||
          restoreRequestId !== undefined ||
          state.sessionSwitchPending
        ) {
          return false;
        }

        cancelFlush();
        pendingTextDelta = "";
        listRequestId = undefined;
        restoreRequestId = undefined;
        restoreTargetSessionId = undefined;
        mismatchedSessionRequests.clear();
        stagedReasoningRestore = undefined;
        activeAssistantMessageId = undefined;
        resetLiveReasoning();
        const requestId = createRequestId();
        set({
          messages: [],
          status: "idle",
          activeRequestId: undefined,
          selectedSessionId: undefined,
          sessionSelectionId: undefined,
          sessionSwitchPending: false,
          restoring: false,
          sessionError: undefined,
          runError: undefined,
          usage: undefined,
          reasoningAnnouncement: "",
          sessionAnnouncement: "New chat ready.",
        });
        host.newChat?.(requestId);
        return true;
      },
      loadSessions() {
        if (get().activeRequestId !== undefined || restoreRequestId !== undefined) {
          return;
        }
        listRequestId = createRequestId();
        set({ sessionError: undefined });
        host.listSessions(listRequestId);
      },
      selectSession(sessionId) {
        if (get().activeRequestId !== undefined) {
          return;
        }
        stagedReasoningRestore = undefined;
        const sessionSelectionId = sessionId.length === 0 ? undefined : sessionId;
        set({
          sessionSelectionId,
          sessionSwitchPending: sessionSelectionId !== get().selectedSessionId,
          sessionError: undefined,
        });
      },
      restoreSelectedSession() {
        const { sessionSelectionId, activeRequestId } = get();
        if (
          sessionSelectionId === undefined ||
          activeRequestId !== undefined ||
          restoreRequestId !== undefined
        ) {
          return false;
        }
        stagedReasoningRestore = undefined;
        listRequestId = undefined;
        restoreRequestId = createRequestId();
        restoreTargetSessionId = sessionSelectionId;
        set({
          restoring: true,
          sessionError: undefined,
          runError: undefined,
          reasoningAnnouncement: "",
          sessionAnnouncement: "Restoring Session.",
        });
        host.restoreSession(restoreRequestId, sessionSelectionId);
        return true;
      },
      toggleReasoningBlock(messageId, blockId) {
        const live = liveReasoningBlocks.get(blockId);
        set((state) => ({
          messages: state.messages.map((message) => {
            if (message.id !== messageId) {
              return message;
            }
            return {
              ...message,
              reasoningBlocks: message.reasoningBlocks.map((block) => {
                if (block.blockId !== blockId) {
                  return block;
                }
                const expanded = !block.expanded;
                if (live !== undefined) {
                  live.expanded = expanded;
                }
                return { ...block, expanded };
              }),
            };
          }),
        }));
      },
      announceReasoning(message) {
        set({ reasoningAnnouncement: message });
      },
      receive(message) {
        if (
          message.type === "extension/reasoning-restored" &&
          message.requestId === restoreRequestId &&
          message.sessionId === restoreTargetSessionId
        ) {
          stagedReasoningRestore = message;
          return;
        }

        const stagedForCurrentMessage = stagedReasoningRestore;
        stagedReasoningRestore = undefined;

        if (message.type === "extension/session-started") {
          const state = get();
          if (message.requestId !== state.activeRequestId) {
            return;
          }
          if (
            state.selectedSessionId !== undefined &&
            state.selectedSessionId !== message.sessionId
          ) {
            mismatchedSessionRequests.add(message.requestId);
            cancelFlush();
            pendingTextDelta = "";
            activeAssistantMessageId = undefined;
            resetLiveReasoning();
            return;
          }
          set({
            selectedSessionId: message.sessionId,
            sessionSelectionId: message.sessionId,
            sessionSwitchPending: false,
            sessionError: undefined,
            sessionAnnouncement: "Current Session confirmed.",
          });
          return;
        }

        if (message.type === "extension/session-list" && message.requestId === listRequestId) {
          listRequestId = undefined;
          const currentSessionId = get().selectedSessionId;
          const sessionSelectionId =
            currentSessionId !== undefined &&
            message.sessions.some(({ sessionId }) => sessionId === currentSessionId)
              ? currentSessionId
              : message.sessions[0]?.sessionId;
          set({
            sessions: message.sessions,
            sessionSelectionId,
            sessionSwitchPending: sessionSelectionId !== currentSessionId,
            sessionError: undefined,
          });
          return;
        }

        if (
          message.type === "extension/session-restored" &&
          message.requestId === restoreRequestId
        ) {
          const targetSessionId = restoreTargetSessionId;
          restoreRequestId = undefined;
          restoreTargetSessionId = undefined;
          if (targetSessionId === undefined || message.session.sessionId !== targetSessionId) {
            set({
              restoring: false,
              sessionError: "The restored Session did not match the selected Session.",
              sessionAnnouncement: "Session restore failed.",
            });
            return;
          }
          cancelFlush();
          pendingTextDelta = "";
          activeAssistantMessageId = undefined;
          resetLiveReasoning();
          set({
            messages: restoreMessages(message, stagedForCurrentMessage),
            status:
              message.session.status === "completed" ||
              message.session.status === "cancelled" ||
              message.session.status === "failed" ||
              message.session.status === "interrupted"
                ? message.session.status
                : "idle",
            selectedSessionId: message.session.sessionId,
            sessionSelectionId: message.session.sessionId,
            sessionSwitchPending: false,
            restoring: false,
            runError: undefined,
            usage: message.session.usage,
            reasoningAnnouncement: "",
            sessionError: message.session.eventLogTailDamaged
              ? "Recovered through the last valid event."
              : undefined,
            sessionAnnouncement: "Session restored.",
          });
          return;
        }

        if (message.type === "extension/session-error" && message.requestId === listRequestId) {
          listRequestId = undefined;
          set({ sessionError: message.message, sessionAnnouncement: "Session list unavailable." });
          return;
        }

        if (message.type === "extension/session-error" && message.requestId === restoreRequestId) {
          restoreRequestId = undefined;
          restoreTargetSessionId = undefined;
          stagedReasoningRestore = undefined;
          set({
            restoring: false,
            sessionError: message.message,
            sessionAnnouncement: "Session restore failed.",
          });
          return;
        }

        const state = get();
        if (message.requestId !== state.activeRequestId) {
          return;
        }

        if (mismatchedSessionRequests.has(message.requestId)) {
          if (
            message.type === "extension/run-status" &&
            (message.status === "completed" ||
              message.status === "cancelled" ||
              message.status === "failed")
          ) {
            mismatchedSessionRequests.delete(message.requestId);
            applyPendingStreams(message.status);
            set({
              sessionError: "The response belonged to a different Session.",
              sessionAnnouncement: "Session ownership rejected.",
            });
          }
          return;
        }

        if (message.type === "extension/text-delta") {
          if (state.status === "preparing" || state.status === "streaming") {
            queueTextDelta(message.text);
          }
          return;
        }

        if (message.type === "extension/token-usage") {
          if (state.status === "preparing" || state.status === "streaming") {
            applyTokenUsage(message.usage);
          }
          return;
        }

        if (message.type === "extension/reasoning-start") {
          if (
            (state.status !== "preparing" && state.status !== "streaming") ||
            openReasoningBlockId !== undefined ||
            liveReasoningBlocks.has(message.blockId) ||
            reasoningBlockCountLimited
          ) {
            return;
          }
          if (liveReasoningBlocks.size >= maxReasoningBlocksPerRun) {
            reasoningBlockCountLimited = true;
            reasoningRunTruncated = true;
            reasoningDirty = true;
            pendingReasoningAnnouncement = "部分推理摘要因块数限制已省略。";
            schedulePendingFlush();
            return;
          }
          liveReasoningBlocks.set(message.blockId, {
            blockId: message.blockId,
            content: "",
            pendingParts: [],
            codePoints: 0,
            utf8Bytes: 0,
            state: "streaming",
            truncated: false,
            expanded: true,
            discardText: reasoningTextLimited,
          });
          openReasoningBlockId = message.blockId;
          return;
        }

        if (message.type === "extension/reasoning-delta") {
          if (message.blockId !== openReasoningBlockId) {
            return;
          }
          const block = liveReasoningBlocks.get(message.blockId);
          if (block !== undefined && block.state === "streaming") {
            queueReasoningDelta(block, message.text);
          }
          return;
        }

        if (message.type === "extension/reasoning-limit") {
          if (message.scope === "block") {
            const block = liveReasoningBlocks.get(message.blockId);
            if (block === undefined || block.state !== "streaming") {
              return;
            }
            block.truncated = true;
            block.discardText = true;
            reasoningDirty = true;
            pendingReasoningAnnouncement = "推理摘要已截断。";
          } else {
            reasoningRunTruncated = true;
            reasoningBlockCountLimited = true;
            reasoningTextLimited = message.reason !== "block-count";
            reasoningDirty = true;
            pendingReasoningAnnouncement = "部分推理摘要因运行限制已省略。";
          }
          schedulePendingFlush();
          return;
        }

        if (message.type === "extension/reasoning-end") {
          if (message.blockId !== openReasoningBlockId) {
            return;
          }
          const block = liveReasoningBlocks.get(message.blockId);
          if (block === undefined || block.state !== "streaming") {
            return;
          }
          block.state = "complete";
          block.truncated ||= message.truncated;
          reasoningDirty = true;
          openReasoningBlockId = undefined;
          if (block.content.length > 0 || block.pendingParts.length > 0) {
            pendingReasoningAnnouncement = block.truncated
              ? "推理摘要已截断并完成。"
              : "推理摘要生成完成。";
          }
          applyPendingStreams();
          return;
        }

        if (message.type === "extension/tool-state") {
          if (state.status === "preparing" || state.status === "streaming") {
            applyToolState(message);
          }
          return;
        }

        if (message.type === "extension/run-error") {
          set({ runError: message.message });
          return;
        }

        if (message.type === "extension/run-status") {
          if (
            message.status === "completed" ||
            message.status === "cancelled" ||
            message.status === "failed"
          ) {
            const openBlock =
              openReasoningBlockId === undefined
                ? undefined
                : liveReasoningBlocks.get(openReasoningBlockId);
            if (
              openBlock !== undefined &&
              (openBlock.content.length > 0 || openBlock.pendingParts.length > 0)
            ) {
              openBlock.state = "partial";
              reasoningDirty = true;
              pendingReasoningAnnouncement = "推理摘要已部分结束。";
            }
            openReasoningBlockId = undefined;
            applyPendingStreams(message.status);
          } else {
            set({ status: message.status });
          }
        }
      },
      dispose() {
        cancelFlush();
        pendingTextDelta = "";
        listRequestId = undefined;
        restoreRequestId = undefined;
        restoreTargetSessionId = undefined;
        mismatchedSessionRequests.clear();
        stagedReasoningRestore = undefined;
        activeAssistantMessageId = undefined;
        resetLiveReasoning();
      },
    };
  });

  return store;
}

function toDisplayToolCall(message: ToolStateMessage): DisplayToolCall {
  if (message.status === "pending" || message.status === "running") {
    return { call: message.call, source: message.source, status: message.status };
  }

  if (message.status === "success") {
    return {
      call: message.call,
      source: message.source,
      status: message.status,
      result: message.result,
    };
  }

  return { call: message.call, source: message.source, status: "error", result: message.result };
}

function mergeTokenUsage(current: TokenUsage | undefined, next: TokenUsage): DisplayTokenUsage {
  return {
    ...(mergeUsageValue(current?.inputTokens, next.inputTokens) === undefined
      ? {}
      : { inputTokens: mergeUsageValue(current?.inputTokens, next.inputTokens) }),
    ...(mergeUsageValue(current?.outputTokens, next.outputTokens) === undefined
      ? {}
      : { outputTokens: mergeUsageValue(current?.outputTokens, next.outputTokens) }),
    ...(mergeUsageValue(current?.totalTokens, next.totalTokens) === undefined
      ? {}
      : { totalTokens: mergeUsageValue(current?.totalTokens, next.totalTokens) }),
  };
}

function mergeUsageValue(
  current: number | undefined,
  next: number | undefined,
): number | undefined {
  if (next === undefined) {
    return current;
  }
  if (current === undefined) {
    return next;
  }
  return current > maxTokenCount - next ? maxTokenCount : current + next;
}
