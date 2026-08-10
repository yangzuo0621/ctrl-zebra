import {
  type ApprovalDecisionIntent,
  type RunStatus,
  runCommandOutputSchema,
} from "@ctrl-zebra/protocol";
import { useState } from "react";

import { ApprovalCard } from "./approval-card.js";
import type { DisplayApproval } from "./approval-store.js";
import type { DisplayToolCall } from "./chat-store.js";
import styles from "./command-tool-card.module.css";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";

export type DisplayRunStatus = "idle" | "interrupted" | RunStatus;

interface CommandToolCardProps {
  readonly toolCall: DisplayToolCall;
  readonly runStatus: DisplayRunStatus;
  readonly approval?: DisplayApproval;
  readonly pendingDecision?: ApprovalDecisionIntent;
  readonly onTerminate: () => void;
  readonly onViewDiff?: () => void;
  readonly onApprove?: () => void;
  readonly onReject?: () => void;
}

export function CommandToolCard({
  toolCall,
  runStatus,
  approval,
  pendingDecision,
  onTerminate,
  onViewDiff = () => {},
  onApprove = () => {},
  onReject = () => {},
}: CommandToolCardProps) {
  const [terminationRequested, setTerminationRequested] = useState(false);
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  const isAwaitingApproval = approval !== undefined;
  const headingId = `command-tool-${toolCall.call.id}`;
  const commandCancelled =
    runStatus === "cancelled" && (toolCall.status === "pending" || toolCall.status === "running");
  const commandInterrupted =
    runStatus === "interrupted" && (toolCall.status === "pending" || toolCall.status === "running");
  const commandTruncated =
    runStatus === "truncated" && (toolCall.status === "pending" || toolCall.status === "running");
  const canTerminate =
    toolCall.status === "running" &&
    (runStatus === "preparing" || runStatus === "streaming") &&
    !terminationRequested;
  const visibleStatus = isAwaitingApproval
    ? "Awaiting Decision"
    : commandCancelled
      ? "Terminated"
      : commandInterrupted
        ? "Interrupted"
        : commandTruncated
          ? "Not completed"
          : terminationRequested && toolCall.status === "running"
            ? "Terminating…"
            : commandStatus(toolCall);
  const visualStatus =
    commandCancelled || commandInterrupted || commandTruncated ? "error" : toolCall.status;
  const badgeVariant = isAwaitingApproval
    ? "warning"
    : visualStatus === "success"
      ? "success"
      : visualStatus === "error"
        ? "error"
        : visualStatus === "running"
          ? "info"
          : "default";

  const isExpanded =
    userExpanded ??
    (isAwaitingApproval ||
      toolCall.status === "pending" ||
      toolCall.status === "running" ||
      toolCall.status === "error" ||
      visualStatus === "error");

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
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Badge variant={badgeVariant}>
            <span className={styles.state} role="status" aria-label="Command status">
              {visibleStatus}
            </span>
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setUserExpanded(!isExpanded)}
            aria-expanded={isExpanded}
          >
            {isExpanded ? "Collapse" : "Details"}
          </Button>
        </div>
      </header>

      {isExpanded ? (
        <>
          {isAwaitingApproval ? (
            <ApprovalCard
              embedded
              item={approval}
              pendingDecision={pendingDecision}
              onViewDiff={onViewDiff}
              onApprove={onApprove}
              onReject={onReject}
            />
          ) : (
            <fieldset className={styles.field}>
              <legend className={styles.label}>Command request</legend>
              <pre className={styles.code}>{JSON.stringify(toolCall.call.input, null, 2)}</pre>
            </fieldset>
          )}

          {commandCancelled ? (
            <p className={styles.error} role="alert">
              Command execution was cancelled before it completed.
            </p>
          ) : null}

          {commandTruncated ? (
            <p className={styles.error} role="alert">
              The response ended before this Tool could complete.
            </p>
          ) : null}

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
              <Button
                variant="secondary"
                className={styles.terminateButton}
                onClick={terminate}
                disabled={!canTerminate}
              >
                Terminate command
              </Button>
            </div>
          ) : null}
        </>
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
