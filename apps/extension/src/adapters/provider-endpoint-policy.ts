/**
 * Extension-owned endpoint policy. Provider callers use this seam for the
 * structural transport and credential requirement rules; caller-specific
 * errors remain outside the policy.
 */
export interface ProviderEndpointPolicyResult {
  readonly value: string;
  readonly requiresApiKey: boolean;
}

export interface ProviderEndpointPolicy {
  evaluate(value: unknown): ProviderEndpointPolicyResult | undefined;
}

export class ProviderEndpointPolicyError extends Error {
  constructor() {
    super("The configured Provider endpoint is invalid.");
    this.name = "ProviderEndpointPolicyError";
  }
}

export function createProviderEndpointPolicy(): ProviderEndpointPolicy {
  return {
    evaluate(value) {
      if (value === undefined || value === "") {
        return undefined;
      }

      if (typeof value !== "string" || value.trim() !== value) {
        throw new ProviderEndpointPolicyError();
      }

      let endpoint: URL;
      try {
        endpoint = new URL(value);
      } catch {
        throw new ProviderEndpointPolicyError();
      }

      if (
        endpoint.username !== "" ||
        endpoint.password !== "" ||
        endpoint.search !== "" ||
        endpoint.hash !== ""
      ) {
        throw new ProviderEndpointPolicyError();
      }

      const requiresApiKey = !isExplicitLoopbackHostname(endpoint.hostname);
      if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && !requiresApiKey)) {
        throw new ProviderEndpointPolicyError();
      }

      return { value: endpoint.toString(), requiresApiKey };
    },
  };
}

export const providerEndpointPolicy = createProviderEndpointPolicy();

function isExplicitLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalizedHostname === "localhost" || normalizedHostname === "::1") {
    return true;
  }

  const octets = normalizedHostname.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127
  );
}
