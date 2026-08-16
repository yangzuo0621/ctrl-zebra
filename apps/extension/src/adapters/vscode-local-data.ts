import type { ConfigurationTarget, Memento } from "vscode";

import type { ApiKeySecretStorage } from "./api-key-secret-storage.js";
import { mcpServerSettingName, mcpServerSettingSection } from "./mcp-server-configuration.js";
import { providerIds, providerSettingNames } from "./provider-configuration.js";
import { runBudgetSettingNames, runBudgetSettingSection } from "./run-budget-configuration.js";
import {
  sessionRetentionSettingNames,
  sessionRetentionSettingSection,
} from "./session-retention-configuration.js";

export interface LocalDataClearCounts {
  readonly deleted: number;
  readonly failed: number;
}

export const ctrlZebraConfigurationEntries = [
  ...Object.values(providerSettingNames).map((name) => ({
    section: "ctrlZebra.provider",
    name,
  })),
  {
    section: "ctrlZebra.mcp",
    name: mcpServerSettingName,
  },
  ...Object.values(sessionRetentionSettingNames).map((name) => ({
    section: sessionRetentionSettingSection,
    name,
  })),
  ...Object.values(runBudgetSettingNames).map((name) => ({
    section: runBudgetSettingSection,
    name,
  })),
  {
    section: "ctrlZebra.editorContext",
    name: "enabled",
  },
] as const;

export const mcpConfigurationEntries = ctrlZebraConfigurationEntries.filter(
  ({ section }) => section === mcpServerSettingSection,
);

export const nonMcpConfigurationEntries = ctrlZebraConfigurationEntries.filter(
  ({ section }) => section !== mcpServerSettingSection,
);

const configurationTarget = {
  Global: 1 as ConfigurationTarget,
  Workspace: 2 as ConfigurationTarget,
  WorkspaceFolder: 3 as ConfigurationTarget,
} as const;

const configurationScopes = [
  { field: "globalValue", target: configurationTarget.Global },
  { field: "workspaceValue", target: configurationTarget.Workspace },
  { field: "workspaceFolderValue", target: configurationTarget.WorkspaceFolder },
] as const;

interface ConfigurationInspection {
  readonly globalValue?: unknown;
  readonly workspaceValue?: unknown;
  readonly workspaceFolderValue?: unknown;
  readonly globalLanguageValue?: unknown;
  readonly workspaceLanguageValue?: unknown;
  readonly workspaceFolderLanguageValue?: unknown;
  readonly languageIds?: readonly string[];
}

interface ConfigurationInspector {
  inspect(section: string): ConfigurationInspection | undefined;
  update(
    section: string,
    value: unknown,
    target: ConfigurationTarget,
    overrideInLanguage?: boolean,
  ): Thenable<void>;
}

export interface LocalDataConfigurationReader {
  getConfiguration(
    section: string,
    scope?: { readonly languageId: string },
  ): ConfigurationInspector;
}

export async function clearProviderSecrets(
  storages: Readonly<Record<(typeof providerIds)[number], Pick<ApiKeySecretStorage, "delete">>>,
): Promise<LocalDataClearCounts> {
  let deleted = 0;
  let failed = 0;
  for (const provider of providerIds) {
    try {
      await storages[provider].delete();
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed };
}

export async function clearCtrlZebraConfiguration(
  reader: LocalDataConfigurationReader,
): Promise<LocalDataClearCounts> {
  return await clearConfigurationEntries(reader, ctrlZebraConfigurationEntries);
}

export async function clearConfigurationEntries(
  reader: LocalDataConfigurationReader,
  entries: readonly { readonly section: string; readonly name: string }[],
): Promise<LocalDataClearCounts> {
  let deleted = 0;
  let failed = 0;
  for (const entry of entries) {
    let configuration: ConfigurationInspector;
    try {
      configuration = reader.getConfiguration(entry.section);
    } catch {
      failed += 1;
      continue;
    }
    let inspected: ConfigurationInspection | undefined;
    try {
      inspected = configuration.inspect(entry.name);
    } catch {
      failed += 1;
      continue;
    }
    if (inspected === undefined) continue;

    for (const { field, target } of configurationScopes) {
      if (inspected[field] === undefined) continue;
      try {
        await configuration.update(entry.name, undefined, target);
        deleted += 1;
      } catch {
        failed += 1;
      }
    }

    for (const languageId of inspected.languageIds ?? []) {
      let languageConfiguration: ConfigurationInspector;
      try {
        languageConfiguration = reader.getConfiguration(entry.section, { languageId });
      } catch {
        failed += 1;
        continue;
      }
      let languageInspection: ConfigurationInspection | undefined;
      try {
        languageInspection = languageConfiguration.inspect(entry.name);
      } catch {
        failed += 1;
        continue;
      }
      if (languageInspection === undefined) continue;
      for (const { field, target } of [
        { field: "globalLanguageValue", target: configurationTarget.Global },
        { field: "workspaceLanguageValue", target: configurationTarget.Workspace },
        { field: "workspaceFolderLanguageValue", target: configurationTarget.WorkspaceFolder },
      ] as const) {
        if (languageInspection[field] === undefined) continue;
        try {
          await languageConfiguration.update(entry.name, undefined, target, true);
          deleted += 1;
        } catch {
          failed += 1;
        }
      }
    }
  }
  return { deleted, failed };
}

export async function clearMemento(
  memento: Pick<Memento, "keys" | "update">,
): Promise<LocalDataClearCounts> {
  const keys = memento.keys();
  const boundedKeys = keys.slice(0, 10_000);
  let deleted = 0;
  let failed = keys.length > boundedKeys.length ? 1 : 0;
  for (const key of boundedKeys) {
    try {
      await memento.update(key, undefined);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed };
}
