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
});
