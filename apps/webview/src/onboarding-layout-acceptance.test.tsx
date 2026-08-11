import {
  type ProviderAction,
  type ProviderStatusMessage,
  protocolVersion,
} from "@ctrl-zebra/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { OnboardingCard } from "./onboarding-card.js";

const onboardingCss = readFileSync(
  join(
    process.cwd().endsWith("apps\\webview")
      ? process.cwd()
      : join(process.cwd(), "apps", "webview"),
    "src",
    "onboarding-card.module.css",
  ),
  "utf8",
);

const themeMatrix = [
  ["light", "#ffffff", "#1f1f1f"],
  ["dark", "#1f1f1f", "#ffffff"],
  ["high-contrast", "#000000", "#ffffff"],
  ["high-contrast-light", "#ffffff", "#000000"],
] as const;

const noConfigStatus: ProviderStatusMessage = {
  protocolVersion,
  type: "extension/provider-status",
  requestId: "acceptance-status",
  provider: "openai",
  apiKeyConfigured: false,
  modelConfigured: false,
};

describe("Onboarding responsive and theme acceptance matrix", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--vscode-sideBar-background");
    document.documentElement.style.removeProperty("--vscode-editor-foreground");
    document.documentElement.style.removeProperty("width");
    document.documentElement.style.removeProperty("zoom");
  });

  it.each(
    themeMatrix,
  )("keeps required actions and missing copy available for the %s theme", (theme, background, foreground) => {
    document.documentElement.style.setProperty("--vscode-sideBar-background", background);
    document.documentElement.style.setProperty("--vscode-editor-foreground", foreground);
    render(
      <OnboardingCard
        status={noConfigStatus}
        announcement={`${theme} status`}
        onAction={(_action: ProviderAction) => true}
        onSelectPrompt={() => {}}
      />,
    );

    expect(screen.getByText("Finish API key and model setup to start a chat.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save API key" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Select model" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Provider settings" })).toBeVisible();
  });

  it("keeps the primary controls keyboard reachable at 300px and 200% text scale", async () => {
    document.documentElement.style.width = "300px";
    document.documentElement.style.zoom = "2";
    const user = userEvent.setup();
    render(
      <OnboardingCard
        status={noConfigStatus}
        announcement="Responsive status"
        onAction={(_action: ProviderAction) => true}
        onSelectPrompt={() => {}}
      />,
    );

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save API key" }));
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "Save API key" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Select model" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Provider settings" })).toBeVisible();
    expect(onboardingCss).toContain("@media (max-width: 26rem)");
    expect(onboardingCss).toContain("min-width: 0");
    expect(onboardingCss).toContain("var(--cz-color-error-fg)");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
