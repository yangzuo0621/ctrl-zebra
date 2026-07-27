import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import styles from "./app.module.css";
import { ApprovalCard } from "./approval-card.js";
import { createApprovalStore } from "./approval-store.js";
import { createChatStore, type DisplayMessage } from "./chat-store.js";
import { CheckpointPanel } from "./checkpoint-panel.js";
import { createCheckpointStore } from "./checkpoint-store.js";
import { MarkdownMessage } from "./markdown-message.js";
import { OnboardingCard } from "./onboarding-card.js";
import { ToolCallCard } from "./tool-call-card.js";
import { Button } from "./ui/button.js";
import { getWebviewHost, type WebviewHost } from "./vscode-api.js";

interface AppProps {
  readonly host?: WebviewHost;
  readonly createRequestId?: () => string;
}

const statusText = {
  idle: "Ready.",
  preparing: "Preparing response…",
  streaming: "Generating response…",
  completed: "Response complete.",
  cancelled: "Response cancelled.",
  failed: "Response failed.",
  interrupted: "Session was interrupted by a restart.",
} as const;

function messageContent(message: DisplayMessage, status: string): string {
  if (message.content.length > 0 || message.role === "user") {
    return message.content;
  }

  if (status === "cancelled") {
    return "Cancelled before a response was received.";
  }

  if (status === "failed") {
    return "No response was received.";
  }

  return "Waiting for response…";
}

export function App({ host: providedHost, createRequestId }: AppProps) {
  const [host] = useState(() => providedHost ?? getWebviewHost());
  const [store] = useState(() => createChatStore({ host, createRequestId }));
  const [approvalStore] = useState(() => createApprovalStore(host));
  const [checkpointStore] = useState(() =>
    createCheckpointStore(host, createRequestId ?? (() => crypto.randomUUID())),
  );
  const [draft, setDraft] = useState("");
  const [showSessionsDrawer, setShowSessionsDrawer] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const mainRef = useRef<HTMLDivElement>(null);

  const messages = useStore(store, (state) => state.messages);
  const status = useStore(store, (state) => state.status);
  const activeRequestId = useStore(store, (state) => state.activeRequestId);
  const sessions = useStore(store, (state) => state.sessions);
  const selectedSessionId = useStore(store, (state) => state.selectedSessionId);
  const sessionError = useStore(store, (state) => state.sessionError);
  const runError = useStore(store, (state) => state.runError);
  const approval = useStore(approvalStore, (state) => state.current);
  const pendingDecision = useStore(approvalStore, (state) => state.pendingDecision);

  useEffect(() => {
    const unsubscribe = host.subscribe((message) => {
      store.getState().receive(message);
      approvalStore.getState().receive(message);
      checkpointStore.getState().receive(message);
    });
    return () => {
      unsubscribe();
      store.getState().dispose();
    };
  }, [approvalStore, checkpointStore, host, store]);

  // Scroll to bottom when new messages arrive unless user scrolled up
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on message updates
  useEffect(() => {
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
              CtrlZebra
            </h1>
            <p className={styles.description}>Ask a question and stream the response.</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowSessionsDrawer((prev) => !prev)}
          aria-expanded={showSessionsDrawer}
        >
          {showSessionsDrawer ? "Hide Sessions" : "Sessions"}
        </Button>
      </header>

      {showSessionsDrawer ? (
        <section className={styles.secondaryDrawer} aria-label="Session history and checkpoints">
          <section className={styles.sessions} aria-labelledby="saved-sessions-title">
            <h2 id="saved-sessions-title">Saved sessions</h2>
            <div className={styles.sessionControls}>
              <select
                aria-label="Saved session"
                value={selectedSessionId ?? ""}
                onChange={(event) => store.getState().selectSession(event.target.value)}
                disabled={sessions.length === 0 || activeRequestId !== undefined}
              >
                {sessions.length === 0 ? <option value="">No saved sessions</option> : null}
                {sessions.map((session) => (
                  <option value={session.sessionId} key={session.sessionId}>
                    {new Date(session.createdAt).toLocaleString()} — {session.status}
                  </option>
                ))}
              </select>
              <Button variant="secondary" size="sm" onClick={() => store.getState().loadSessions()}>
                Refresh
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => store.getState().restoreSelectedSession()}
                disabled={selectedSessionId === undefined || activeRequestId !== undefined}
              >
                Restore
              </Button>
            </div>
            {sessionError === undefined ? null : (
              <p className={styles.sessionError}>{sessionError}</p>
            )}
          </section>
          <CheckpointPanel store={checkpointStore} />
        </section>
      ) : null}

      <main
        ref={mainRef}
        onScroll={handleScroll}
        className={styles.transcriptSection}
        aria-label="Conversation"
      >
        <ol className={styles.transcript}>
          {messages.length === 0 ? (
            <li className={styles.empty}>
              <OnboardingCard onSelectPrompt={(prompt) => setDraft(prompt)} />
              <p className={styles.emptyText}>No messages yet.</p>
            </li>
          ) : (
            messages.map((message) => (
              <li
                className={styles.message}
                data-role={message.role}
                key={message.id}
                aria-label={message.role === "user" ? "Your message" : "Agent message"}
              >
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
            aria-label="Scroll to newest messages"
          >
            ↓ Jump to bottom
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
        {runError === undefined ? null : (
          <p className={styles.runError} role="alert">
            {runError}
          </p>
        )}

        <form className={styles.composer} onSubmit={handleSubmit}>
          <div className={styles.composerBox}>
            <label className={styles.srOnly} htmlFor="chat-message">
              Message
            </label>
            <textarea
              className={styles.input}
              id="chat-message"
              placeholder="Describe what to build or ask a question…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              rows={3}
              disabled={activeRequestId !== undefined}
            />
            <div className={styles.composerFooter}>
              <span className={styles.composerHint}>Enter to send, Shift+Enter for line break</span>
              <div className={styles.actions}>
                <Button
                  type="submit"
                  size="sm"
                  disabled={activeRequestId !== undefined || draft.trim().length === 0}
                >
                  Send
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => store.getState().cancel()}
                  disabled={activeRequestId === undefined}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </form>

        <p className={styles.status} role="status">
          {statusText[status]}
        </p>
      </footer>
    </div>
  );
}
