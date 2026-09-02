import type {
  EditorContextMessage,
  EditorContextRefreshMessage,
  EditorContextRemoveMessage,
  EditorContextUseStaleMessage,
  ExtensionToWebviewMessage,
  IdeTextContextDto,
} from "@ctrl-zebra/protocol";

export type EditorContextScope = "selection" | "active-editor";
export type EditorContextUnavailableCode =
  | "disabled"
  | "no-editor"
  | "no-selection"
  | "untrusted-workspace"
  | "unsupported-document"
  | "outside-workspace"
  | "unavailable";
export type EditorContextTransitionReason =
  | "editor-changed"
  | "selection-changed"
  | "document-changed";
export type EditorContextClearReason =
  | "disabled"
  | "trust-lost"
  | "workspace-changed"
  | "editor-unavailable";

export interface EditorContextMessageChannel {
  postMessage(message: ExtensionToWebviewMessage): PromiseLike<boolean>;
}

export interface EditorContextViewLifetime {
  onDidDispose(listener: () => void): { dispose(): void };
}

export interface EditorContextWebviewActions {
  refresh(message: EditorContextRefreshMessage): void;
  remove(message: EditorContextRemoveMessage): void;
  useStale(message: EditorContextUseStaleMessage): void;
  clearForNewChat(): void;
  clearForSessionSwitch(): void;
  dispose(): void;
}

export interface EditorContextEntryDependencies {
  readonly readContext: (
    scope: EditorContextScope,
    signal: AbortSignal,
  ) => Promise<IdeTextContextDto>;
  readonly isEnabled: () => boolean;
  readonly getAvailability?: (
    scope: EditorContextScope,
  ) => EditorContextUnavailableCode | undefined | Promise<EditorContextUnavailableCode | undefined>;
  readonly getSourceFingerprint?: (scope: EditorContextScope) => string | undefined;
  readonly createId?: () => string;
  readonly focusView?: () => PromiseLike<unknown>;
}

interface CaptureGate {
  readonly captureId: string;
  readonly scope: EditorContextScope;
  readonly viewGeneration: number;
  readonly sessionGeneration: number;
  readonly controller: AbortController;
  open: boolean;
  readonly sourceFingerprint?: string;
}

interface OwnerGate {
  readonly cardGeneration: number;
  readonly captureId: string;
  readonly contextId: string;
  readonly scope: EditorContextScope;
  context: IdeTextContextDto;
  staleLatched: boolean;
  staleWatermark?: string;
}

interface IntentRecord {
  readonly type: string;
  readonly payload: string;
}

interface EditorViewState {
  readonly channel: EditorContextMessageChannel;
  readonly lifetime: EditorContextViewLifetime;
  readonly viewGeneration: number;
  sessionGeneration: number;
  cardGeneration: number;
  eventSequence: number;
  capture?: CaptureGate;
  owner?: OwnerGate;
  intents: Map<string, IntentRecord>;
  disposed: boolean;
  overflowed: boolean;
}

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

/**
 * Host-owned explicit editor entry controller. It keeps VS Code objects out of
 * the Protocol boundary and closes both gates synchronously before every
 * invalidating transition.
 */
export class EditorContextEntryController {
  readonly #dependencies: EditorContextEntryDependencies;
  readonly #views = new Set<EditorViewState>();
  #nextViewGeneration = 0;
  #transitionToken = 0;
  #disposed = false;

  constructor(dependencies: EditorContextEntryDependencies) {
    this.#dependencies = dependencies;
  }

