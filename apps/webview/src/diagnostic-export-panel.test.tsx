import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DiagnosticsExportPanel } from "./diagnostic-export-panel.js";
import { createDiagnosticsExportStore } from "./diagnostic-export-store.js";
import { createWebviewHostFixture } from "./test/support/webview-host.js";

describe("DiagnosticsExportPanel", () => {
  it("shows the target and complete bounded content before save", async () => {
    const user = userEvent.setup();
    const host = createWebviewHostFixture();
    host.requestDiagnosticsExport = vi.fn();
    host.confirmDiagnosticsExport = vi.fn();
    const store = createDiagnosticsExportStore(host, () => "request-1");
    const document = {
      formatVersion: 1 as const,
      extensionVersion: "0.1.1",
      vscodeVersion: "1.125.0",
      platform: "linux" as const,
      provider: "openai" as const,
      errors: [],
      mcp: { status: "unconfigured" as const, generation: 0 },
      runtime: { activationDurationMs: 1, memoryBytes: 2, runStatus: "idle" as const },
    };
    const content = `${JSON.stringify(document)}\n`;
    store.setState({
      status: "ready",
      requestId: "request-1",
      exportId: "export-1",
      target: "file:///tmp/diagnostics.json",
      document,
      content,
    });

    render(<DiagnosticsExportPanel store={store} />);

    expect(screen.getByText("file:///tmp/diagnostics.json")).toBeVisible();
    expect(
      screen.getByLabelText("Redacted diagnostics content").querySelector("pre")?.textContent,
    ).toBe(content);
    await user.click(screen.getByRole("button", { name: "Save file" }));
    expect(host.confirmDiagnosticsExport).toHaveBeenCalledWith("request-1", "export-1");
  });
});
