import {
  ProviderEndpointPolicyError,
  type ProviderEndpointPolicyResult,
  providerEndpointPolicy,
} from "./provider-endpoint-policy.js";

export const providerIds = ["openai", "gemini", "openai-compatible"] as const;
export type ProviderId = (typeof providerIds)[number];

export const providerCapabilities = ["text-streaming", "tool-calling"] as const;
export type ProviderCapability = (typeof providerCapabilities)[number];

export const providerConfigurationVersion = 1 as const;

const maxProviderModelIdCodePoints = 256;

export const providerSettingNames = {
  capabilities: "capabilities",
  endpoint: "endpoint",
  id: "id",
  model: "model",
} as const;

export interface ConfigurationReader {
  get(setting: string): unknown;
}

export interface ProviderSelectionConfiguration {
  readonly provider: ProviderId;
  readonly modelId?: string;
  readonly endpoint?: string;
}

export interface ProviderOnboardingConfiguration {
  readonly provider: ProviderId;
  readonly modelConfigured: boolean;
  readonly apiKeyRequired: boolean;
  /** False when the optional endpoint setting is malformed or a required compatible endpoint is absent. */
  readonly endpointValid: boolean;
}

interface BaseProviderConfiguration {
  readonly version: typeof providerConfigurationVersion;
  readonly modelId: string;
  readonly endpoint?: string;
  readonly capabilities: readonly ProviderCapability[];
}

export interface OpenAIProviderConfiguration extends BaseProviderConfiguration {
  readonly provider: "openai";
}

export interface GeminiProviderConfiguration extends BaseProviderConfiguration {
  readonly provider: "gemini";
}

export interface OpenAICompatibleProviderConfiguration extends BaseProviderConfiguration {
  readonly provider: "openai-compatible";
  readonly endpoint: string;
  readonly requiresApiKey: boolean;
}

export type ProviderConfiguration =
  | OpenAIProviderConfiguration
  | GeminiProviderConfiguration
  | OpenAICompatibleProviderConfiguration;

export type ProviderConfigurationErrorCode =
  | "unknown-provider"
  | "missing-model"
  | "invalid-model"
  | "missing-endpoint"
  | "invalid-endpoint"
  | "invalid-capabilities";

