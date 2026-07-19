import type { ApprovalDecisionIntent } from "@ctrl-zebra/protocol";
import styles from "./approval-card.module.css";
import type { DisplayApproval } from "./approval-store.js";

interface ApprovalCardProps {
  readonly item: DisplayApproval;
  readonly pendingDecision?: ApprovalDecisionIntent;
  readonly onViewDiff: () => void;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}

const statusText = {
  pending: "Awaiting your decision.",
  approved: "Approved.",
  denied: "Rejected.",
  cancelled: "Approval cancelled.",
  expired: "Approval expired.",
  invalidated: "Approval invalidated because the operation changed.",
  consumed: "Approved change applied.",
} as const;

export function ApprovalCard({
  item,
  pendingDecision,
  onViewDiff,
  onApprove,
  onReject,
}: ApprovalCardProps) {
  const interactive = item.status === "pending" && pendingDecision === undefined;
  const titleId = `approval-${item.approval.id}-title`;
  const visibleStatus =
    pendingDecision === "approved"
      ? "Submitting approval…"
      : pendingDecision === "denied"
        ? "Submitting rejection…"
        : statusText[item.status];

  return (
    <article className={styles.card} aria-labelledby={titleId}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>File change approval</p>
          <h2 className={styles.title} id={titleId}>
            {item.approval.presentation.title}
          </h2>
        </div>
        <span className={styles.risk}>{item.approval.scope.risk}</span>
      </header>

      <p className={styles.summary}>{item.approval.presentation.summary}</p>

      <div className={styles.details}>
        <span className={styles.detailLabel}>Target files</span>
        <ul className={styles.resources}>
          {item.approval.scope.resources.map((resource) => (
            <li key={resource.uri}>{resource.uri}</li>
          ))}
        </ul>
        <span className={styles.detailLabel}>Expires</span>
        <time dateTime={item.approval.expiresAt}>{item.approval.expiresAt}</time>
      </div>

      <p className={styles.status} role="status" aria-live="polite">
        {visibleStatus}
      </p>

      <div className={styles.actions}>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={onViewDiff}
          disabled={!interactive}
        >
          View Diff
        </button>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={onReject}
          disabled={!interactive}
        >
          Reject
        </button>
        <button
          className={styles.primaryButton}
          type="button"
          onClick={onApprove}
          disabled={!interactive}
        >
          Approve
        </button>
      </div>
    </article>
  );
}
