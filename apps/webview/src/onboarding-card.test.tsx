import {
  type ProviderAction,
  type ProviderActionMessage,
  type ProviderStatusMessage,
  protocolVersion,
} from "@ctrl-zebra/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OnboardingCard } from "./onboarding-card.js";

const statuses: readonly ProviderStatusMessage[] = [
  {
    protocolVersion,
    type: "extension/provider-status",
    requestId: "status-openai",
    provider: "openai",
    apiKeyConfigured: false,
    modelConfigured: false,
  },
  {
    protocolVersion,
    type: "extension/provider-status",
    requestId: "status-gemini",
    provider: "gemini",
    apiKeyConfigured: true,
    modelConfigured: false,
  },
  {
    protocolVersion,
    type: "extension/provider-status",
    requestId: "status-compatible",
    provider: "openai-compatible",
    apiKeyConfigured: true,
    modelConfigured: true,
  },
];

function renderCard(
  status: ProviderStatusMessage | undefined,
  onAction: (action: ProviderAction) => boolean = () => true,
  actionOutcome?: ProviderActionMessage,
) {
  return render(
    <OnboardingCard
      status={status}
      announcement="Provider status announcement."
      actionOutcome={actionOutcome}
      onAction={onAction}
      onSelectPrompt={() => {}}
    />,
  );
}

describe("OnboardingCard", () => {
  it.each([
    ["OpenAI", statuses[0], true],
    ["Gemini", statuses[1], false],
    ["OpenAI-Compatible", statuses[2], false],
  ])("renders bounded setup status for %s", (providerLabel, status, showSave) => {
    renderCard(status);

    expect(screen.getByRole("heading", { name: `${providerLabel} setup` })).toBeVisible();
    if (showSave) {
      expect(screen.getByRole("button", { name: "Save API key" })).toBeEnabled();
    } else {
      expect(screen.queryByRole("button", { name: "Save API key" })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Select model" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Open Provider settings" })).toBeEnabled();
  });

  it("disables actions while status is loading and restores focus after a terminal outcome", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn(() => true);
    const view = renderCard(undefined, onAction);
    expect(screen.queryByRole("button", { name: "Save API key" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select model" })).toBeDisabled();

    view.rerender(
      <OnboardingCard
        status={statuses[0]}
        announcement="Provider status announcement."
        onAction={onAction}
        onSelectPrompt={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: "Save API key" });
    await user.click(button);
    expect(onAction).toHaveBeenCalledWith("save-key");

    view.rerender(
      <OnboardingCard
        status={statuses[0]}
        announcement="Save API key completed."
        actionOutcome={{
          protocolVersion,
          type: "extension/provider-action",
          requestId: "action-1",
          action: "save-key",
          status: "completed",
        }}
        onAction={onAction}
        onSelectPrompt={() => {}}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save API key" }));
  });

  it("moves focus to the heading when a completed save removes its trigger", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn(() => true);
    const view = renderCard(statuses[0], onAction);
    await user.click(screen.getByRole("button", { name: "Save API key" }));

    view.rerender(
      <OnboardingCard
        status={{ ...statuses[0], apiKeyConfigured: true }}
        announcement="Save API key completed."
        actionOutcome={{
          protocolVersion,
          type: "extension/provider-action",
          requestId: "action-2",
          action: "save-key",
          status: "completed",
        }}
        onAction={onAction}
        onSelectPrompt={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "Save API key" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Welcome to CtrlZebra" }),
    );
  });

  it("uses local failure copy instead of rendering host error text", () => {
    renderCard(statuses[1], () => true, {
      protocolVersion,
      type: "extension/provider-action",
      requestId: "action-1",
      action: "select-model",
      status: "failed",
      code: "internal",
      message: "raw host detail",
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Provider action failed unexpectedly. Try again.",
    );
    expect(screen.queryByText("raw host detail")).not.toBeInTheDocument();
  });
});
