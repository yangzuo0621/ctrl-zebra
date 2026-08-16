import {
  defaultSessionRetentionDays,
  maxSessionRetentionDays,
  minSessionRetentionDays,
  type SessionRetentionPolicy,
} from "@ctrl-zebra/core";

export const sessionRetentionSettingSection = "ctrlZebra.sessionRetention";
export const sessionRetentionSettingNames = {
  enabled: "enabled",
  days: "days",
} as const;

export interface SessionRetentionConfigurationReader {
  get(setting: string): unknown;
}

export class SessionRetentionConfigurationError extends Error {
  constructor() {
    super("The Session retention settings are invalid.");
    this.name = "SessionRetentionConfigurationError";
  }
}

export function readSessionRetentionConfiguration(
  reader: SessionRetentionConfigurationReader,
): SessionRetentionPolicy {
  const enabled = reader.get(sessionRetentionSettingNames.enabled);
  const days = reader.get(sessionRetentionSettingNames.days);
  const normalizedEnabled = enabled === undefined ? true : enabled;
  const normalizedDays: unknown = days === undefined ? defaultSessionRetentionDays : days;
  if (
    typeof normalizedEnabled !== "boolean" ||
    typeof normalizedDays !== "number" ||
    !Number.isSafeInteger(normalizedDays) ||
    normalizedDays < minSessionRetentionDays ||
    normalizedDays > maxSessionRetentionDays
  ) {
    throw new SessionRetentionConfigurationError();
  }
  return Object.freeze({ enabled: normalizedEnabled, days: normalizedDays });
}
