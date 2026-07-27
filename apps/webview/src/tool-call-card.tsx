import type { JsonValue } from "@ctrl-zebra/protocol";
import { useState } from "react";

import type { DisplayToolCall } from "./chat-store.js";
import { CommandToolCard, type DisplayRunStatus } from "./command-tool-card.js";
import styles from "./tool-call-card.module.css";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";

interface ToolCallCardProps {
  readonly toolCall: DisplayToolCall;
  readonly runStatus?: DisplayRunStatus;
  readonly onTerminate?: () => void;
}

const statusLabels = {
  pending: "Pending",
  running: "Running",
  success: "Success",
  error: "Error",
} as const;

export function ToolCallCard({
  toolCall,
  runStatus = "idle",
  onTerminate = () => {},
}: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (toolCall.call.name === "run_command") {
    return <CommandToolCard toolCall={toolCall} runStatus={runStatus} onTerminate={onTerminate} />;
  }

  const headingId = `tool-call-${toolCall.call.id}`;
  const badgeVariant =
    toolCall.status === "success"
      ? "success"
      : toolCall.status === "error"
        ? "error"
        : toolCall.status === "running"
          ? "info"
          : "default";

  return (
    <article aria-labelledby={headingId} className={styles.card} data-status={toolCall.status}>
      <header className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h3 className={styles.title} id={headingId}>
            {toolCall.call.name}
          </h3>
          <Badge variant={badgeVariant}>
            <span className={styles.state} role="status" aria-label="Tool status">
              {statusLabels[toolCall.status]}
            </span>
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
        >
          {isExpanded ? "Collapse" : "Details"}
        </Button>
      </header>

      {isExpanded ? (
        <>
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
        </>
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
