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
import { formatCommandStatus, strings } from "./strings.js";
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
    ? strings.command.awaitingDecision
    : commandCancelled
      ? strings.command.terminated
      : commandInterrupted
        ? strings.command.interrupted
        : commandTruncated
          ? strings.command.notCompleted
          : terminationRequested && toolCall.status === "running"
            ? strings.command.terminating
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
          <p className={styles.eyebrow}>{strings.command.eyebrow}</p>
          <h3 className={styles.title} id={headingId}>
            run_command
          </h3>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Badge variant={badgeVariant}>
            <span className={styles.state} role="status" aria-label={strings.command.statusLabel}>
              {visibleStatus}
            </span>
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setUserExpanded(!isExpanded)}
            aria-expanded={isExpanded}
          >
            {isExpanded ? strings.command.collapse : strings.command.details}
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
              <legend className={styles.label}>{strings.command.request}</legend>
              <pre className={styles.code}>{JSON.stringify(toolCall.call.input, null, 2)}</pre>
            </fieldset>
          )}

          {commandCancelled ? (
            <p className={styles.error} role="alert">
              {strings.command.cancelled}
            </p>
          ) : null}

          {commandTruncated ? (
            <p className={styles.error} role="alert">
              {strings.command.truncated}
            </p>
          ) : null}

          {toolCall.status === "success" && output?.success ? (
            <div className={styles.result}>
              <fieldset className={styles.field}>
                <legend className={styles.label}>{strings.command.standardOutput}</legend>
                <pre className={styles.output}>
                  {output.data.stdout || strings.command.noStdout}
                </pre>
              </fieldset>
              <fieldset className={styles.field}>
                <legend className={styles.label}>{strings.command.standardError}</legend>
                <pre className={styles.output}>
                  {output.data.stderr || strings.command.noStderr}
                </pre>
              </fieldset>
              <dl className={styles.exit} aria-label={strings.command.exit}>
                <div>
                  <dt>{strings.command.exitCode}</dt>
                  <dd>
                    {output.data.exitCode === null ? strings.command.none : output.data.exitCode}
                  </dd>
                </div>
                <div>
                  <dt>{strings.command.signal}</dt>
                  <dd>{output.data.signal ?? strings.command.none}</dd>
                </div>
              </dl>
              {toolCall.result.truncated ? (
                <p className={styles.note}>{strings.command.outputTruncated}</p>
              ) : null}
            </div>
          ) : null}

          {toolCall.status === "success" && output !== null && !output.success ? (
            <p className={styles.error} role="alert">
              {strings.command.unsafeOutput}
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
                {strings.command.terminate}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

function commandStatus(toolCall: DisplayToolCall): string {
  if (toolCall.status !== "success") {
    return formatCommandStatus(toolCall.status, undefined);
  }

  const output = runCommandOutputSchema.safeParse(toolCall.result.output);
  if (!output.success) {
    return strings.command.status.invalidResult;
  }
  return formatCommandStatus(toolCall.status, output.data);
}
