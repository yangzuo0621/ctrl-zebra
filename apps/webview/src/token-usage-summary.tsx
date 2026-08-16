import type { RunTokenBudgetSnapshot, TokenUsage } from "@ctrl-zebra/protocol";

import styles from "./app.module.css";
import { strings } from "./strings.js";

interface TokenUsageSummaryProps {
  readonly usage: TokenUsage | undefined;
  readonly runBudget?: RunTokenBudgetSnapshot;
  readonly status: string;
}

const terminalStatuses = new Set([
  "completed",
  "cancelled",
  "failed",
  "interrupted",
  "truncated",
  "budget-exceeded",
]);

export function TokenUsageSummary({ usage, runBudget, status }: TokenUsageSummaryProps) {
  if (usage === undefined && runBudget === undefined && !terminalStatuses.has(status)) {
    return null;
  }

  if (usage === undefined && runBudget === undefined) {
    return (
      <aside className={styles.tokenUsage} aria-label={strings.tokenUsage.label}>
        <span className={styles.tokenUsageTitle}>{strings.tokenUsage.title}</span>
        <span className={styles.tokenUsageUnavailable}>{strings.tokenUsage.unavailable}</span>
      </aside>
    );
  }

  const complete =
    usage !== undefined &&
    usage.inputTokens !== undefined &&
    usage.outputTokens !== undefined &&
    usage.totalTokens !== undefined;

  return (
    <aside className={styles.tokenUsage} aria-label={strings.tokenUsage.label}>
      {usage === undefined ? (
        <>
          <span className={styles.tokenUsageTitle}>{strings.tokenUsage.title}</span>
          <span className={styles.tokenUsageUnavailable}>{strings.tokenUsage.unavailable}</span>
        </>
      ) : (
        <>
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
        </>
      )}
      {runBudget === undefined ? null : (
        <>
          <span className={styles.tokenUsageTitle}>
            {runBudget.state === "warning"
              ? strings.tokenUsage.runBudgetWarning
              : strings.tokenUsage.runBudgetExceeded}
          </span>
          <span>
            {strings.tokenUsage.estimated}: {formatTokenCount(runBudget.estimatedTokens)} /{" "}
            {strings.tokenUsage.limit}: {formatTokenCount(runBudget.maxTokens)}
          </span>
          {runBudget.actualTokens === undefined ? null : (
            <span>
              {strings.tokenUsage.actual}: {formatTokenCount(runBudget.actualTokens)}
            </span>
          )}
        </>
      )}
    </aside>
  );
}

function formatTokenCount(value: number | undefined): string {
  return value === undefined ? strings.tokenUsage.unknown : value.toLocaleString();
}
