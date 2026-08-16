import type { CancellationToken, Disposable } from "vscode";

import {
  ApiKeySecretStorageError,
  type ProviderApiKeySecretReader,
} from "../adapters/api-key-secret-storage.js";
import {
  type ProviderConfiguration,
  ProviderConfigurationError,
  type ProviderId,
} from "../adapters/provider-configuration.js";
import {
  ProviderEndpointPolicyError,
  providerEndpointPolicy,
} from "../adapters/provider-endpoint-policy.js";
import { isRecord } from "../adapters/record-validation.js";
import { ProviderApiKeyOperationCoordinator } from "./provider-api-key-command.js";

export const checkProviderConnectionCommandId = "ctrlZebra.checkProviderConnection";

export const providerConnectionCheckStatuses = ["supported", "unsupported", "unknown"] as const;
export type ProviderConnectionCheckStatus = (typeof providerConnectionCheckStatuses)[number];

export const providerConnectionCheckErrorCodes = [
  "authentication",
  "model-not-found",
  "rate-limit",
  "timeout",
  "cancelled",
  "network",
  "malformed",
  "configuration",
  "unknown",
] as const;
export type ProviderConnectionCheckErrorCode = (typeof providerConnectionCheckErrorCodes)[number];

export interface ProviderConnectionCheckCapabilities {
  readonly textStreaming: ProviderConnectionCheckStatus;
  readonly toolCalling: ProviderConnectionCheckStatus;
  readonly required: ProviderConnectionCheckStatus;
}

export type ProviderConnectionCheckGuidance = "provider-documentation";

export interface ProviderConnectionCheckReport {
  readonly provider: ProviderId;
  readonly modelId: string;
  readonly authentication: ProviderConnectionCheckStatus;
  readonly modelExistence: ProviderConnectionCheckStatus;
  readonly capabilities: ProviderConnectionCheckCapabilities;
  readonly outcome: "completed" | "failed" | "cancelled";
  readonly errorCode?: ProviderConnectionCheckErrorCode;
  readonly guidance?: ProviderConnectionCheckGuidance;
}

export interface ProviderConnectionCheckLogEntry {
  readonly event: "provider_connection_check";
  readonly component: "provider";
  readonly outcome: "success" | "failure" | "cancelled";
  readonly errorCode?: ProviderConnectionCheckErrorCode;
  readonly provider: ProviderId;
  readonly durationMs: number;
}

export interface ProviderConnectionCheckOptions {
  readonly configuration: ProviderConfiguration;
  readonly secrets: ProviderApiKeySecretReader;
  readonly providerApiKeyCoordinator?: ProviderApiKeyOperationCoordinator;
  readonly fetch?: typeof fetch;
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
}

export interface RegisterProviderConnectionCheckOptions {
  readonly registerCommand: (
    commandId: string,
    handler: () => Promise<ProviderConnectionCheckReport | undefined>,
  ) => Disposable;
  readonly readConfiguration: () => ProviderConfiguration;
  readonly secrets: ProviderApiKeySecretReader;
  readonly providerApiKeyCoordinator?: ProviderApiKeyOperationCoordinator;
  readonly fetch?: typeof fetch;
  readonly runWithProgress: <T>(task: (token: CancellationToken) => Thenable<T>) => Thenable<T>;
  readonly showInformationMessage: (message: string) => Thenable<unknown>;
  readonly showErrorMessage: (message: string) => Thenable<unknown>;
  readonly now?: () => number;
  readonly log?: (entry: ProviderConnectionCheckLogEntry) => void;
}

const maxResponseBodyBytes = 64 * 1024;
const maxCapabilityEntries = 32;
const maxCapabilityNameCodePoints = 64;
const maxModelIdCodePoints = 256;
const connectionCheckTimeoutMs = 10_000;

const providerLabels = {
  openai: "OpenAI",
  gemini: "Gemini",
  "openai-compatible": "OpenAI-Compatible",
} as const satisfies Record<ProviderId, string>;

const unknownCapabilities: ProviderConnectionCheckCapabilities = {
  textStreaming: "unknown",
  toolCalling: "unknown",
  required: "unknown",
};

const cancelledReason = new Error("Provider connection check cancelled.");
const timeoutReason = new Error("Provider connection check timed out.");

interface OperationDeadline {
  readonly signal: AbortSignal;
  dispose(): void;
}