export class ProviderConfigurationError extends Error {
  constructor(
    readonly code: ProviderConfigurationErrorCode,
    readonly setting: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

const standardProviderCapabilities = ["text-streaming", "tool-calling"] as const;
const defaultCompatibleCapabilities = ["text-streaming"] as const;

export function readProviderConfiguration(reader: ConfigurationReader): ProviderConfiguration {
  const provider = readProviderId(reader.get(providerSettingNames.id));
  const modelId = readModelId(reader.get(providerSettingNames.model));
  const endpoint = readOptionalEndpoint(reader.get(providerSettingNames.endpoint));

  if (provider === "openai-compatible") {
    if (endpoint === undefined) {
      throw new ProviderConfigurationError(
        "missing-endpoint",
        providerSettingNames.endpoint,
        "OpenAI-Compatible requires an endpoint URL.",
      );
    }

    return {
      version: providerConfigurationVersion,
      provider,
      modelId,
      endpoint: endpoint.value,
      capabilities: readCompatibleCapabilities(reader.get(providerSettingNames.capabilities)),
      requiresApiKey: endpoint.requiresApiKey,
    };
  }

  return {
    version: providerConfigurationVersion,
    provider,
    modelId,
    endpoint: endpoint?.value,
    capabilities: standardProviderCapabilities,
  };
}

/**
 * Reads only the Provider values needed before a model has been selected. Unlike the runtime
 * configuration reader, this intentionally tolerates a missing or malformed model so the selection
 * command can repair it without touching the other settings.
 */
export function readProviderSelectionConfiguration(
  reader: ConfigurationReader,
): ProviderSelectionConfiguration {
  const provider = readProviderId(reader.get(providerSettingNames.id));
  const endpoint = readOptionalEndpoint(reader.get(providerSettingNames.endpoint));

  if (provider === "openai-compatible" && endpoint === undefined) {
    throw new ProviderConfigurationError(
      "missing-endpoint",
      providerSettingNames.endpoint,
      "OpenAI-Compatible requires an endpoint URL.",
    );
  }

  const model = reader.get(providerSettingNames.model);
  const modelId = typeof model === "string" && isValidSelectionModelId(model) ? model : undefined;

  return {
    provider,
    modelId,
    endpoint: endpoint?.value,
  };
}

/**
 * Reads only bounded readiness facts for the Webview onboarding projection. It deliberately does
 * not return a model ID or endpoint value and tolerates a missing model so the user can repair it.
 */
export function readProviderOnboardingConfiguration(
  reader: ConfigurationReader,
): ProviderOnboardingConfiguration {
  const provider = readProviderId(reader.get(providerSettingNames.id));
  const model = reader.get(providerSettingNames.model);
  const modelConfigured = typeof model === "string" && isValidSelectionModelId(model);

  let endpointValid = true;
  let apiKeyRequired = true;
  try {
    const endpoint = readOptionalEndpoint(reader.get(providerSettingNames.endpoint));
    if (provider === "openai-compatible") {
      endpointValid = endpoint !== undefined;
      apiKeyRequired = endpoint === undefined || endpoint.requiresApiKey;
    }
  } catch {
    endpointValid = false;
  }

  return { provider, modelConfigured, apiKeyRequired, endpointValid };
}

function readProviderId(value: unknown): ProviderId {
  const provider = value ?? "openai";

  if (isProviderId(provider)) {
    return provider;
  }

  throw new ProviderConfigurationError(
    "unknown-provider",
    providerSettingNames.id,
    "Select a supported model provider: OpenAI, Gemini, or OpenAI-Compatible.",
  );
}

function readModelId(value: unknown): string {
  if (value === undefined || value === "") {
    throw new ProviderConfigurationError(
      "missing-model",
      providerSettingNames.model,
      "Configure a model ID before starting a chat.",
    );
  }

  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new ProviderConfigurationError(
      "invalid-model",
      providerSettingNames.model,
      "The configured model ID must be a non-empty string without surrounding whitespace.",
    );
  }

  return value;
}

function isValidSelectionModelId(value: string): boolean {
  return (
    value.length > 0 &&
    value.trim() === value &&
    [...value].length <= maxProviderModelIdCodePoints &&
    !value.includes(String.fromCharCode(0)) &&
    !value.includes("\r") &&
    !value.includes("\n")
  );
}

function readOptionalEndpoint(value: unknown): ProviderEndpointPolicyResult | undefined {
  try {
    return providerEndpointPolicy.evaluate(value);
  } catch (error) {
    if (error instanceof ProviderEndpointPolicyError) {
      throw invalidEndpointError();
    }
    throw error;
  }
}

function invalidEndpointError(): ProviderConfigurationError {
  return new ProviderConfigurationError(
    "invalid-endpoint",
    providerSettingNames.endpoint,
    "Use an HTTPS endpoint, or HTTP only with an explicit local loopback address.",
  );
}

function readCompatibleCapabilities(value: unknown): readonly ProviderCapability[] {
  const capabilities = value ?? defaultCompatibleCapabilities;

  if (!Array.isArray(capabilities)) {
    throw invalidCapabilitiesError();
  }

  const validated: ProviderCapability[] = [];
  for (const capability of capabilities) {
    if (!isProviderCapability(capability) || validated.includes(capability)) {
      throw invalidCapabilitiesError();
    }
    validated.push(capability);
  }

  return validated;
}

function isProviderId(value: unknown): value is ProviderId {
  return providerIds.some((candidate) => candidate === value);
}

function isProviderCapability(value: unknown): value is ProviderCapability {
  return providerCapabilities.some((candidate) => candidate === value);
}

function invalidCapabilitiesError(): ProviderConfigurationError {
  return new ProviderConfigurationError(
    "invalid-capabilities",
    providerSettingNames.capabilities,
    "Capabilities must be a unique list containing only text-streaming or tool-calling.",
  );
}
