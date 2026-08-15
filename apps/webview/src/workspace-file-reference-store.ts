import type {
  ExtensionToWebviewMessage,
  WorkspaceFileReference,
  WorkspaceFileSearchResult,
} from "@ctrl-zebra/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

import { strings } from "./strings.js";
import type { WebviewHost } from "./vscode-api.js";

export interface WorkspaceFileReferenceCard {
  readonly reference: WorkspaceFileReference;
  readonly staleAccepted: boolean;
}

export interface WorkspaceFileReferenceState {
  readonly cards: readonly WorkspaceFileReferenceCard[];
  readonly suggestions: readonly WorkspaceFileSearchResult[];
  readonly searchPending: boolean;
  readonly readPending: boolean;
  readonly announcement: string;
  search(query: string): void;
  clearSearch(): void;
  read(path: string): void;
  remove(referenceId: string): boolean;
  refresh(referenceId: string): boolean;
  useStale(referenceId: string): boolean;
  clearLocal(): void;
  clearForSessionSwitch(): void;
  canSend(): boolean;
  receive(message: ExtensionToWebviewMessage): void;
  dispose(): void;
}

export interface WorkspaceFileReferenceStoreOptions {
  readonly host: WebviewHost;
  readonly createRequestId?: () => string;
}

export function createWorkspaceFileReferenceStore({
  host,
  createRequestId = () => crypto.randomUUID(),
}: WorkspaceFileReferenceStoreOptions): StoreApi<WorkspaceFileReferenceState> {
  let disposed = false;
  let searchRequestId: string | undefined;
  const readRequestIds = new Set<string>();
  const closedReferenceIds = new Set<string>();

  return createStore<WorkspaceFileReferenceState>()((set, get) => ({
    cards: [],
    suggestions: [],
    searchPending: false,
    readPending: false,
    announcement: "",
    search(query) {
      if (disposed) return;
      const requestId = createRequestId();
      searchRequestId = requestId;
      set({ searchPending: true, announcement: "" });
      if (host.searchWorkspaceFiles === undefined) {
        set({ suggestions: [], searchPending: false });
        return;
      }
      host.searchWorkspaceFiles(requestId, query);
    },
    clearSearch() {
      searchRequestId = undefined;
      set({ suggestions: [], searchPending: false });
    },
    read(path) {
      if (disposed) return;
      const requestId = createRequestId();
      readRequestIds.add(requestId);
      set({ readPending: true, announcement: strings.workspaceFiles.reading });
      if (host.readWorkspaceFile === undefined) {
        readRequestIds.delete(requestId);
        set({
          readPending: false,
          announcement: strings.workspaceFiles.unavailable("unavailable"),
        });
        return;
      }
      host.readWorkspaceFile(requestId, path);
    },
    remove(referenceId) {
      if (disposed) return false;
      const card = get().cards.find((item) => item.reference.referenceId === referenceId);
      if (card === undefined) return false;
      closedReferenceIds.add(referenceId);
      set((state) => ({
        cards: state.cards.filter((item) => item.reference.referenceId !== referenceId),
        announcement: strings.workspaceFiles.removed,
      }));
      host.removeWorkspaceFile?.(createRequestId(), referenceId);
      return true;
    },
    refresh(referenceId) {
      if (disposed) return false;
      if (!get().cards.some((item) => item.reference.referenceId === referenceId)) return false;
      const requestId = createRequestId();
      readRequestIds.add(requestId);
      set({ readPending: true, announcement: strings.workspaceFiles.refreshing });
      if (host.refreshWorkspaceFile === undefined) {
        readRequestIds.delete(requestId);
        set({
          readPending: false,
          announcement: strings.workspaceFiles.unavailable("unavailable"),
        });
        return false;
      }
      host.refreshWorkspaceFile(requestId, referenceId);
      return true;
    },
    useStale(referenceId) {
      if (disposed) return false;
      const card = get().cards.find((item) => item.reference.referenceId === referenceId);
      if (card === undefined || !card.reference.context.source.stale || card.staleAccepted) {
        return false;
      }
      set((state) => ({
        cards: state.cards.map((item) =>
          item.reference.referenceId === referenceId ? { ...item, staleAccepted: true } : item,
        ),
        announcement: strings.workspaceFiles.staleAccepted,
      }));
      const sendUseStale = host.useStaleWorkspaceFile;
      sendUseStale?.(createRequestId(), referenceId);
      return true;
    },
    clearLocal() {
      if (disposed) return;
      searchRequestId = undefined;
      readRequestIds.clear();
      closedReferenceIds.clear();
      set({
        cards: [],
        suggestions: [],
        searchPending: false,
        readPending: false,
        announcement: "",
      });
    },
    clearForSessionSwitch() {
      if (disposed) return;
      searchRequestId = undefined;
      readRequestIds.clear();
      closedReferenceIds.clear();
      set({
        cards: [],
        suggestions: [],
        searchPending: false,
        readPending: false,
        announcement: strings.workspaceFiles.sessionCleared,
      });
    },
    canSend() {
      return (
        !get().searchPending &&
        !get().readPending &&
        get().cards.every((card) => !card.reference.context.source.stale || card.staleAccepted)
      );
    },
    receive(message) {
      if (disposed) return;
      if (message.type === "extension/workspace-file-search") {
        if (message.requestId !== searchRequestId) return;
        searchRequestId = undefined;
        if (message.status === "ready") {
          set({ suggestions: message.results, searchPending: false });
        } else {
          set({
            suggestions: [],
            searchPending: false,
            announcement: strings.workspaceFiles.unavailable(message.code),
          });
        }
        return;
      }
      if (message.type !== "extension/workspace-file-reference") return;
      if (
        message.status !== "error" &&
        message.status !== "removed" &&
        closedReferenceIds.has(message.reference.referenceId)
      ) {
        return;
      }
      const isPendingRead = readRequestIds.has(message.requestId);
      const hasExistingCard =
        message.status !== "error" &&
        message.status !== "removed" &&
        get().cards.some((item) => item.reference.referenceId === message.reference.referenceId);
      if (!isPendingRead && !hasExistingCard && message.status !== "removed") {
        return;
      }
      readRequestIds.delete(message.requestId);
      const readPending = readRequestIds.size > 0;
      if (message.status === "error") {
        set({ readPending, announcement: strings.workspaceFiles.unavailable(message.code) });
        return;
      }
      if (message.status === "removed") {
        closedReferenceIds.add(message.referenceId);
        set((state) => ({
          cards: state.cards.filter((item) => item.reference.referenceId !== message.referenceId),
          readPending,
        }));
        return;
      }

      const stale = message.status === "stale" || message.reference.context.source.stale;
      const previous = get().cards.find(
        (item) => item.reference.referenceId === message.reference.referenceId,
      );
      const card: WorkspaceFileReferenceCard = {
        reference: message.reference,
        staleAccepted: stale ? (previous?.staleAccepted ?? false) : false,
      };
      set((state) => ({
        cards: upsertCard(state.cards, card),
        readPending,
        announcement: stale ? strings.workspaceFiles.stale : strings.workspaceFiles.ready,
      }));
    },
    dispose() {
      disposed = true;
      searchRequestId = undefined;
      readRequestIds.clear();
    },
  }));
}

function upsertCard(
  cards: readonly WorkspaceFileReferenceCard[],
  next: WorkspaceFileReferenceCard,
): readonly WorkspaceFileReferenceCard[] {
  const path = next.reference.context.source.uri.path;
  const withoutDuplicate = cards.filter(
    (card) =>
      card.reference.referenceId !== next.reference.referenceId &&
      card.reference.context.source.uri.path !== path,
  );
  return [...withoutDuplicate, next];
}
