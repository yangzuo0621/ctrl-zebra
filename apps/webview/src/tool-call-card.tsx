import type { ApprovalDecisionIntent, JsonValue } from "@ctrl-zebra/protocol";
import { useState } from "react";

import { ApprovalCard } from "./approval-card.js";
import type { DisplayApproval } from "./approval-store.js";
import type { DisplayToolCall } from "./chat-store.js";
import { CommandToolCard, type DisplayRunStatus } from "./command-tool-card.js";
import styles from "./tool-call-card.module.css";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";

export interface ToolCallCardProps {
  readonly toolCall: DisplayToolCall;
  readonly runStatus?: DisplayRunStatus;
  readonly approval?: DisplayApproval;
  readonly pendingDecision?: ApprovalDecisionIntent;
  readonly onTerminate?: () => void;
  readonly onViewDiff?: () => void;
  readonly onApprove?: () => void;
  readonly onReject?: () => void;
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
  approval,
  pendingDecision,
  onTerminate = () => {},
  onViewDiff = () => {},
  onApprove = () => {},
  onReject = () => {},
}: ToolCallCardProps) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  if (toolCall.call.name === "run_command") {
    return (
      <CommandToolCard
        toolCall={toolCall}
        runStatus={runStatus}
        approval={approval}
        pendingDecision={pendingDecision}
        onTerminate={onTerminate}
        onViewDiff={onViewDiff}
        onApprove={onApprove}
        onReject={onReject}
      />
    );
  }

  const isAwaitingApproval = approval !== undefined;
  const isExpanded =
    userExpanded ??
    (isAwaitingApproval ||
      toolCall.status === "pending" ||
      toolCall.status === "running" ||
      toolCall.status === "error");

  const headingId = `tool-call-${toolCall.call.id}`;
  const badgeVariant = isAwaitingApproval
    ? "warning"
    : toolCall.status === "success"
      ? "success"
      : toolCall.status === "error"
        ? "error"
        : toolCall.status === "running"
          ? "info"
          : "default";

  const badgeText = isAwaitingApproval ? "Awaiting Decision" : statusLabels[toolCall.status];

  return (
    <article aria-labelledby={headingId} className={styles.card} data-status={toolCall.status}>
      <header className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h3 className={styles.title} id={headingId}>
            {toolCall.call.name}
          </h3>
          <Badge variant={badgeVariant}>
            <span className={styles.state} role="status" aria-label="Tool status">
              {badgeText}
            </span>
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setUserExpanded(!isExpanded)}
          aria-expanded={isExpanded}
        >
          {isExpanded ? "Collapse" : "Details"}
        </Button>
      </header>

      {isExpanded ? (
        <>
          {toolCall.source?.kind === "mcp" ? (
            <div className={styles.note}>
              <p>External MCP Server: {toolCall.source.server.displayName}</p>
              <p>Action: {toolCall.source.mcpToolName}</p>
              <p>Risk: execution may have side effects unknown to CtrlZebra.</p>
            </div>
          ) : (
            <p className={styles.note}>Source: built-in CtrlZebra Tool.</p>
          )}
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
              <legend className={styles.label}>Arguments</legend>
              <pre className={styles.code}>{formatJson(toolCall.call.input)}</pre>
            </fieldset>
          )}

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
  if (formatted.length <= 1200) {
    return formatted;
  }
  return `${formatted.slice(0, 1200)}\n… (truncated)`;
}
