import { type RunStatus, runCommandOutputSchema } from "@ctrl-zebra/protocol";
import { useState } from "react";

import type { DisplayToolCall } from "./chat-store.js";
import styles from "./command-tool-card.module.css";

export type DisplayRunStatus = "idle" | "interrupted" | RunStatus;

interface CommandToolCardProps {
  readonly toolCall: DisplayToolCall;
  readonly runStatus: DisplayRunStatus;
  readonly onTerminate: () => void;
}

export function CommandToolCard({ toolCall, runStatus, onTerminate }: CommandToolCardProps) {
  const [terminationRequested, setTerminationRequested] = useState(false);
  const headingId = `command-tool-${toolCall.call.id}`;
  const commandCancelled =
    runStatus === "cancelled" && (toolCall.status === "pending" || toolCall.status === "running");
  const commandInterrupted =
    runStatus === "interrupted" && (toolCall.status === "pending" || toolCall.status === "running");
  const canTerminate =
    toolCall.status === "running" &&
    (runStatus === "preparing" || runStatus === "streaming") &&
    !terminationRequested;
  const visibleStatus = commandCancelled
    ? "Terminated"
    : commandInterrupted
      ? "Interrupted"
      : terminationRequested && toolCall.status === "running"
        ? "Terminating…"
        : commandStatus(toolCall);
  const visualStatus = commandCancelled || commandInterrupted ? "error" : toolCall.status;
  const output =
    toolCall.status === "success" ? runCommandOutputSchema.safeParse(toolCall.result.output) : null;

  const terminate = () => {
    if (!canTerminate) {
      return;
    }

    setTerminationRequested(true);
    onTerminate();
  };

  return (
    <article aria-labelledby={headingId} className={styles.card} data-status={visualStatus}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Command Tool</p>
          <h3 className={styles.title} id={headingId}>
            run_command
          </h3>
        </div>
        <span className={styles.state} role="status" aria-label="Command status">
          {visibleStatus}
        </span>
      </header>

      <fieldset className={styles.field}>
        <legend className={styles.label}>Command request</legend>
        <pre className={styles.code}>{JSON.stringify(toolCall.call.input, null, 2)}</pre>
      </fieldset>

      {toolCall.status === "success" && output?.success ? (
        <div className={styles.result}>
          <fieldset className={styles.field}>
            <legend className={styles.label}>Standard output</legend>
            <pre className={styles.output}>{output.data.stdout || "No stdout."}</pre>
          </fieldset>
          <fieldset className={styles.field}>
            <legend className={styles.label}>Standard error</legend>
            <pre className={styles.output}>{output.data.stderr || "No stderr."}</pre>
          </fieldset>
          <dl className={styles.exit} aria-label="Command exit">
            <div>
              <dt>Exit code</dt>
              <dd>{output.data.exitCode === null ? "None" : output.data.exitCode}</dd>
            </div>
            <div>
              <dt>Signal</dt>
              <dd>{output.data.signal ?? "None"}</dd>
            </div>
          </dl>
          {toolCall.result.truncated ? (
            <p className={styles.note}>Command output truncated.</p>
          ) : null}
        </div>
      ) : null}

      {toolCall.status === "success" && output !== null && !output.success ? (
        <p className={styles.error} role="alert">
          Command output could not be displayed safely.
        </p>
      ) : null}

      {toolCall.status === "error" ? (
        <p className={styles.error} role="alert">
          {toolCall.result.error.message}
        </p>
      ) : null}

      {toolCall.status === "running" ? (
        <div className={styles.actions}>
          <button
            className={styles.terminateButton}
            type="button"
            onClick={terminate}
            disabled={!canTerminate}
          >
            Terminate command
          </button>
        </div>
      ) : null}
    </article>
  );
}

function commandStatus(toolCall: DisplayToolCall): string {
  if (toolCall.status === "pending") {
    return "Pending";
  }
  if (toolCall.status === "running") {
    return "Running";
  }
  if (toolCall.status === "error") {
    return "Failed";
  }
  if (toolCall.status !== "success") {
    return "Pending";
  }

  const output = runCommandOutputSchema.safeParse(toolCall.result.output);
  if (!output.success) {
    return "Invalid result";
  }
  if (output.data.exitCode !== null) {
    return `Exited (${output.data.exitCode})`;
  }
  if (output.data.signal !== null) {
    return `Exited (${output.data.signal})`;
  }
  return "Exited";
}
