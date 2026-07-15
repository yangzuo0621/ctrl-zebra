import { useEffect, useState } from "react";

import styles from "./app.module.css";
import { sendPing, subscribeToPong } from "./vscode-api.js";

type PingState =
  | { status: "idle" }
  | { status: "waiting"; requestId: string }
  | { status: "received"; requestId: string };

export function App() {
  const [pingState, setPingState] = useState<PingState>({ status: "idle" });

  useEffect(
    () =>
      subscribeToPong((message) => {
        setPingState((current) => {
          if (current.status !== "waiting" || current.requestId !== message.requestId) {
            return current;
          }

          return { status: "received", requestId: message.requestId };
        });
      }),
    [],
  );

  const pingStatus =
    pingState.status === "idle"
      ? "Ready to test the Extension connection."
      : pingState.status === "waiting"
        ? "Waiting for pong."
        : "Pong received.";

  const handlePing = () => {
    const requestId = crypto.randomUUID();
    setPingState({ status: "waiting", requestId });
    sendPing(requestId);
  };

  return (
    <main className={styles.shell} aria-labelledby="agent-view-title">
      <div className={styles.mark} aria-hidden="true">
        CZ
      </div>
      <div>
        <h1 className={styles.title} id="agent-view-title">
          CtrlZebra
        </h1>
        <p className={styles.description}>Your workspace agent is ready.</p>
        <div className={styles.actions}>
          <button
            className={styles.button}
            type="button"
            onClick={handlePing}
            disabled={pingState.status === "waiting"}
          >
            Ping Extension
          </button>
          <p className={styles.status} role="status">
            {pingStatus}
          </p>
        </div>
      </div>
    </main>
  );
}
