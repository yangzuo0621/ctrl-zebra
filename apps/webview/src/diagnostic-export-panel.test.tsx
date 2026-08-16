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
    store.setState({
      status: "ready",
      requestId: "request-1",
      exportId: "export-1",
      target: "file:///tmp/diagnostics.json",
      document: {
        formatVersion: 1,
        extensionVersion: "0.1.1",
        vscodeVersion: "1.125.0",
        platform: "linux",
        provider: "openai",
        errors: [],
        mcp: { status: "unconfigured", generation: 0 },
        runtime: { activationDurationMs: 1, memoryBytes: 2, runStatus: "idle" },
      },
    });

    render(<DiagnosticsExportPanel store={store} />);

    expect(screen.getByText("file:///tmp/diagnostics.json")).toBeVisible();
    expect(screen.getByLabelText("Redacted diagnostics content")).toHaveTextContent(
      '"extensionVersion": "0.1.1"',
    );
    await user.click(screen.getByRole("button", { name: "Save file" }));
    expect(host.confirmDiagnosticsExport).toHaveBeenCalledWith("request-1", "export-1");
  });
});
