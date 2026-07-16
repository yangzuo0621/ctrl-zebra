import { type FormEvent, useEffect, useState } from "react";
import { useStore } from "zustand";

import styles from "./app.module.css";
import { createChatStore, type DisplayMessage } from "./chat-store.js";
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
  const [draft, setDraft] = useState("");
  const messages = useStore(store, (state) => state.messages);
  const status = useStore(store, (state) => state.status);
  const activeRequestId = useStore(store, (state) => state.activeRequestId);

  useEffect(() => {
    const unsubscribe = host.subscribe((message) => store.getState().receive(message));
    return () => {
      unsubscribe();
      store.getState().dispose();
    };
  }, [host, store]);

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
            </li>
          ))
        )}
      </ol>

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
