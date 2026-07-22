import { type FormEvent, useEffect, useState } from "react";
import { useStore } from "zustand";

import styles from "./app.module.css";
import { ApprovalCard } from "./approval-card.js";
import { createApprovalStore } from "./approval-store.js";
import { createChatStore, type DisplayMessage } from "./chat-store.js";
import { CheckpointPanel } from "./checkpoint-panel.js";
import { createCheckpointStore } from "./checkpoint-store.js";
import { ToolCallCard } from "./tool-call-card.js";
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
  const messages = useStore(store, (state) => state.messages);
  const status = useStore(store, (state) => state.status);
  const activeRequestId = useStore(store, (state) => state.activeRequestId);
  const sessions = useStore(store, (state) => state.sessions);
  const selectedSessionId = useStore(store, (state) => state.selectedSessionId);
  const sessionError = useStore(store, (state) => state.sessionError);
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (store.getState().submit(draft)) {
      setDraft("");
    }
  };

  return (
    <main className={styles.shell} aria-labelledby="agent-view-title">
      <header className={styles.header}>
        <div className={styles.mark} aria-hidden="true">
          CZ
        </div>
        <div>
          <h1 className={styles.title} id="agent-view-title">
            CtrlZebra
          </h1>
          <p className={styles.description}>Ask a question and stream the response.</p>
        </div>
      </header>

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
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => store.getState().loadSessions()}
          >
            Refresh
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => store.getState().restoreSelectedSession()}
            disabled={selectedSessionId === undefined || activeRequestId !== undefined}
          >
            Restore
          </button>
        </div>
        {sessionError === undefined ? null : <p className={styles.sessionError}>{sessionError}</p>}
      </section>

      <CheckpointPanel store={checkpointStore} />

      <ol className={styles.transcript} aria-label="Conversation">
        {messages.length === 0 ? (
          <li className={styles.empty}>No messages yet.</li>
        ) : (
          messages.map((message) => (
            <li className={styles.message} data-role={message.role} key={message.id}>
              <span className={styles.messageRole}>
                {message.role === "user" ? "You" : "Agent"}
              </span>
              <p>{messageContent(message, status)}</p>
              {message.toolCalls.map((toolCall) => (
                <ToolCallCard
                  key={toolCall.call.id}
                  toolCall={toolCall}
                  runStatus={status}
                  onTerminate={() => store.getState().cancel()}
                />
              ))}
            </li>
          ))
        )}
      </ol>

      {approval === undefined ? null : (
        <ApprovalCard
          item={approval}
          pendingDecision={pendingDecision}
          onViewDiff={() => approvalStore.getState().showDiff()}
          onApprove={() => approvalStore.getState().decide("approved")}
          onReject={() => approvalStore.getState().decide("denied")}
        />
      )}

      <form className={styles.composer} onSubmit={handleSubmit}>
        <label className={styles.label} htmlFor="chat-message">
          Message
        </label>
        <textarea
          className={styles.input}
          id="chat-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          disabled={activeRequestId !== undefined}
        />
        <div className={styles.actions}>
          <button
            className={styles.button}
            type="submit"
            disabled={activeRequestId !== undefined || draft.trim().length === 0}
          >
            Send
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => store.getState().cancel()}
            disabled={activeRequestId === undefined}
          >
            Cancel
          </button>
        </div>
      </form>

      <p className={styles.status} role="status">
        {statusText[status]}
      </p>
    </main>
  );
}
