import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import styles from "./app.module.css";
import { ApprovalCard } from "./approval-card.js";
import { createApprovalStore } from "./approval-store.js";
import { createChatStore, type DisplayMessage } from "./chat-store.js";
import { CheckpointPanel } from "./checkpoint-panel.js";
import { createCheckpointStore } from "./checkpoint-store.js";
import { MarkdownMessage } from "./markdown-message.js";
import { McpPanel } from "./mcp-panel.js";
import { createMcpStore } from "./mcp-store.js";
import { OnboardingCard } from "./onboarding-card.js";
import { createOnboardingStore } from "./onboarding-store.js";
import { ReasoningSummary } from "./reasoning-summary.js";
import { strings } from "./strings.js";
import { TokenUsageSummary } from "./token-usage-summary.js";
import { ToolCallCard } from "./tool-call-card.js";
import { Button } from "./ui/button.js";
import { getWebviewHost, type WebviewHost } from "./vscode-api.js";

interface AppProps {
  readonly host?: WebviewHost;
  readonly createRequestId?: () => string;
}

function messageContent(message: DisplayMessage, status: string): string {
  if (message.content.length > 0 || message.role === "user") {
    return message.content;
  }

  if (status === "cancelled") {
    return strings.app.messageFallback.cancelled;
  }

  if (status === "truncated") {
    return strings.app.messageFallback.truncated;
  }

  if (status === "failed") {
    return strings.app.messageFallback.failed;
  }

  return strings.app.messageFallback.waiting;
}