  attachView(
    channel: EditorContextMessageChannel,
    lifetime: EditorContextViewLifetime,
  ): EditorContextWebviewActions {
    if (this.#disposed) {
      throw new Error("Editor context entry controller has been disposed.");
    }
    const viewGeneration = this.#nextCounter("viewGeneration");
    if (viewGeneration === undefined) {
      throw new Error("Editor context view generation overflowed; activate a new extension.");
    }
    this.#nextViewGeneration = viewGeneration;
    const view: EditorViewState = {
      channel,
      lifetime,
      viewGeneration,
      sessionGeneration: 0,
      cardGeneration: 0,
      eventSequence: 0,
      intents: new Map(),
      disposed: false,
      overflowed: false,
    };
    this.#views.add(view);
    const disposal = lifetime.onDidDispose(() => this.#disposeView(view));
    return {
      refresh: (message) => this.#refresh(view, message),
      remove: (message) => this.#remove(view, message),
      useStale: (message) => this.#useStale(view, message),
      clearForNewChat: () => this.#replaceSession(view),
      clearForSessionSwitch: () => this.#replaceSession(view),
      dispose: () => {
        disposal.dispose();
        this.#disposeView(view);
      },
    };
  }

  async ask(scope: EditorContextScope): Promise<void> {
    if (this.#disposed) return;
    try {
      await this.#dependencies.focusView?.();
    } catch {
      return;
    }
    const view = this.#latestView();
    if (view === undefined) return;
    await this.#capture(view, scope);
  }

  notifyTransition(
    reasons: readonly EditorContextTransitionReason[],
    sourceFingerprint?: string,
  ): void {
    if (this.#disposed) return;
    const normalizedReasons = normalizeReasons(reasons);
    if (normalizedReasons.length === 0) return;
    for (const view of this.#views) {
      if (view.disposed) continue;
      if (
        view.capture !== undefined &&
        transitionAffectsScope(view.capture.scope, normalizedReasons)
      ) {
        this.#closeCapture(view);
      }
      const owner = view.owner;
      if (owner === undefined) continue;
      if (!transitionAffectsScope(owner.scope, normalizedReasons)) continue;
      const fingerprint =
        sourceFingerprint ?? this.#dependencies.getSourceFingerprint?.(owner.scope) ?? "";
      const watermark = `${normalizedReasons.join(",")}\u0000${fingerprint}`;
      if (owner.staleLatched || owner.staleWatermark === watermark) continue;
      owner.staleWatermark = watermark;
      owner.staleLatched = true;
      const staleContext = markContextStale(owner.context);
      owner.context = staleContext;
      this.#postTransition(view, {
        status: "stale",
        cardGeneration: owner.cardGeneration,
        captureId: owner.captureId,
        contextId: owner.contextId,
        scope: owner.scope,
        reason: normalizedReasons[0] ?? "editor-changed",
        context: staleContext,
      });
    }
  }

  notifyHostTransition(reason: EditorContextTransitionReason, scope: EditorContextScope): void {
    if (this.#disposed) return;
    this.#transitionToken += 1;
    const token = this.#transitionToken;
    void Promise.resolve(this.#dependencies.getAvailability?.(scope)).then(
      (availability) => {
        if (this.#disposed || token !== this.#transitionToken) return;
        if (availability === "untrusted-workspace") {
          this.invalidate("trust-lost");
        } else if (
          availability === "unsupported-document" ||
          availability === "outside-workspace" ||
          availability === "no-editor"
        ) {
          this.invalidate("editor-unavailable");
        } else {
          this.notifyTransition([reason]);
        }
      },
      () => {
        if (!this.#disposed && token === this.#transitionToken) {
          this.invalidate("editor-unavailable");
        }
      },
    );
  }

  invalidate(reason: EditorContextClearReason): void {
    if (this.#disposed) return;
    this.#transitionToken += 1;
    for (const view of this.#views) {
      if (view.disposed) continue;
      this.#closeCapture(view);
      const owner = view.owner;
      if (owner === undefined) continue;
      this.#postTransition(view, {
        status: "cleared",
        cardGeneration: owner.cardGeneration,
        contextId: owner.contextId,
        reason,
      });
      view.owner = undefined;
      this.#incrementCardGeneration(view);
    }
  }

  onSettingChanged(enabled = this.#dependencies.isEnabled()): void {
    if (!enabled) this.invalidate("disabled");
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const view of this.#views) this.#disposeView(view);
    this.#views.clear();
  }

  #latestView(): EditorViewState | undefined {
    let latest: EditorViewState | undefined;
    for (const view of this.#views) {
      if (!view.disposed && (latest === undefined || view.viewGeneration > latest.viewGeneration)) {
        latest = view;
      }
    }
    return latest;
  }

  async #capture(view: EditorViewState, scope: EditorContextScope): Promise<void> {
    if (view.disposed || view.overflowed) return;
    this.#closeCapture(view);
    const captureId = this.#newId();
    const controller = new AbortController();
    const gate: CaptureGate = {
      captureId,
      scope,
      viewGeneration: view.viewGeneration,
      sessionGeneration: view.sessionGeneration,
      controller,
      open: true,
      sourceFingerprint: this.#dependencies.getSourceFingerprint?.(scope),
    };
    view.capture = gate;
    try {
      const availability = !this.#dependencies.isEnabled()
        ? "disabled"
        : await this.#dependencies.getAvailability?.(scope);
      if (!this.#isCurrentCapture(view, gate)) return;
      if (availability !== undefined) {
        this.#postUnavailable(view, scope, availability);
        return;
      }
      const context = await this.#dependencies.readContext(scope, controller.signal);
      if (!this.#isCurrentCapture(view, gate) || context.source.stale) return;
      const currentFingerprint = this.#dependencies.getSourceFingerprint?.(scope);
      if (gate.sourceFingerprint !== currentFingerprint) {
        return;
      }
      const cardGeneration = this.#incrementCardGeneration(view);
      if (cardGeneration === undefined) return;
      const owner: OwnerGate = {
        cardGeneration,
        captureId,
        contextId: this.#newId(),
        scope,
        context,
        staleLatched: false,
      };
      const message = this.#postTransition(view, {
        status: "ready",
        cardGeneration,
        captureId,
        contextId: owner.contextId,
        scope,
        context,
      });
      if (message) view.owner = owner;
    } catch (error) {
      if (!this.#isCurrentCapture(view, gate) || isAbortError(error)) return;
      this.#postUnavailable(view, scope, "unavailable");
    } finally {
      if (view.capture === gate) view.capture = undefined;
    }
  }

  #isCurrentCapture(view: EditorViewState, gate: CaptureGate): boolean {
    return (
      !this.#disposed &&
      !view.disposed &&
      !view.overflowed &&
      gate.open &&
      view.capture === gate &&
      gate.viewGeneration === view.viewGeneration &&
      gate.sessionGeneration === view.sessionGeneration
    );
  }

