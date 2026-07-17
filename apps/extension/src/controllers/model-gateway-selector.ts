import type { ModelGateway } from "@ctrl-zebra/core";

import {
  ApiKeySecretStorageError,
  type ProviderApiKeySecretReader,
} from "../adapters/api-key-secret-storage.js";
import {
  type ProviderCapability,
  type ProviderConfiguration,
  ProviderConfigurationError,
  type ProviderId,
} from "../adapters/provider-configuration.js";

export interface ProviderGatewayFactoryInput {
  readonly configuration: ProviderConfiguration;
  readonly apiKey?: string;
}

export type ProviderGatewayFactory = (
  input: ProviderGatewayFactoryInput,
) => ModelGateway | Promise<ModelGateway>;

export type ProviderGatewayFactories = Partial<Record<ProviderId, ProviderGatewayFactory>>;

export class ProviderCapabilityMismatchError extends Error {
  constructor(readonly missingCapabilities: readonly ProviderCapability[]) {
    super(`The selected model provider does not declare: ${missingCapabilities.join(", ")}.`);
    this.name = "ProviderCapabilityMismatchError";
  }
}

export class ProviderAdapterUnavailableError extends Error {
  constructor(readonly provider: ProviderId) {
    super(`The ${provider} model provider adapter is not available yet.`);
    this.name = "ProviderAdapterUnavailableError";
  }
}

export class MissingProviderApiKeyError extends Error {
  constructor(readonly provider: ProviderId) {
    super(`Save an API key for the ${provider} model provider before starting a chat.`);
    this.name = "MissingProviderApiKeyError";
  }
}

interface SelectModelGatewayOptions {
  readonly configuration: ProviderConfiguration;
  readonly requiredCapabilities: readonly ProviderCapability[];
  readonly secrets: ProviderApiKeySecretReader;
  readonly factories: ProviderGatewayFactories;
}

export async function selectModelGateway({
  configuration,
  requiredCapabilities,
  secrets,
  factories,
}: SelectModelGatewayOptions): Promise<ModelGateway> {
  const missingCapabilities = requiredCapabilities.filter(
    (capability) => !configuration.capabilities.includes(capability),
  );
  if (missingCapabilities.length > 0) {
    throw new ProviderCapabilityMismatchError(missingCapabilities);
  }

  const factory = factories[configuration.provider];
  if (factory === undefined) {
    throw new ProviderAdapterUnavailableError(configuration.provider);
  }

  const requiresApiKey =
    configuration.provider !== "openai-compatible" || configuration.requiresApiKey;
  const apiKey = requiresApiKey ? await secrets.read(configuration.provider) : undefined;
  if (requiresApiKey && (apiKey === undefined || apiKey.length === 0)) {
    throw new MissingProviderApiKeyError(configuration.provider);
  }

  return factory({ configuration, apiKey });
}

export function getProviderSetupErrorMessage(error: unknown): string | undefined {
  if (
    error instanceof ProviderConfigurationError ||
    error instanceof ApiKeySecretStorageError ||
    error instanceof ProviderCapabilityMismatchError ||
    error instanceof ProviderAdapterUnavailableError ||
    error instanceof MissingProviderApiKeyError
  ) {
    return error.message;
  }

  return undefined;
}