type MetadataTarget =
  | { readonly provider: "openai"; readonly url: string; readonly auth: "bearer" }
  | { readonly provider: "gemini"; readonly url: string; readonly auth: "gemini" }
  | {
      readonly provider: "openai-compatible";
      readonly url: string;
      readonly auth: "optional-bearer";
      readonly requiresApiKey: boolean;
    };

interface ParsedMetadata {
  readonly textStreaming: ProviderConnectionCheckStatus;
  readonly toolCalling: ProviderConnectionCheckStatus;
}

export function registerProviderConnectionCheckCommand({
  registerCommand,
  readConfiguration,
  secrets,
  providerApiKeyCoordinator,
  fetch: fetchMetadata = globalThis.fetch,
  runWithProgress,
  showInformationMessage,
  showErrorMessage,
  now = () => Date.now(),
  log,
}: RegisterProviderConnectionCheckOptions): Disposable {
  return registerCommand(checkProviderConnectionCommandId, async () => {
    let configuration: ProviderConfiguration;
    try {
      configuration = readConfiguration();
    } catch {
      await showErrorMessage(
        "The Provider configuration is invalid. Check the CtrlZebra settings.",
      );
      return undefined;
    }

    const startedAt = now();
    let cancelledDuringProgress = false;
    const report = await runWithProgress(async (token) => {
      const cancellation = createCancellationBridge(token);
      try {
        const checkedReport = await checkProviderConnection({
          configuration,
          secrets,
          providerApiKeyCoordinator,
          fetch: fetchMetadata,
          signal: cancellation.signal,
        });
        if (token.isCancellationRequested && checkedReport.outcome !== "cancelled") {
          cancelledDuringProgress = true;
        }
        return checkedReport;
      } finally {
        cancellation.dispose();
      }
    });
    const effectiveReport = cancelledDuringProgress
      ? { ...report, outcome: "cancelled" as const, errorCode: "cancelled" as const }
      : report;

    const durationMs = boundedDuration(now() - startedAt);
    log?.({
      event: "provider_connection_check",
      component: "provider",
      outcome:
        effectiveReport.outcome === "completed"
          ? "success"
          : effectiveReport.outcome === "failed"
            ? "failure"
            : "cancelled",
      ...(effectiveReport.errorCode === undefined ? {} : { errorCode: effectiveReport.errorCode }),
      provider: effectiveReport.provider,
      durationMs,
    });

    if (effectiveReport.outcome === "cancelled") {
      return effectiveReport;
    }

    if (effectiveReport.errorCode !== undefined && effectiveReport.errorCode !== "unknown") {
      await showErrorMessage(
        connectionCheckErrorMessage(effectiveReport.errorCode, effectiveReport.provider),
      );
      return effectiveReport;
    }

    await showInformationMessage(formatConnectionCheckReport(effectiveReport));
    return effectiveReport;
  });
}

export async function checkProviderConnection({
  configuration,
  secrets,
  providerApiKeyCoordinator,
  fetch: fetchMetadata = globalThis.fetch,
  signal,
  timeoutMs = connectionCheckTimeoutMs,
}: ProviderConnectionCheckOptions): Promise<ProviderConnectionCheckReport> {
  if (!isSafeModelId(configuration.modelId)) {
    return failedReport(configuration, "configuration");
  }

  const deadline = createOperationDeadline(signal, timeoutMs);
  try {
    let target: MetadataTarget | undefined;
    try {
      target = createMetadataTarget(configuration);
    } catch {
      return failedReport(configuration, "configuration");
    }

    if (deadline.signal.aborted) {
      return reportForFailure(
        configuration,
        deadline.signal.reason ?? cancelledReason,
        deadline.signal,
      );
    }

    if (target === undefined) {
      return {
        provider: configuration.provider,
        modelId: configuration.modelId,
        authentication: "unknown",
        modelExistence: "unknown",
        capabilities: unknownCapabilities,
        outcome: "completed",
        errorCode: "unknown",
        guidance: "provider-documentation",
      };
    }

    throwIfAborted(deadline.signal);
    const apiKey = await readApiKey(
      configuration,
      secrets,
      providerApiKeyCoordinator,
      deadline.signal,
    );
    throwIfAborted(deadline.signal);
    const response = await requestMetadata(target, apiKey, fetchMetadata, deadline.signal);
    throwIfAborted(deadline.signal);
    const parsed = parseMetadata(target.provider, configuration.modelId, response);
    return completedReport(
      configuration,
      withRequiredCapability(parsed.textStreaming, parsed.toolCalling),
    );
  } catch (error) {
    return reportForFailure(configuration, error, deadline.signal);
  } finally {
    deadline.dispose();
  }
}

