import { describe, expect, it, vi } from "vitest";

import { createStructuredLogger, formatStructuredLogEntry } from "./structured-logger.js";

describe("structured logger", () => {
  it("writes deterministic structured entries at the selected channel level", () => {
    const channel = createChannel();
    const logger = createStructuredLogger(channel);
    const entry = {
      approvalId: "approval-1",
      attempt: 2,
      component: "agent_runtime",
      durationMs: 25,
      event: "tool_execution_completed",
      outcome: "success",
      runId: "run-1",
      sessionId: "session-1",
    };

    logger.trace(entry);
    logger.debug(entry);
    logger.info(entry);
    logger.warn(entry);
    logger.error(entry);

    const expected =
      '{"event":"tool_execution_completed","component":"agent_runtime","outcome":"success","sessionId":"session-1","runId":"run-1","approvalId":"approval-1","durationMs":25,"attempt":2}';
    expect(channel.trace).toHaveBeenCalledWith(expected);
    expect(channel.debug).toHaveBeenCalledWith(expected);
    expect(channel.info).toHaveBeenCalledWith(expected);
    expect(channel.warn).toHaveBeenCalledWith(expected);
    expect(channel.error).toHaveBeenCalledWith(expected);
  });

  it("excludes unknown content and redacts credential-like values", () => {
    const rendered = formatStructuredLogEntry({
      event: "provider_request_failed",
      component: "provider",
      requestId: "Bearer test-authorization-header",
      sessionId: "test-user-secret",
      toolCallId: "sk-test-openai-api-key",
      authorization: "Bearer nested-secret",
      prompt: "private user source",
      cause: new Error("third-party secret-token"),
    });

    expect(rendered).toBe(
      '{"event":"provider_request_failed","component":"provider","sessionId":"[REDACTED]","requestId":"[REDACTED]","toolCallId":"[REDACTED]"}',
    );
    expect(rendered).not.toContain("test-authorization-header");
    expect(rendered).not.toContain("test-user-secret");
    expect(rendered).not.toContain("test-openai-api-key");
    expect(rendered).not.toContain("private user source");
    expect(rendered).not.toContain("third-party secret-token");
  });

  it("uses a safe stable entry for malformed required fields without invoking getters", () => {
    const input = Object.defineProperty(
      { component: "provider", event: "not-kebab-case" },
      "cause",
      {
        get() {
          throw new Error("getter secret");
        },
      },
    );

    const rendered = formatStructuredLogEntry(input);

    expect(rendered).toBe(
      '{"event":"invalid_log_entry","component":"structured_logger","outcome":"rejected","errorCode":"invalid_entry"}',
    );
    expect(rendered).not.toContain("getter secret");
  });

  it("uses a safe stable entry when an untrusted object cannot be inspected", () => {
    const input = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("proxy secret");
        },
      },
    );

    const rendered = formatStructuredLogEntry(input);

    expect(rendered).toBe(
      '{"event":"invalid_log_entry","component":"structured_logger","outcome":"rejected","errorCode":"invalid_entry"}',
    );
    expect(rendered).not.toContain("proxy secret");
  });

  it("disposes the owned output channel", () => {
    const channel = createChannel();
    const logger = createStructuredLogger(channel);

    logger.dispose();

    expect(channel.dispose).toHaveBeenCalledOnce();
  });
});

function createChannel() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    dispose: vi.fn(),
  };
}
