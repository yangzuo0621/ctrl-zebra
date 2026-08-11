import type { TokenUsage } from "@ctrl-zebra/protocol";

import styles from "./app.module.css";
import { strings } from "./strings.js";

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
      <aside className={styles.tokenUsage} aria-label={strings.tokenUsage.label}>
        <span className={styles.tokenUsageTitle}>{strings.tokenUsage.title}</span>
        <span className={styles.tokenUsageUnavailable}>{strings.tokenUsage.unavailable}</span>
      </aside>
    );
  }

  const complete =
    usage.inputTokens !== undefined &&
    usage.outputTokens !== undefined &&
    usage.totalTokens !== undefined;

  return (
    <aside className={styles.tokenUsage} aria-label={strings.tokenUsage.label}>
      <span className={styles.tokenUsageTitle}>
        {strings.tokenUsage.title}
        {complete ? "" : strings.tokenUsage.partial}
      </span>
      <span>
        {strings.tokenUsage.input}: {formatTokenCount(usage.inputTokens)}
      </span>
      <span>
        {strings.tokenUsage.output}: {formatTokenCount(usage.outputTokens)}
      </span>
      <span>
        {strings.tokenUsage.total}: {formatTokenCount(usage.totalTokens)}
      </span>
    </aside>
  );
}

function formatTokenCount(value: number | undefined): string {
  return value === undefined ? strings.tokenUsage.unknown : value.toLocaleString();
}