function createMetadataTarget(configuration: ProviderConfiguration): MetadataTarget | undefined {
  const encodedModelId = encodeURIComponent(configuration.modelId);

  if (configuration.provider === "openai") {
    if (configuration.endpoint !== undefined) {
      return undefined;
    }
    return {
      provider: configuration.provider,
      url: `https://api.openai.com/v1/models/${encodedModelId}`,
      auth: "bearer",
    };
  }

  if (configuration.provider === "gemini") {
    if (configuration.endpoint !== undefined) {
      return undefined;
    }
    return {
      provider: configuration.provider,
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodedModelId}`,
      auth: "gemini",
    };
  }

  let endpoint: ReturnType<typeof providerEndpointPolicy.evaluate>;
  try {
    endpoint = providerEndpointPolicy.evaluate(configuration.endpoint);
  } catch (error) {
    if (error instanceof ProviderEndpointPolicyError) {
      throw new ProviderConfigurationError(
        "invalid-endpoint",
        "endpoint",
        "The configured Provider endpoint is invalid.",
      );
    }
    throw error;
  }
  if (endpoint === undefined || configuration.requiresApiKey !== endpoint.requiresApiKey) {
    throw new ProviderConfigurationError(
      "invalid-endpoint",
      "endpoint",
      "The configured Provider endpoint is invalid.",
    );
  }
  const base = new URL(endpoint.value);
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  base.pathname = `${basePath}models/${encodedModelId}`;
  base.search = "";
  base.hash = "";
  return {
    provider: configuration.provider,
    url: base.toString(),
    auth: "optional-bearer",
    requiresApiKey: endpoint.requiresApiKey,
  };
}

async function readApiKey(
  configuration: ProviderConfiguration,
  secrets: ProviderApiKeySecretReader,
  providerApiKeyCoordinator: ProviderApiKeyOperationCoordinator | undefined,
  signal: AbortSignal,
): Promise<string | undefined> {
  throwIfAborted(signal);

  let apiKey: string | undefined;
  try {
    const coordinator = providerApiKeyCoordinator ?? new ProviderApiKeyOperationCoordinator();
    apiKey = await awaitWithAbort(
      coordinator.run(configuration.provider, () => secrets.read(configuration.provider)),
      signal,
    );
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason ?? cancelledReason;
    }
    if (error instanceof ApiKeySecretStorageError) {
      throw new ConnectionCheckFailure("configuration");
    }
    throw new ConnectionCheckFailure("configuration");
  }

  throwIfAborted(signal);
  const normalizedApiKey = apiKey === undefined || apiKey.length === 0 ? undefined : apiKey;
  const required = configuration.provider !== "openai-compatible" || configuration.requiresApiKey;
  if (required && normalizedApiKey === undefined) {
    throw new ConnectionCheckFailure("authentication");
  }
  return normalizedApiKey;
}

async function requestMetadata(
  target: MetadataTarget,
  apiKey: string | undefined,
  fetchMetadata: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (target.auth === "gemini") {
    if (apiKey === undefined) {
      throw new ConnectionCheckFailure("authentication");
    }
    headers["x-goog-api-key"] = apiKey;
  } else if (apiKey !== undefined) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let response: Response;
  try {
    response = await awaitWithAbort(
      fetchMetadata(target.url, {
        method: "GET",
        headers,
        redirect: "error",
        signal,
      }),
      signal,
    );
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason ?? error;
    }
    throw new ConnectionCheckFailure("network");
  }

  throwIfAborted(signal);
  if (!response.ok) {
    cancelResponseBody(response);
    throw new ConnectionCheckFailure(classifyHttpStatus(response.status));
  }
  if (response.status !== 200) {
    cancelResponseBody(response);
    throw new ConnectionCheckFailure("unknown");
  }

  return await readBoundedResponseBody(response, signal);
}

function parseMetadata(provider: ProviderId, modelId: string, body: string): ParsedMetadata {
  let document: unknown;
  try {
    document = JSON.parse(body) as unknown;
  } catch {
    throw new ConnectionCheckFailure("malformed");
  }

  if (!isRecord(document)) {
    throw new ConnectionCheckFailure("malformed");
  }

  if (provider === "gemini") {
    const name = document.name;
    if (name !== `models/${modelId}`) {
      throw new ConnectionCheckFailure("malformed");
    }

    return {
      textStreaming: readGeminiStreamingCapability(document.supportedGenerationMethods),
      toolCalling: "unknown",
    };
  }

  if (document.id !== modelId) {
    throw new ConnectionCheckFailure("malformed");
  }

  return {
    textStreaming: "unknown",
    toolCalling: "unknown",
  };
}

function readGeminiStreamingCapability(value: unknown): ProviderConnectionCheckStatus {
  if (!Array.isArray(value) || value.length > maxCapabilityEntries) {
    return "unknown";
  }

  const capabilities = new Set<string>();
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.trim() !== entry ||
      [...entry].length > maxCapabilityNameCodePoints ||
      entry.includes("\0") ||
      entry.includes("\r") ||
      entry.includes("\n")
    ) {
      return "unknown";
    }
    if (capabilities.has(entry)) {
      return "unknown";
    }
    capabilities.add(entry);
  }

  return capabilities.has("streamGenerateContent") ? "supported" : "unsupported";
}

async function readBoundedResponseBody(response: Response, signal: AbortSignal): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isSafeInteger(declaredLength) && declaredLength > maxResponseBodyBytes) {
      cancelResponseBody(response);
      throw new ConnectionCheckFailure("malformed");
    }
  }

  if (response.body === null) {
    throw new ConnectionCheckFailure("malformed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await awaitWithAbort(reader.read(), signal);
      if (done) {
        break;
      }
      if (!(value instanceof Uint8Array)) {
        throw new ConnectionCheckFailure("malformed");
      }
      bytesRead += value.byteLength;
      if (bytesRead > maxResponseBodyBytes) {
        void reader.cancel().catch(() => undefined);
        throw new ConnectionCheckFailure("malformed");
      }
      try {
        chunks.push(decoder.decode(value, { stream: true }));
      } catch {
        throw new ConnectionCheckFailure("malformed");
      }
    }
    try {
      chunks.push(decoder.decode());
    } catch {
      throw new ConnectionCheckFailure("malformed");
    }
    return chunks.join("");
  } catch (error) {
    if (error instanceof ConnectionCheckFailure) {
      throw error;
    }
    if (signal.aborted) {
      void reader.cancel().catch(() => undefined);
      throw signal.reason ?? cancelledReason;
    }
    throw new ConnectionCheckFailure("network");
  } finally {
    reader.releaseLock();
  }
}

function cancelResponseBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

function classifyHttpStatus(status: number): ProviderConnectionCheckErrorCode {
  if (status === 401 || status === 403) return "authentication";
  if (status === 404) return "model-not-found";
  if (status === 429) return "rate-limit";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500 && status <= 599) return "network";
  return "unknown";
}

function reportForFailure(
  configuration: ProviderConfiguration,
  error: unknown,
  signal: AbortSignal,
): ProviderConnectionCheckReport {
  const errorCode = readFailureCode(error, signal);
  const authentication = errorCode === "authentication" ? "unsupported" : "unknown";
  const modelExistence = errorCode === "model-not-found" ? "unsupported" : "unknown";
  return {
    provider: configuration.provider,
    modelId: configuration.modelId,
    authentication,
    modelExistence,
    capabilities: unknownCapabilities,
    outcome: errorCode === "cancelled" ? "cancelled" : "failed",
    errorCode,
  };
}

function readFailureCode(error: unknown, signal: AbortSignal): ProviderConnectionCheckErrorCode {
  if (signal.aborted) {
    return signal.reason === timeoutReason ? "timeout" : "cancelled";
  }
  if (error instanceof ConnectionCheckFailure) {
    return error.code;
  }
  if (error === timeoutReason) return "timeout";
  if (error === cancelledReason) return "cancelled";
  return "unknown";
}

function completedReport(
  configuration: ProviderConfiguration,
  capabilities: ProviderConnectionCheckCapabilities,
  errorCode?: ProviderConnectionCheckErrorCode,
): ProviderConnectionCheckReport {
  return {
    provider: configuration.provider,
    modelId: configuration.modelId,
    authentication: "supported",
    modelExistence: "supported",
    capabilities,
    outcome: "completed",
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

function failedReport(
  configuration: ProviderConfiguration,
  errorCode: ProviderConnectionCheckErrorCode,
): ProviderConnectionCheckReport {
  return {
    provider: configuration.provider,
    modelId: configuration.modelId,
    authentication: errorCode === "authentication" ? "unsupported" : "unknown",
    modelExistence: "unknown",
    capabilities: unknownCapabilities,
    outcome: "failed",
    errorCode,
  };
}

function withRequiredCapability(
  textStreaming: ProviderConnectionCheckStatus,
  toolCalling: ProviderConnectionCheckStatus,
): ProviderConnectionCheckCapabilities {
  const required =
    textStreaming === "unsupported" || toolCalling === "unsupported"
      ? "unsupported"
      : textStreaming === "supported" && toolCalling === "supported"
        ? "supported"
        : "unknown";
  return { textStreaming, toolCalling, required };
}

function formatConnectionCheckReport(report: ProviderConnectionCheckReport): string {
  const providerLabel = providerLabels[report.provider];
  const summary = `${providerLabel} connection check for model ${formatModelId(report.modelId)}: Authentication ${report.authentication}; Model ${report.modelExistence}; Streaming ${report.capabilities.textStreaming}; Tool Calling ${report.capabilities.toolCalling}; Required capabilities ${report.capabilities.required}.`;
  if (report.guidance === "provider-documentation") {
    return `${summary} The configured dedicated Provider endpoint was not probed. Check the ${providerLabel} service documentation for its model metadata route and authentication.`;
  }
  return summary;
}

function connectionCheckErrorMessage(
  code: ProviderConnectionCheckErrorCode,
  provider: ProviderId,
): string {
  const providerLabel = providerLabels[provider];
  switch (code) {
    case "authentication":
      return `${providerLabel} rejected the saved API key. Check the key and try again.`;
    case "model-not-found":
      return `${providerLabel} could not find the configured model. Check the model ID.`;
    case "rate-limit":
      return `${providerLabel} rate-limited the connection check. Try again later.`;
    case "timeout":
      return `${providerLabel} connection check timed out. Try again.`;
    case "network":
      return `Unable to reach ${providerLabel}. Check the endpoint and try again.`;
    case "malformed":
      return `${providerLabel} returned an unusable connection-check response.`;
    case "configuration":
      return "The Provider configuration or saved API key could not be read. Check CtrlZebra settings.";
    case "cancelled":
      return "Provider connection check cancelled.";
    case "unknown":
      return `${providerLabel} connection check returned an unknown result. Check the Provider settings.`;
  }
}

function createCancellationBridge(token: CancellationToken): {
  readonly signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const subscription = token.onCancellationRequested(() => controller.abort(cancelledReason));
  if (token.isCancellationRequested) {
    controller.abort(cancelledReason);
  }
  return {
    signal: controller.signal,
    dispose() {
      subscription.dispose();
    },
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? cancelledReason;
  }
}

function isSafeModelId(value: string): boolean {
  return (
    value.length > 0 &&
    value.trim() === value &&
    [...value].length <= maxModelIdCodePoints &&
    !value.includes("\0") &&
    !value.includes("\r") &&
    !value.includes("\n")
  );
}

function formatModelId(value: string): string {
  let formatted = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    formatted += codePoint <= 0x1f || codePoint === 0x7f ? "�" : character;
  }
  return formatted;
}

function createOperationDeadline(
  externalSignal: AbortSignal,
  timeoutMs: number,
): OperationDeadline {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(timeoutReason), timeoutMs);
  const onExternalAbort = () => controller.abort(externalSignal.reason ?? cancelledReason);
  externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  if (externalSignal.aborted) {
    onExternalAbort();
  }

  let disposed = false;
  return {
    signal: controller.signal,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeoutHandle);
      externalSignal.removeEventListener("abort", onExternalAbort);
    },
  };
}

async function awaitWithAbort<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw signal.reason ?? cancelledReason;
  }

  let abortHandler: (() => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    abortHandler = () => reject(signal.reason ?? cancelledReason);
    signal.addEventListener("abort", abortHandler, { once: true });
  });

  try {
    return await Promise.race([Promise.resolve(operation), abortPromise]);
  } finally {
    if (abortHandler !== undefined) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

function boundedDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.round(value), 600_000);
}

class ConnectionCheckFailure extends Error {
  constructor(readonly code: ProviderConnectionCheckErrorCode) {
    super("Provider connection check failed.");
    this.name = "ConnectionCheckFailure";
  }
}
