import type { ExtensionToWebviewMessage, IdeTextContextDto } from "@ctrl-zebra/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

import { canonicalJson } from "./canonical-json.js";
import { strings } from "./strings.js";
import type { WebviewHost } from "./vscode-api.js";

export interface EditorContextCard {
  readonly status: "ready" | "stale";
  readonly scope: "selection" | "active-editor";
  readonly cardGeneration: number;
  readonly contextId: string;
  readonly captureId: string;
  readonly context: IdeTextContextDto;
  readonly staleAccepted: boolean;
}

export interface EditorContextState {
  readonly card?: EditorContextCard;
  readonly draft: string;
  readonly capturePending: boolean;
  readonly announcement: string;
  readonly viewGeneration?: number;
  readonly sessionGeneration?: number;
  readonly eventSequence: number;
  setDraft(value: string): void;
  refresh(): boolean;
  remove(): boolean;
  useStale(): boolean;
  clearLocal(): void;
  clearForSessionSwitch(): void;
  canSend(): boolean;
  receive(message: ExtensionToWebviewMessage): void;
  dispose(): void;
}

export interface EditorContextStoreOptions {
  readonly host: WebviewHost;
  readonly createRequestId?: () => string;
}

export function createEditorContextStore({
  host,
  createRequestId = () => crypto.randomUUID(),
}: EditorContextStoreOptions): StoreApi<EditorContextState> {
  let disposed = false;
  let ownerViewGeneration: number | undefined;
  let ownerSessionGeneration: number | undefined;
  let minimumSessionGeneration: number | undefined;
  let latestEventSequence = 0;
  const canonicalEvents = new Map<number, string>();
  let generatedDraft: string | undefined;
  let refreshRequestId: string | undefined;
  const intentIds = new Set<string>();
  let deliveryClosed = false;
  let closedCardGeneration: number | undefined;

  const clearCard = (
    preserveUserDraft: boolean,
    set: StoreApi<EditorContextState>["setState"],
    get: StoreApi<EditorContextState>["getState"],
  ): void => {
    const currentDraft = get().draft;
    const nextDraft =
      preserveUserDraft && generatedDraft !== undefined && currentDraft !== generatedDraft
        ? currentDraft
        : "";
    generatedDraft = undefined;
    set({ card: undefined, draft: nextDraft, capturePending: false });
  };

  const ownerMatches = (
    message: {
      readonly viewGeneration: number;
      readonly sessionGeneration: number;
      readonly cardGeneration: number;
      readonly contextId: string;
    },
    card: EditorContextCard | undefined,
  ): boolean =>
    card !== undefined &&
    message.viewGeneration === ownerViewGeneration &&
    message.sessionGeneration === ownerSessionGeneration &&
    message.cardGeneration === card.cardGeneration &&
    message.contextId === card.contextId;

  return createStore<EditorContextState>()((set, get) => ({
    draft: "",
    capturePending: false,
    announcement: "",
    eventSequence: 0,
    setDraft(value) {
      set({ draft: value });
    },
    refresh() {
      const card = get().card;
      if (
        disposed ||
        card === undefined ||
        ownerViewGeneration === undefined ||
        ownerSessionGeneration === undefined
      ) {
        return false;
      }
      const requestId = createRequestId();
      if (intentIds.has(requestId)) return false;
      intentIds.add(requestId);
      refreshRequestId = requestId;
      set({ capturePending: true, announcement: strings.editorContext.refreshing });
      host.refreshEditorContext?.(
        requestId,
        ownerViewGeneration,
        ownerSessionGeneration,
        card.cardGeneration,
        card.contextId,
        card.scope,
      );
      return true;
    },
    remove() {
      const card = get().card;
      if (
        disposed ||
        card === undefined ||
        ownerViewGeneration === undefined ||
        ownerSessionGeneration === undefined
      ) {
        return false;
      }
      const requestId = createRequestId();
      if (intentIds.has(requestId)) return false;
      intentIds.add(requestId);
      const tuple = {
        viewGeneration: ownerViewGeneration,
        sessionGeneration: ownerSessionGeneration,
        cardGeneration: card.cardGeneration,
        contextId: card.contextId,
      };
      clearCard(true, set, get);
      deliveryClosed = true;
      closedCardGeneration = card.cardGeneration;
      set({ announcement: strings.editorContext.removed });
      host.removeEditorContext?.(
        requestId,
        tuple.viewGeneration,
        tuple.sessionGeneration,
        tuple.cardGeneration,
        tuple.contextId,
      );
      return true;
    },
    useStale() {
      const card = get().card;
      if (
        disposed ||
        card?.status !== "stale" ||
        card.staleAccepted ||
        ownerViewGeneration === undefined ||
        ownerSessionGeneration === undefined
      ) {
        return false;
      }
      const requestId = createRequestId();
      if (intentIds.has(requestId)) return false;
      intentIds.add(requestId);
      set({
        card: { ...card, staleAccepted: true },
        announcement: strings.editorContext.staleAccepted,
      });
      const sendStaleIntent = host.useStaleEditorContext;
      if (sendStaleIntent !== undefined) {
        sendStaleIntent(
          requestId,
          ownerViewGeneration,
          ownerSessionGeneration,
          card.cardGeneration,
          card.contextId,
        );
      }
      return true;
    },
    clearLocal() {
      if (disposed) return;
      closedCardGeneration = get().card?.cardGeneration;
      clearCard(true, set, get);
      deliveryClosed = true;
      refreshRequestId = undefined;
      set({ announcement: "" });
    },
    clearForSessionSwitch() {
      if (disposed) return;
      const next = (ownerSessionGeneration ?? 0) + 1;
      minimumSessionGeneration = next;
      closedCardGeneration = get().card?.cardGeneration;
      clearCard(true, set, get);
      deliveryClosed = true;
      refreshRequestId = undefined;
      set({ announcement: strings.editorContext.sessionCleared });
    },
    canSend() {
      const card = get().card;
      return (
        !get().capturePending &&
        (card === undefined || card.status !== "stale" || card.staleAccepted)
      );
    },
    receive(message) {
      if (disposed || message.type !== "extension/editor-context") return;
      if (
        (ownerViewGeneration !== undefined && message.viewGeneration > ownerViewGeneration) ||
        (ownerViewGeneration === message.viewGeneration &&
          ownerSessionGeneration !== undefined &&
          message.sessionGeneration > ownerSessionGeneration)
      ) {
        clearCard(true, set, get);
      }
      if (!acceptEvent(message)) return;
      if (message.status === "unavailable") {
        if (get().card !== undefined) {
          set({ capturePending: false });
        } else {
          set({
            capturePending: false,
            announcement: strings.editorContext.unavailable(message.code),
          });
        }
        if (message.requestId === refreshRequestId) refreshRequestId = undefined;
        return;
      }
      if (message.status === "ready") {
        const prefix = formatEditorContextDraft(message.scope, message.context);
        generatedDraft = `${prefix}${message.context.text}`;
        set({
          card: {
            status: "ready",
            scope: message.scope,
            cardGeneration: message.cardGeneration,
            contextId: message.contextId,
            captureId: message.captureId,
            context: message.context,
            staleAccepted: false,
          },
          draft: generatedDraft,
          capturePending: false,
          announcement: strings.editorContext.ready,
        });
        refreshRequestId = undefined;
        return;
      }
      if (message.status === "stale") {
        const card = get().card;
        if (card === undefined || !ownerMatches(message, card)) return;
        set({
          card: { ...card, status: "stale", context: message.context, staleAccepted: false },
          capturePending: false,
          announcement: strings.editorContext.stale,
        });
        return;
      }
      const card = get().card;
      if (!ownerMatches(message, card)) return;
      clearCard(true, set, get);
      deliveryClosed = true;
      closedCardGeneration = message.cardGeneration;
      set({ announcement: strings.editorContext.cleared(message.reason) });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearCard(true, set, get);
      deliveryClosed = true;
      closedCardGeneration = undefined;
      canonicalEvents.clear();
      intentIds.clear();
      refreshRequestId = undefined;
    },
  }));

  function acceptEvent(
    message: Extract<ExtensionToWebviewMessage, { type: "extension/editor-context" }>,
  ): boolean {
    if (ownerViewGeneration !== undefined && message.viewGeneration < ownerViewGeneration)
      return false;
    if (
      minimumSessionGeneration !== undefined &&
      message.sessionGeneration < minimumSessionGeneration
    )
      return false;
    if (ownerViewGeneration === undefined || message.viewGeneration > ownerViewGeneration) {
      ownerViewGeneration = message.viewGeneration;
      ownerSessionGeneration = message.sessionGeneration;
      deliveryClosed = false;
      closedCardGeneration = undefined;
      minimumSessionGeneration = undefined;
      latestEventSequence = 0;
      canonicalEvents.clear();
    } else if (
      ownerSessionGeneration === undefined ||
      message.sessionGeneration > ownerSessionGeneration
    ) {
      ownerSessionGeneration = message.sessionGeneration;
      deliveryClosed = false;
      closedCardGeneration = undefined;
      latestEventSequence = 0;
      canonicalEvents.clear();
      generatedDraft = undefined;
    } else if (message.sessionGeneration < ownerSessionGeneration) {
      return false;
    }
    if (
      deliveryClosed &&
      (message.status !== "ready" ||
        (closedCardGeneration !== undefined && message.cardGeneration <= closedCardGeneration))
    ) {
      return false;
    }
    if (message.status === "ready") {
      deliveryClosed = false;
      closedCardGeneration = undefined;
    }
    const canonical = canonicalJson(message);
    const previous = canonicalEvents.get(message.eventSequence);
    if (previous !== undefined) return false;
    if (message.eventSequence < latestEventSequence) return false;
    canonicalEvents.set(message.eventSequence, canonical);
    latestEventSequence = message.eventSequence;
    return true;
  }
}

export function formatEditorContextDraft(
  scope: "selection" | "active-editor",
  context: IdeTextContextDto,
): string {
  const source = context.source;
  const range =
    source.range === undefined
      ? ""
      : ` (${source.range.start.line + 1}:${source.range.start.character + 1}-${source.range.end.line + 1}:${source.range.end.character + 1})`;
  const language = source.languageId === undefined ? "" : `\nLanguage: ${source.languageId}`;
  const truncated = source.truncated ? "yes" : "no";
  return `${strings.editorContext.draftPrefix}\nScope: ${scope}\nSource: ${source.uri.path}${range}${language}\nSource truncated: ${truncated}\n`;
}
