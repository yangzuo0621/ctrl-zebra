import type { JsonValue } from "@ctrl-zebra/protocol";

import type { DisplayToolCall } from "./chat-store.js";
import styles from "./tool-call-card.module.css";

interface ToolCallCardProps {
  readonly toolCall: DisplayToolCall;
}

const statusLabels = {
  pending: "Pending",
  running: "Running",
  success: "Success",
  error: "Error",
} as const;

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const headingId = `tool-call-${toolCall.call.id}`;

  return (
    <article aria-labelledby={headingId} className={styles.card} data-status={toolCall.status}>
      <header className={styles.header}>
        <h3 className={styles.title} id={headingId}>
          {toolCall.call.name}
        </h3>
        <span className={styles.state} role="status" aria-label="Tool status">
          {statusLabels[toolCall.status]}
        </span>
      </header>

      <fieldset className={styles.field}>
        <legend className={styles.label}>Arguments</legend>
        <pre className={styles.code}>{formatJson(toolCall.call.input)}</pre>
      </fieldset>

      {toolCall.status === "success" ? (
        <div className={styles.result}>
          <fieldset className={styles.field}>
            <legend className={styles.label}>Result</legend>
            <pre className={styles.code}>{summarizeJson(toolCall.result.output)}</pre>
          </fieldset>
          {toolCall.result.truncated ? <p className={styles.note}>Result truncated.</p> : null}
        </div>
      ) : null}

      {toolCall.status === "error" ? (
        <p className={styles.error} role="alert">
          {toolCall.result.error.message}
        </p>
      ) : null}
    </article>
  );
}

function formatJson(value: JsonValue): string {
  return JSON.stringify(value, null, 2);
}

function summarizeJson(value: JsonValue): string {
  const formatted = formatJson(value);
  const maxCharacters = 500;
  return formatted.length <= maxCharacters ? formatted : `${formatted.slice(0, maxCharacters)}…`;
}
