import type { ApprovalDecisionIntent } from "@ctrl-zebra/protocol";

import styles from "./approval-card.module.css";
import type { DisplayApproval } from "./approval-store.js";
import { strings } from "./strings.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";

export interface ApprovalCardProps {
  readonly item: DisplayApproval;
  readonly pendingDecision?: ApprovalDecisionIntent;
  readonly embedded?: boolean;
  readonly onViewDiff: () => void;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}

export function ApprovalCard({
  item,
  pendingDecision,
  embedded = false,
  onViewDiff,
  onApprove,
  onReject,
}: ApprovalCardProps) {
  const interactive = item.status === "pending" && pendingDecision === undefined;
  const commandApproval =
    item.approval.scope.risk === "execute" && item.approval.scope.call.name === "run_command";
  const titleId = `approval-${item.approval.id}-title`;
  const visibleStatus =
    pendingDecision === "approved"
      ? strings.approval.submittingApproval
      : pendingDecision === "denied"
        ? strings.approval.submittingRejection
        : item.status === "consumed" && commandApproval
          ? strings.approval.approvedCommandStarted
          : strings.approval.status[item.status];

  const cardClassName = embedded ? styles.embeddedCard : styles.card;
  const accessibleLabel = commandApproval
    ? strings.approval.commandApproval
    : strings.approval.fileChangeApproval;

  return (
    <article
      className={cardClassName}
      aria-label={`${accessibleLabel}: ${item.approval.presentation.title}`}
    >
      {embedded ? (
        <div className={styles.embeddedHeader}>
          <span className={styles.detailLabel}>{strings.approval.riskLevel}</span>
          <Badge variant={item.approval.scope.risk === "execute" ? "error" : "warning"}>
            {strings.approval.risk[item.approval.scope.risk]}
          </Badge>
        </div>
      ) : (
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>
              {commandApproval
                ? strings.approval.commandApproval
                : strings.approval.fileChangeApproval}
            </p>
            <h2 className={styles.title} id={titleId}>
              {item.approval.presentation.title}
            </h2>
          </div>
          <Badge variant={item.approval.scope.risk === "execute" ? "error" : "warning"}>
            {strings.approval.risk[item.approval.scope.risk]}
          </Badge>
        </header>
      )}

      {commandApproval ? (
        <pre className={styles.commandSummary}>
          {formatSummary(item.approval.presentation.summary)}
        </pre>
      ) : (
        <p className={styles.summary}>{formatSummary(item.approval.presentation.summary)}</p>
      )}

      <div className={styles.details}>
        <span className={styles.detailLabel}>
          {commandApproval ? strings.approval.workingDirectory : strings.approval.targetFiles}
        </span>
        <ul className={styles.resources}>
          {item.approval.scope.resources.map((resource) => (
            <li key={resource.uri}>
              <code>{formatResourceUri(resource.uri)}</code>
            </li>
          ))}
        </ul>
        <span className={styles.detailLabel}>{strings.approval.expires}</span>
        <time dateTime={item.approval.expiresAt}>{formatExpiryTime(item.approval.expiresAt)}</time>
      </div>

      <p className={styles.status} role="status" aria-live="polite">
        {visibleStatus}
      </p>

      <div className={styles.actions}>
        {commandApproval ? null : (
          <Button variant="secondary" onClick={onViewDiff} disabled={!interactive}>
            {strings.approval.viewDiff}
          </Button>
        )}
        <Button variant="secondary" onClick={onReject} disabled={!interactive}>
          {strings.approval.reject}
        </Button>
        <Button variant="primary" onClick={onApprove} disabled={!interactive}>
          {strings.approval.approve}
        </Button>
      </div>
    </article>
  );
}

export function formatResourceUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const cleanPath = decoded.replace(/^file:\/\/\/?/i, "");
    return cleanPath.replace(/\\/g, "/");
  } catch {
    return uri;
  }
}

export function formatSummary(summary: string): string {
  return summary.replace(/file:\/\/\/[^\s]+/g, (match) => formatResourceUri(match));
}

export function formatExpiryTime(expiresAt: string): string {
  try {
    const date = new Date(expiresAt);
    if (Number.isNaN(date.getTime())) {
      return expiresAt;
    }
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return expiresAt;
  }
}
