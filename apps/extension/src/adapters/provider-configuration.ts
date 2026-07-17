export const providerIds = ["openai", "gemini", "openai-compatible"] as const;
export type ProviderId = (typeof providerIds)[number];

export const providerCapabilities = ["text-streaming", "tool-calling"] as const;
export type ProviderCapability = (typeof providerCapabilities)[number];

export const providerConfigurationVersion = 1 as const;

export const providerSettingNames = {
  capabilities: "capabilities",
  endpoint: "endpoint",
  id: "id",
  model: "model",
} as const;

export interface ConfigurationReader {
  get(setting: string): unknown;
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
      requiresApiKey: !endpoint.isLoopback,
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

interface ValidatedEndpoint {
  readonly value: string;
  readonly isLoopback: boolean;
}

function readOptionalEndpoint(value: unknown): ValidatedEndpoint | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || value.trim() !== value) {
    throw invalidEndpointError();
  }

  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw invalidEndpointError();
  }

  if (
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw invalidEndpointError();
  }

  const isLoopback = isExplicitLoopbackHostname(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && isLoopback)) {
    throw invalidEndpointError();
  }

  return { value: endpoint.toString(), isLoopback };
}

function invalidEndpointError(): ProviderConfigurationError {
  return new ProviderConfigurationError(
    "invalid-endpoint",
    providerSettingNames.endpoint,
    "Use an HTTPS endpoint, or HTTP only with an explicit local loopback address.",
  );
}

function isExplicitLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalizedHostname === "localhost" || normalizedHostname === "::1") {
    return true;
  }

  const octets = normalizedHostname.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127
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
