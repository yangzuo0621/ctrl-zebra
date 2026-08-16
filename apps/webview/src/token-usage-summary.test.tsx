import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TokenUsageSummary } from "./token-usage-summary.js";

describe("TokenUsageSummary", () => {
  it("does not show a placeholder while a response is still running", () => {
    render(<TokenUsageSummary usage={undefined} status="streaming" />);

    expect(screen.queryByRole("complementary", { name: "Provider token usage" })).toBeNull();
  });

  it("labels partial actual provider usage and preserves unknown fields", () => {
    render(
      <TokenUsageSummary usage={{ inputTokens: 1_234, totalTokens: 2_000 }} status="completed" />,
    );

    expect(screen.getByRole("complementary", { name: "Provider token usage" })).toBeVisible();
    expect(screen.getByText("Provider usage (partial)")).toBeVisible();
    expect(screen.getByText("Input: 1,234")).toBeVisible();
    expect(screen.getByText("Output: —")).toBeVisible();
    expect(screen.getByText("Total: 2,000")).toBeVisible();
  });

  it("explains when a terminal response has no provider usage", () => {
    render(<TokenUsageSummary usage={undefined} status="cancelled" />);

    expect(screen.getByText("Unavailable for this response.")).toBeVisible();
  });

  it("explains when a truncated response has no provider usage", () => {
    render(<TokenUsageSummary usage={undefined} status="truncated" />);

    expect(screen.getByText("Unavailable for this response.")).toBeVisible();
  });

  it("shows estimate and actual token guardrail state without calling it a bill", () => {
    render(
      <TokenUsageSummary
        usage={undefined}
        status="budget-exceeded"
        runBudget={{
          state: "exceeded",
          source: "actual",
          maxTokens: 100,
          warningTokens: 80,
          estimatedTokens: 70,
          actualTokens: 100,
          effectiveTokens: 100,
        }}
      />,
    );

    expect(screen.getByText("Run token limit reached")).toBeVisible();
    expect(screen.getByText("Estimated: 70 / Limit: 100")).toBeVisible();
    expect(screen.getByText("Provider actual: 100")).toBeVisible();
    expect(screen.queryByText(/bill/i)).toBeNull();
  });
});