export function App({ host: providedHost, createRequestId }: AppProps) {
  const [host] = useState(() => providedHost ?? getWebviewHost());
  const [store] = useState(() => createChatStore({ host, createRequestId }));
  const [approvalStore] = useState(() => createApprovalStore(host));
  const [checkpointStore] = useState(() =>
    createCheckpointStore(host, createRequestId ?? (() => crypto.randomUUID())),
  );
  const [mcpStore] = useState(() =>
    createMcpStore(host, createRequestId ?? (() => crypto.randomUUID())),
  );
  const [onboardingStore] = useState(() =>
    createOnboardingStore(host, createRequestId ?? (() => crypto.randomUUID())),
  );
  const [draft, setDraft] = useState("");
  const [showSessionsDrawer, setShowSessionsDrawer] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const mainRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suppressNextAutoFollow = useRef(false);

  const messages = useStore(store, (state) => state.messages);
  const status = useStore(store, (state) => state.status);
  const activeRequestId = useStore(store, (state) => state.activeRequestId);
  const sessions = useStore(store, (state) => state.sessions);
  const selectedSessionId = useStore(store, (state) => state.selectedSessionId);
  const sessionSelectionId = useStore(store, (state) => state.sessionSelectionId);
  const sessionSwitchPending = useStore(store, (state) => state.sessionSwitchPending);
  const restoring = useStore(store, (state) => state.restoring);
  const sessionError = useStore(store, (state) => state.sessionError);
  const runError = useStore(store, (state) => state.runError);
  const reasoningAnnouncement = useStore(store, (state) => state.reasoningAnnouncement);
  const sessionAnnouncement = useStore(store, (state) => state.sessionAnnouncement);
  const usage = useStore(store, (state) => state.usage);
  const approval = useStore(approvalStore, (state) => state.current);
  const pendingDecision = useStore(approvalStore, (state) => state.pendingDecision);
  const providerStatus = useStore(onboardingStore, (state) => state.status);
  const providerPendingAction = useStore(onboardingStore, (state) => state.pendingAction);
  const providerActionOutcome = useStore(onboardingStore, (state) => state.actionOutcome);
  const providerAnnouncement = useStore(onboardingStore, (state) => state.announcement);

  useEffect(() => {
    const unsubscribe = host.subscribe((message) => {
      store.getState().receive(message);
      approvalStore.getState().receive(message);
      checkpointStore.getState().receive(message);
      mcpStore.getState().receive(message);
      onboardingStore.getState().receive(message);
    });
    host.ping?.(createRequestId?.() ?? crypto.randomUUID());
    onboardingStore.getState().refresh();
    return () => {
      unsubscribe();
      store.getState().dispose();
      onboardingStore.getState().dispose();
    };
  }, [approvalStore, checkpointStore, createRequestId, host, mcpStore, onboardingStore, store]);

  // Scroll to bottom when new messages arrive unless user scrolled up
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on message updates
  useEffect(() => {
    if (suppressNextAutoFollow.current) {
      suppressNextAutoFollow.current = false;
      return;
    }
    if (!userScrolledUp && mainRef.current) {
      mainRef.current.scrollTop = mainRef.current.scrollHeight;
    }
  }, [messages, userScrolledUp]);

  const handleScroll = () => {
    if (!mainRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = mainRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setUserScrolledUp(!isAtBottom);
  };

  const scrollToBottom = () => {
    if (mainRef.current) {
      mainRef.current.scrollTop = mainRef.current.scrollHeight;
      setUserScrolledUp(false);
    }
  };

  const toggleReasoningBlock = (messageId: string, blockId: string) => {
    suppressNextAutoFollow.current = true;
    store.getState().toggleReasoningBlock(messageId, blockId);
  };

  const handleNewChat = () => {
    if (store.getState().newChat()) {
      setDraft("");
      setUserScrolledUp(false);
      mcpStore.getState().clearDraft();
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (store.getState().submit(draft)) {
      setDraft("");
      setUserScrolledUp(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !isComposing) {
      event.preventDefault();
      if (draft.trim().length > 0 && activeRequestId === undefined) {
        if (store.getState().submit(draft)) {
          setDraft("");
          setUserScrolledUp(false);
        }
      }
    }
  };

  const hasInlineApproval =
    approval !== undefined &&
    messages.some((m) => m.toolCalls.some((tc) => tc.call.id === approval.approval.scope.call.id));
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <div className={styles.mark} aria-hidden="true">
            CZ
          </div>
          <div>
            <h1 className={styles.title} id="agent-view-title">
              {strings.app.title}
            </h1>
            <p className={styles.description}>{strings.app.description}</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span
            className={styles.currentSession}
            aria-live="polite"
            title={selectedSessionId ?? strings.app.newChat}
          >
            {strings.app.currentSession(selectedSessionId)}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleNewChat}
            disabled={activeRequestId !== undefined || restoring || sessionSwitchPending}
            aria-describedby="session-action-hint"
          >
            {strings.app.newChat}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSessionsDrawer((prev) => !prev)}
            aria-expanded={showSessionsDrawer}
          >
            {showSessionsDrawer ? strings.app.hideSessions : strings.app.sessions}
          </Button>
        </div>
      </header>

      <p id="session-action-hint" className={styles.srOnly}>
        {activeRequestId !== undefined
          ? strings.app.sessionActionHint.running
          : restoring
            ? strings.app.sessionActionHint.restoring
            : sessionSwitchPending
              ? strings.app.sessionActionHint.switching
              : strings.app.sessionActionHint.ready}
      </p>

      {showSessionsDrawer ? (
        <section className={styles.secondaryDrawer} aria-label={strings.app.sessionDrawerLabel}>
          <section className={styles.sessions} aria-labelledby="saved-sessions-title">
            <h2 id="saved-sessions-title">{strings.app.savedSessionsHeading}</h2>
            <div className={styles.sessionControls}>
              <select
                aria-label={strings.app.savedSessionLabel}
                value={sessionSelectionId ?? ""}
                onChange={(event) => store.getState().selectSession(event.target.value)}
                disabled={sessions.length === 0 || activeRequestId !== undefined || restoring}
              >
                {sessions.length === 0 ? (
                  <option value="">{strings.app.noSavedSessions}</option>
                ) : null}
                {sessions.map((session) => (
                  <option value={session.sessionId} key={session.sessionId}>
                    {new Date(session.createdAt).toLocaleString()} —{" "}
                    {strings.app.sessionStatus[session.status]}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => store.getState().loadSessions()}
                disabled={activeRequestId !== undefined || restoring}
              >
                {strings.app.refresh}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => store.getState().restoreSelectedSession()}
                disabled={
                  sessionSelectionId === undefined || activeRequestId !== undefined || restoring
                }
              >
                {strings.app.restore}
              </Button>
            </div>
            {sessionError === undefined ? null : (
              <p className={styles.sessionError}>{sessionError}</p>
            )}
            {restoring ? (
              <p className={styles.sessionStatus}>{strings.app.restoringSession}</p>
            ) : null}
          </section>
          <CheckpointPanel store={checkpointStore} />
        </section>
      ) : null}

      <McpPanel store={mcpStore} />

      <main
        ref={mainRef}
        onScroll={handleScroll}
        className={styles.transcriptSection}
        aria-label={strings.app.conversationLabel}
      >
        <ol className={styles.transcript}>
          {messages.length === 0 ? (
            <li className={styles.empty}>
              <OnboardingCard
                status={providerStatus}
                pendingAction={providerPendingAction}
                actionOutcome={providerActionOutcome}
                announcement={providerAnnouncement}
                onAction={(action) => onboardingStore.getState().runAction(action)}
                onSelectPrompt={(prompt) => setDraft(prompt)}
              />
              <p className={styles.emptyText}>{strings.app.noMessages}</p>
            </li>
          ) : (
            messages.map((message) => (
              <li
                className={styles.message}
                data-role={message.role}
                key={message.id}
                aria-label={
                  message.role === "user"
                    ? strings.app.userMessageLabel
                    : strings.app.assistantMessageLabel
                }
              >
                <ReasoningSummary
                  blocks={message.reasoningBlocks}
                  runTruncated={message.reasoningRunTruncated}
                  onToggle={(blockId) => toggleReasoningBlock(message.id, blockId)}
                  onAnnounce={(announcement) => store.getState().announceReasoning(announcement)}
                />
                {message.toolCalls.map((toolCall) => (
                  <ToolCallCard
                    key={toolCall.call.id}
                    toolCall={toolCall}
                    runStatus={status}
                    approval={
                      approval?.approval.scope.call.id === toolCall.call.id ? approval : undefined
                    }
                    pendingDecision={
                      approval?.approval.scope.call.id === toolCall.call.id
                        ? pendingDecision
                        : undefined
                    }
                    onTerminate={() => store.getState().cancel()}
                    onViewDiff={() => approvalStore.getState().showDiff()}
                    onApprove={() => approvalStore.getState().decide("approved")}
                    onReject={() => approvalStore.getState().decide("denied")}
                  />
                ))}
                <MarkdownMessage content={messageContent(message, status)} />
              </li>
            ))
          )}
        </ol>

        {userScrolledUp ? (
          <button
            type="button"
            className={styles.jumpBottomButton}
            onClick={scrollToBottom}
            aria-label={strings.app.scrollToNewest}
          >
            {strings.app.jumpToBottom}
          </button>
        ) : null}

        {approval === undefined || hasInlineApproval ? null : (
          <ApprovalCard
            item={approval}
            pendingDecision={pendingDecision}
            onViewDiff={() => approvalStore.getState().showDiff()}
            onApprove={() => approvalStore.getState().decide("approved")}
            onReject={() => approvalStore.getState().decide("denied")}
          />
        )}
      </main>

      <footer className={styles.footer}>
        <p
          className={styles.srOnly}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={strings.app.reasoningStatusLabel}
        >
          {reasoningAnnouncement}
        </p>
        <p
          className={styles.srOnly}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={strings.app.sessionStatusLabel}
        >
          {sessionAnnouncement}
        </p>

        {runError === undefined ? null : (
          <p className={styles.runError} role="alert">
            {runError}
          </p>
        )}

        <TokenUsageSummary usage={usage} status={status} />

        <form className={styles.composer} onSubmit={handleSubmit}>
          <div className={styles.composerBox}>
            <label className={styles.srOnly} htmlFor="chat-message">
              {strings.app.messageLabel}
            </label>
            <textarea
              ref={inputRef}
              className={styles.input}
              id="chat-message"
              placeholder={strings.app.messagePlaceholder}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              rows={3}
              disabled={activeRequestId !== undefined || restoring}
            />
            <div className={styles.composerFooter}>
              <span className={styles.composerHint}>{strings.app.composerHint}</span>
              <div className={styles.actions}>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    activeRequestId !== undefined ||
                    restoring ||
                    sessionSwitchPending ||
                    draft.trim().length === 0
                  }
                >
                  {strings.app.send}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => store.getState().cancel()}
                  disabled={activeRequestId === undefined}
                >
                  {strings.app.cancel}
                </Button>
              </div>
            </div>
          </div>
        </form>

        <p className={styles.status} role="status" aria-label={strings.app.runStatusLabel}>
          {strings.app.status[status]}
        </p>
      </footer>
    </div>
  );
}