  #closeCapture(view: EditorViewState): void {
    const gate = view.capture;
    if (gate === undefined) return;
    gate.open = false;
    view.capture = undefined;
    gate.controller.abort();
  }

  #postUnavailable(
    view: EditorViewState,
    scope: EditorContextScope,
    code: EditorContextUnavailableCode,
  ): void {
    this.#postTransition(view, { status: "unavailable", scope, code });
  }

  #postTransition(
    view: EditorViewState,
    payload:
      | Omit<
          Extract<EditorContextMessage, { status: "ready" }>,
          | "protocolVersion"
          | "type"
          | "requestId"
          | "viewGeneration"
          | "sessionGeneration"
          | "eventSequence"
        >
      | Omit<
          Extract<EditorContextMessage, { status: "stale" }>,
          | "protocolVersion"
          | "type"
          | "requestId"
          | "viewGeneration"
          | "sessionGeneration"
          | "eventSequence"
        >
      | Omit<
          Extract<EditorContextMessage, { status: "cleared" }>,
          | "protocolVersion"
          | "type"
          | "requestId"
          | "viewGeneration"
          | "sessionGeneration"
          | "eventSequence"
        >
      | Omit<
          Extract<EditorContextMessage, { status: "unavailable" }>,
          | "protocolVersion"
          | "type"
          | "requestId"
          | "viewGeneration"
          | "sessionGeneration"
          | "eventSequence"
        >,
  ): EditorContextMessage | undefined {
    const eventSequence = this.#nextEventSequence(view);
    if (eventSequence === undefined) return undefined;
    const requestId = this.#newId();
    const message = {
      protocolVersion: 1 as const,
      type: "extension/editor-context" as const,
      requestId,
      viewGeneration: view.viewGeneration,
      sessionGeneration: view.sessionGeneration,
      eventSequence,
      ...payload,
    } as EditorContextMessage;
    if (view.disposed || this.#disposed) return undefined;
    try {
      const delivery = view.channel.postMessage(message);
      void delivery.then(
        (delivered) => {
          if (!delivered) this.#closeOwnerForDeliveryFailure(view, message);
        },
        () => this.#closeOwnerForDeliveryFailure(view, message),
      );
    } catch {
      this.#closeOwnerForDeliveryFailure(view, message);
      return undefined;
    }
    return message;
  }

  #closeOwnerForDeliveryFailure(view: EditorViewState, message: EditorContextMessage): void {
    const contextId = "contextId" in message ? message.contextId : undefined;
    if (contextId !== undefined && view.owner?.contextId === contextId) {
      view.owner = undefined;
    }
  }

  #refresh(view: EditorViewState, message: EditorContextRefreshMessage): void {
    if (!this.#acceptIntent(view, message)) return;
    const owner = view.owner;
    if (owner === undefined || owner.scope !== message.scope) return;
    this.#closeCapture(view);
    void this.#capture(view, message.scope);
  }

  #remove(view: EditorViewState, message: EditorContextRemoveMessage): void {
    if (!this.#acceptIntent(view, message)) return;
    const owner = view.owner;
    if (!this.#matchesOwner(view, message) || owner === undefined) return;
    this.#closeCapture(view);
    view.owner = undefined;
    this.#incrementCardGeneration(view);
  }

  #useStale(view: EditorViewState, message: EditorContextUseStaleMessage): void {
    if (!this.#acceptIntent(view, message)) return;
    if (!this.#matchesOwner(view, message)) return;
  }

  #acceptIntent(
    view: EditorViewState,
    message:
      | EditorContextRefreshMessage
      | EditorContextRemoveMessage
      | EditorContextUseStaleMessage,
  ): boolean {
    if (view.disposed || this.#disposed || view.overflowed) return false;
    const payload = JSON.stringify(message);
    const previous = view.intents.get(message.requestId);
    if (previous !== undefined) return false;
    view.intents.set(message.requestId, { type: message.type, payload });
    return (
      message.viewGeneration === view.viewGeneration &&
      message.sessionGeneration === view.sessionGeneration
    );
  }

  #matchesOwner(
    view: EditorViewState,
    message: Pick<
      EditorContextRemoveMessage,
      "viewGeneration" | "sessionGeneration" | "cardGeneration" | "contextId"
    >,
  ): boolean {
    const owner = view.owner;
    return (
      owner !== undefined &&
      owner.cardGeneration === message.cardGeneration &&
      owner.contextId === message.contextId &&
      message.viewGeneration === view.viewGeneration &&
      message.sessionGeneration === view.sessionGeneration
    );
  }

  #replaceSession(view: EditorViewState): void {
    if (view.disposed || view.overflowed) return;
    this.#closeCapture(view);
    view.owner = undefined;
    const next = this.#nextCounter("sessionGeneration", view.sessionGeneration);
    if (next === undefined) {
      view.overflowed = true;
      return;
    }
    view.sessionGeneration = next;
    view.cardGeneration = 0;
    view.intents.clear();
  }

  #disposeView(view: EditorViewState): void {
    if (view.disposed) return;
    view.disposed = true;
    this.#closeCapture(view);
    view.owner = undefined;
    this.#views.delete(view);
  }

  #incrementCardGeneration(view: EditorViewState): number | undefined {
    const next = this.#nextCounter("cardGeneration", view.cardGeneration);
    if (next === undefined) {
      view.overflowed = true;
      this.#closeCapture(view);
      view.owner = undefined;
      return undefined;
    }
    view.cardGeneration = next;
    return next;
  }

  #nextEventSequence(view: EditorViewState): number | undefined {
    const next = this.#nextCounter("eventSequence", view.eventSequence);
    if (next === undefined) {
      view.overflowed = true;
      this.#closeCapture(view);
      view.owner = undefined;
      return undefined;
    }
    view.eventSequence = next;
    return next;
  }

  #nextCounter(_name: string, current = this.#nextViewGeneration): number | undefined {
    if (!Number.isSafeInteger(current) || current < 0 || current >= MAX_SAFE_INTEGER)
      return undefined;
    return current + 1;
  }

  #newId(): string {
    return this.#dependencies.createId?.() ?? crypto.randomUUID();
  }
}

function normalizeReasons(
  reasons: readonly EditorContextTransitionReason[],
): readonly EditorContextTransitionReason[] {
  const order: readonly EditorContextTransitionReason[] = [
    "editor-changed",
    "selection-changed",
    "document-changed",
  ];
  const set = new Set(reasons);
  return order.filter((reason) => set.has(reason));
}

function transitionAffectsScope(
  scope: EditorContextScope,
  reasons: readonly EditorContextTransitionReason[],
): boolean {
  return scope === "selection" ? true : reasons.some((reason) => reason !== "selection-changed");
}

function markContextStale(context: IdeTextContextDto): IdeTextContextDto {
  return {
    ...context,
    source: { ...context.source, stale: true },
  };
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
