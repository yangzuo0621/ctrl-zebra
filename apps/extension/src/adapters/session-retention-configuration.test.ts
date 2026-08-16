import {
  defaultSessionRetentionDays,
  maxSessionRetentionDays,
  minSessionRetentionDays,
} from "@ctrl-zebra/core";
import { describe, expect, it } from "vitest";
import {
  readSessionRetentionConfiguration,
  SessionRetentionConfigurationError,
  sessionRetentionSettingNames,
} from "./session-retention-configuration.js";

describe("Session retention configuration", () => {
  it("applies the enabled thirty-day default and returns an immutable policy", () => {
    const policy = readSessionRetentionConfiguration({ get: () => undefined });

    expect(policy).toEqual({ enabled: true, days: defaultSessionRetentionDays });
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it("accepts disabled cleanup and bounded integer durations", () => {
    const values: Record<string, unknown> = {
      [sessionRetentionSettingNames.enabled]: false,
      [sessionRetentionSettingNames.days]: maxSessionRetentionDays,
    };

    expect(readSessionRetentionConfiguration({ get: (setting) => values[setting] })).toEqual({
      enabled: false,
      days: maxSessionRetentionDays,
    });
    expect(
      readSessionRetentionConfiguration({
        get: (setting) =>
          setting === sessionRetentionSettingNames.days ? minSessionRetentionDays : true,
      }),
    ).toEqual({ enabled: true, days: minSessionRetentionDays });
  });

  it.each([
    [sessionRetentionSettingNames.enabled, "yes"],
    [sessionRetentionSettingNames.days, 0],
    [sessionRetentionSettingNames.days, 1.5],
    [sessionRetentionSettingNames.days, maxSessionRetentionDays + 1],
  ])("rejects invalid %s setting", (setting, value) => {
    expect(() =>
      readSessionRetentionConfiguration({
        get: (name) => (name === setting ? value : undefined),
      }),
    ).toThrow(SessionRetentionConfigurationError);
  });
});
