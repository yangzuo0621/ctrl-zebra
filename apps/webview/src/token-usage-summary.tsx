import type { TokenUsage } from "@ctrl-zebra/protocol";

import styles from "./app.module.css";

interface TokenUsageSummaryProps {
  readonly usage: TokenUsage | undefined;
  readonly status: string;
}

const terminalStatuses = new Set(["completed", "cancelled", "failed", "interrupted", "truncated"]);

export function TokenUsageSummary({ usage, status }: TokenUsageSummaryProps) {
  if (usage === undefined && !terminalStatuses.has(status)) {
    return null;
  }

  if (usage === undefined) {
    return (
      <aside className={styles.tokenUsage} aria-label="Provider token usage">
        <span className={styles.tokenUsageTitle}>Provider usage</span>
        <span className={styles.tokenUsageUnavailable}>Unavailable for this response.</span>
      </aside>
    );
  }

  const complete =
    usage.inputTokens !== undefined &&
    usage.outputTokens !== undefined &&
    usage.totalTokens !== undefined;

  return (
    <aside className={styles.tokenUsage} aria-label="Provider token usage">
      <span className={styles.tokenUsageTitle}>Provider usage{complete ? "" : " (partial)"}</span>
      <span>Input: {formatTokenCount(usage.inputTokens)}</span>
      <span>Output: {formatTokenCount(usage.outputTokens)}</span>
      <span>Total: {formatTokenCount(usage.totalTokens)}</span>
    </aside>
  );
}

function formatTokenCount(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString();
}
