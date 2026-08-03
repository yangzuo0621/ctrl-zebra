import type { Disposable } from "vscode";

import type { McpConnectionController } from "./mcp-connection-controller.js";

export const connectMcpServerCommandId = "ctrlZebra.connectMcpServer";
export const disconnectMcpServerCommandId = "ctrlZebra.disconnectMcpServer";

interface McpServerCommandDependencies {
  readonly controller: Pick<McpConnectionController, "connect" | "disconnect">;
  readonly registerCommand: (commandId: string, handler: () => Promise<unknown>) => Disposable;
}

export function registerMcpServerCommands({
  controller,
  registerCommand,
}: McpServerCommandDependencies): Disposable {
  const registrations = [
    registerCommand(connectMcpServerCommandId, () => controller.connect()),
    registerCommand(disconnectMcpServerCommandId, () => controller.disconnect()),
  ];

  return {
    dispose() {
      for (const registration of registrations) {
        registration.dispose();
      }
    },
  };
}
