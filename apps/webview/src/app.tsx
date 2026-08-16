import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import styles from "./app.module.css";
import { ApprovalCard } from "./approval-card.js";
import { createApprovalStore } from "./approval-store.js";
import { createChatStore, type DisplayMessage } from "./chat-store.js";
import { CheckpointPanel } from "./checkpoint-panel.js";
import { createCheckpointStore } from "./checkpoint-store.js";
import { EditorContextCard } from "./editor-context-card.js";
import { createEditorContextStore } from "./editor-context-store.js";
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
import { WorkspaceFileReferenceCard } from "./workspace-file-reference-card.js";
import { createWorkspaceFileReferenceStore } from "./workspace-file-reference-store.js";

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

function workspaceFileMentionQuery(value: string): string | undefined {
  const match = /(?:^|\s)@([^\s]*)$/u.exec(value);
  return match?.[1];
}

function removeWorkspaceFileMention(value: string): string {
  return value.replace(/(^|\s)@([^\s]*)$/u, "$1");
}

export function App({ host: providedHost, createRequestId }: AppProps) {
  const [host] = useState(() => providedHost ?? getWebviewHost());
  const [editorContextStore] = useState(() =>
    createEditorContextStore({
      host,
      createRequestId: createRequestId ?? (() => crypto.randomUUID()),
    }),
  );
  const [workspaceFileStore] = useState(() =>
    createWorkspaceFileReferenceStore({
      host,
      createRequestId: createRequestId ?? (() => crypto.randomUUID()),
    }),
  );
  const [approvalStore] = useState(() => createApprovalStore(host));
  const [checkpointStore] = useState(() =>
    createCheckpointStore(host, createRequestId ?? (() => crypto.randomUUID())),
  );
  const [store] = useState(() =>
    createChatStore({
      host,
      createRequestId,
      beforeNewChat: () => {
        editorContextStore.getState().clearLocal();
        workspaceFileStore.getState().clearLocal();
      },
      beforeRestoreSession: () => {
        editorContextStore.getState().clearForSessionSwitch();
        workspaceFileStore.getState().clearForSessionSwitch();
      },
      beforeSessionMutation: () => {
        approvalStore.getState().clear();
        checkpointStore.getState().clear();
      },
      afterSessionDeleted: () => {
        checkpointStore.getState().load();
      },
      afterSessionsCleared: () => {
        checkpointStore.getState().clear();
      },
      afterLocalDataCleared: () => {
        approvalStore.getState().clear();
        checkpointStore.getState().clear();
        mcpStore.getState().clearLocal();
        onboardingStore.getState().clearLocal();
        editorContextStore.getState().clearLocal();
        workspaceFileStore.getState().clearLocal();
      },
      afterSessionMutationFailed: () => {
        checkpointStore.getState().load();
        store.getState().loadSessions();
      },
    }),
  );
  const [mcpStore] = useState(() =>
    createMcpStore(host, createRequestId ?? (() => crypto.randomUUID())),
  );
  const [onboardingStore] = useState(() =>
    createOnboardingStore(host, createRequestId ?? (() => crypto.randomUUID())),
  );
  const [showSessionsDrawer, setShowSessionsDrawer] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string>();
  const [editingDraft, setEditingDraft] = useState("");

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
  const sessionMutationPending = useStore(store, (state) => state.sessionMutationPending);
  const localDataClearPending = useStore(store, (state) => state.localDataClearPending);
  const localDataClearCategories = useStore(store, (state) => state.localDataClearCategories);
  const deletingSessionId = useStore(store, (state) => state.deletingSessionId);
  const sessionError = useStore(store, (state) => state.sessionError);
  const runError = useStore(store, (state) => state.runError);
  const reasoningAnnouncement = useStore(store, (state) => state.reasoningAnnouncement);
  const sessionAnnouncement = useStore(store, (state) => state.sessionAnnouncement);
  const usage = useStore(store, (state) => state.usage);
  const regeneratingMessageId = useStore(store, (state) => state.regeneratingMessageId);
  const approval = useStore(approvalStore, (state) => state.current);
  const pendingDecision = useStore(approvalStore, (state) => state.pendingDecision);
  const providerStatus = useStore(onboardingStore, (state) => state.status);
  const providerPendingAction = useStore(onboardingStore, (state) => state.pendingAction);
  const providerActionOutcome = useStore(onboardingStore, (state) => state.actionOutcome);
  const providerAnnouncement = useStore(onboardingStore, (state) => state.announcement);
  const draft = useStore(editorContextStore, (state) => state.draft);
  const editorContextCard = useStore(editorContextStore, (state) => state.card);
  const editorContextAnnouncement = useStore(editorContextStore, (state) => state.announcement);
  const editorContextCapturePending = useStore(editorContextStore, (state) => state.capturePending);
  const editorContextCanSend = useStore(editorContextStore, (state) => state.canSend());
  const workspaceFileCards = useStore(workspaceFileStore, (state) => state.cards);
  const workspaceFileSuggestions = useStore(workspaceFileStore, (state) => state.suggestions);
  const workspaceFileSearchPending = useStore(workspaceFileStore, (state) => state.searchPending);
  const workspaceFileAnnouncement = useStore(workspaceFileStore, (state) => state.announcement);
  const workspaceFileCanSend = useStore(workspaceFileStore, (state) => state.canSend());
  const [workspaceSuggestionIndex, setWorkspaceSuggestionIndex] = useState(0);

  useEffect(() => {
    const unsubscribe = host.subscribe((message) => {
      store.getState().receive(message);
      approvalStore.getState().receive(message);
      checkpointStore.getState().receive(message);
      mcpStore.getState().receive(message);
      onboardingStore.getState().receive(message);
      editorContextStore.getState().receive(message);
      workspaceFileStore.getState().receive(message);
    });
    host.ping?.(createRequestId?.() ?? crypto.randomUUID());
    onboardingStore.getState().refresh();
    return () => {
      unsubscribe();
      store.getState().dispose();
      editorContextStore.getState().dispose();
      workspaceFileStore.getState().dispose();
      onboardingStore.getState().dispose();
    };
  }, [
    approvalStore,
    checkpointStore,
    createRequestId,
    editorContextStore,
    host,
    mcpStore,
    onboardingStore,
    store,
    workspaceFileStore,
  ]);

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
      setUserScrolledUp(false);
      mcpStore.getState().clearDraft();
      inputRef.current?.focus();
    }
  };

  const handleDeleteSession = () => {
    if (sessionSelectionId !== undefined && window.confirm(strings.chat.deleteSessionConfirm)) {
      store.getState().deleteSession(sessionSelectionId);
    }
  };

  const handleClearSessions = () => {
    if (window.confirm(strings.chat.clearSessionsConfirm)) {
      store.getState().clearSessions();
    }
  };

  const handleClearLocalData = () => {
    store.getState().clearLocalData();
  };

  const handleDraftChange = (value: string) => {
    editorContextStore.getState().setDraft(value);
    const query = workspaceFileMentionQuery(value);
    if (query === undefined) {
      workspaceFileStore.getState().clearSearch();
      setWorkspaceSuggestionIndex(0);
    } else {
      workspaceFileStore.getState().search(query);
      setWorkspaceSuggestionIndex(0);
    }
  };

  const selectWorkspaceFile = (path: string) => {
    editorContextStore.getState().setDraft(removeWorkspaceFileMention(draft));
    workspaceFileStore.getState().clearSearch();
    workspaceFileStore.getState().read(path);
    inputRef.current?.focus();
  };

  const beginEditing = (message: DisplayMessage) => {
    if (message.role !== "user") {
      return;
    }
    setEditingMessageId(message.id);
    setEditingDraft(message.content);
  };

  const cancelEditing = () => {
    setEditingMessageId(undefined);
    setEditingDraft("");
  };

  const submitEditing = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      editingMessageId !== undefined &&
      store.getState().editMessage(editingMessageId, editingDraft)
    ) {
      cancelEditing();
      setUserScrolledUp(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !editorContextCapturePending &&
      editorContextCanSend &&
      workspaceFileCanSend &&
      store.getState().submit(draft)
    ) {
      editorContextStore.getState().setDraft("");
      setUserScrolledUp(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (workspaceFileSuggestions.length > 0 && !isComposing) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setWorkspaceSuggestionIndex((index) =>
          Math.min(index + 1, workspaceFileSuggestions.length - 1),
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setWorkspaceSuggestionIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        workspaceFileStore.getState().clearSearch();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        const suggestion = workspaceFileSuggestions[workspaceSuggestionIndex];
        if (suggestion !== undefined) {
          event.preventDefault();
          selectWorkspaceFile(suggestion.path);
          return;
        }
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !isComposing) {
      event.preventDefault();
      if (
        draft.trim().length > 0 &&
        activeRequestId === undefined &&
        editorContextCanSend &&
        workspaceFileCanSend
      ) {
        if (store.getState().submit(draft)) {
          editorContextStore.getState().setDraft("");
          setUserScrolledUp(false);
        }
      }
    }
  };

  const hasInlineApproval =
    approval !== undefined &&
    messages.some((m) => m.toolCalls.some((tc) => tc.call.id === approval.approval.scope.call.id));
  const handleOpenLink = (href: string) => {
    host.openExternal?.(createRequestId?.() ?? crypto.randomUUID(), href);
  };
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
            disabled={
              activeRequestId !== undefined ||
              restoring ||
              sessionSwitchPending ||
              sessionMutationPending
            }
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
            : localDataClearPending
              ? strings.chat.clearingLocalData
              : sessionMutationPending
                ? strings.chat.deletingSession
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
                disabled={
                  sessions.length === 0 ||
                  activeRequestId !== undefined ||
                  restoring ||
                  sessionMutationPending
                }
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
                disabled={activeRequestId !== undefined || restoring || sessionMutationPending}
              >
                {strings.app.refresh}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => store.getState().restoreSelectedSession()}
                disabled={
                  sessionSelectionId === undefined ||
                  activeRequestId !== undefined ||
                  restoring ||
                  sessionMutationPending
                }
              >
                {strings.app.restore}
              </Button>
            </div>
            <div className={styles.sessionMutationControls}>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDeleteSession}
                disabled={sessionSelectionId === undefined || restoring || sessionMutationPending}
              >
                {deletingSessionId === sessionSelectionId
                  ? strings.chat.deletingSession
                  : strings.chat.deleteSession}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleClearSessions}
                disabled={restoring || sessionMutationPending}
              >
                {sessionMutationPending && deletingSessionId === undefined
                  ? strings.chat.clearingSessions
                  : strings.chat.clearSessions}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleClearLocalData}
                disabled={
                  host.clearLocalData === undefined ||
                  sessionMutationPending ||
                  localDataClearPending
                }
              >
                {localDataClearPending
                  ? strings.chat.clearingLocalData
                  : strings.chat.clearLocalData}
              </Button>
            </div>
            <p className={styles.localDataWarning}>{strings.chat.clearLocalDataDescription}</p>
            {sessionError === undefined ? null : (
              <p className={styles.sessionError}>{sessionError}</p>
            )}
            {localDataClearCategories.length === 0 ? null : (
              <ul
                className={styles.localDataClearCategories}
                aria-label={strings.chat.localDataClearCategoriesLabel}
              >
                {localDataClearCategories.map(({ category, outcome, deleted, failed }) => (
                  <li
                    className={
                      outcome === "failed"
                        ? styles.localDataClearCategoryFailed
                        : styles.localDataClearCategory
                    }
                    key={category}
                  >
                    <span>{strings.chat.localDataClearCategoryLabels[category]}</span>
                    <span>
                      {strings.chat.localDataClearCategoryStatus(outcome)} ·{" "}
                      {strings.chat.localDataClearCategoryCounts(deleted, failed)}
                    </span>
                  </li>
                ))}
              </ul>
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
                onSelectPrompt={(prompt) => editorContextStore.getState().setDraft(prompt)}
              />
              <p className={styles.emptyText}>{strings.app.noMessages}</p>
            </li>
          ) : (
            messages.map((message, index) => (
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
                {editingMessageId === message.id && message.role === "user" ? (
                  <form className={styles.editForm} onSubmit={submitEditing}>
                    <label className={styles.srOnly} htmlFor={`edit-message-${message.id}`}>
                      {strings.chat.editMessageLabel}
                    </label>
                    <textarea
                      className={styles.input}
                      id={`edit-message-${message.id}`}
                      value={editingDraft}
                      onChange={(event) => setEditingDraft(event.target.value)}
                      rows={3}
                      disabled={
                        activeRequestId !== undefined || restoring || sessionMutationPending
                      }
                    />
                    <div className={styles.messageActions}>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={
                          activeRequestId !== undefined ||
                          restoring ||
                          sessionMutationPending ||
                          sessionSwitchPending ||
                          editingDraft.trim().length === 0
                        }
                      >
                        {strings.chat.saveEdit}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={cancelEditing}
                        disabled={
                          activeRequestId !== undefined || restoring || sessionMutationPending
                        }
                      >
                        {strings.chat.cancelEdit}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <MarkdownMessage
                    content={messageContent(message, status)}
                    onOpenLink={handleOpenLink}
                  />
                )}
                {message.role === "user" && editingMessageId !== message.id ? (
                  <div className={styles.messageActions}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => beginEditing(message)}
                      disabled={
                        activeRequestId !== undefined ||
                        restoring ||
                        sessionMutationPending ||
                        sessionSwitchPending ||
                        selectedSessionId === undefined ||
                        editingMessageId !== undefined
                      }
                      aria-label={strings.chat.editScope}
                      title={strings.chat.editScope}
                    >
                      {strings.chat.edit}
                    </Button>
                  </div>
                ) : null}
                {message.role === "assistant" &&
                index === messages.length - 1 &&
                message.content.length > 0 ? (
                  <div className={styles.messageActions}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => store.getState().regenerate(message.id)}
                      disabled={
                        activeRequestId !== undefined ||
                        restoring ||
                        sessionMutationPending ||
                        regeneratingMessageId !== undefined ||
                        selectedSessionId === undefined
                      }
                      aria-label={strings.chat.regenerateScope}
                      title={strings.chat.regenerateScope}
                    >
                      {strings.chat.regenerate}
                    </Button>
                  </div>
                ) : null}
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

        <EditorContextCard store={editorContextStore} />
        <WorkspaceFileReferenceCard store={workspaceFileStore} />

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
              onChange={(event) => handleDraftChange(event.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              rows={3}
              disabled={activeRequestId !== undefined || restoring || sessionMutationPending}
            />
            {workspaceFileSearchPending ? (
              <p className={styles.composerHint}>{strings.workspaceFiles.reading}</p>
            ) : null}
            {workspaceFileSuggestions.length === 0 ? null : (
              <div
                className={styles.workspaceFileSuggestions}
                role="listbox"
                aria-label={strings.workspaceFiles.suggestionsLabel}
              >
                {workspaceFileSuggestions.map((suggestion, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={workspaceSuggestionIndex === index}
                    className={styles.workspaceFileSuggestion}
                    key={suggestion.path}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectWorkspaceFile(suggestion.path)}
                  >
                    {suggestion.path}
                  </button>
                ))}
              </div>
            )}
            <div className={styles.composerFooter}>
              <span className={styles.composerHint}>{strings.app.composerHint}</span>
              <div className={styles.actions}>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    activeRequestId !== undefined ||
                    restoring ||
                    sessionMutationPending ||
                    sessionSwitchPending ||
                    draft.trim().length === 0 ||
                    !editorContextCanSend ||
                    editorContextCapturePending ||
                    !workspaceFileCanSend
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
        <p className={styles.srOnly} aria-live="polite" aria-atomic="true">
          {editorContextCard?.status === "stale" && !editorContextCard.staleAccepted
            ? strings.editorContext.sendBlocked
            : workspaceFileCards.some(
                  (card) => card.reference.context.source.stale && !card.staleAccepted,
                )
              ? strings.workspaceFiles.stale
              : editorContextAnnouncement || workspaceFileAnnouncement}
        </p>
      </footer>
    </div>
  );
}
