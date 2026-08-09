import { type ModelGateway, RetryingModelGateway } from "@ctrl-zebra/core";

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

type ProviderConfigurationById = {
  readonly [Provider in ProviderId]: Extract<
    ProviderConfiguration,
    { readonly provider: Provider }
  >;
};

export type ProviderGatewayFactoryInput<Provider extends ProviderId> = {
  readonly configuration: ProviderConfigurationById[Provider];
} & (Provider extends "openai-compatible"
  ? { readonly apiKey?: string }
  : { readonly apiKey: string });

export type ProviderGatewayFactory<Provider extends ProviderId> = (
  input: ProviderGatewayFactoryInput<Provider>,
) => ModelGateway | Promise<ModelGateway>;

export type ProviderGatewayFactories = {
  readonly [Provider in ProviderId]?: ProviderGatewayFactory<Provider>;
};

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
  const gateway = await createProviderGateway({
    configuration,
    requiredCapabilities,
    secrets,
    factories,
  });

  return new RetryingModelGateway(gateway);
}

async function createProviderGateway({
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

  if (configuration.provider === "openai") {
    const factory = requireProviderFactory(configuration.provider, factories.openai);
    const apiKey = await readRequiredApiKey(configuration.provider, secrets);
    return factory({ configuration, apiKey });
  }

  if (configuration.provider === "gemini") {
    const factory = requireProviderFactory(configuration.provider, factories.gemini);
    const apiKey = await readRequiredApiKey(configuration.provider, secrets);
    return factory({ configuration, apiKey });
  }

  const factory = requireProviderFactory(configuration.provider, factories["openai-compatible"]);
  const apiKey = configuration.requiresApiKey
    ? await readRequiredApiKey(configuration.provider, secrets)
    : undefined;
  return factory({ configuration, apiKey });
}

function requireProviderFactory<Provider extends ProviderId>(
  provider: Provider,
  factory: ProviderGatewayFactory<Provider> | undefined,
): ProviderGatewayFactory<Provider> {
  if (factory === undefined) {
    throw new ProviderAdapterUnavailableError(provider);
  }
  return factory;
}

async function readRequiredApiKey(
  provider: ProviderId,
  secrets: ProviderApiKeySecretReader,
): Promise<string> {
  const apiKey = await secrets.read(provider);
  if (apiKey === undefined || apiKey.length === 0) {
    throw new MissingProviderApiKeyError(provider);
  }
  return apiKey;
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
