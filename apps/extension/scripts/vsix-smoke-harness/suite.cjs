const vscode = require("vscode");

exports.run = async () => {
  const extension = vscode.extensions.getExtension("ctrl-zebra.ctrl-zebra");
  if (!extension) {
    throw new Error("The installed CtrlZebra extension is not available to the clean profile.");
  }

  await extension.activate();
  if (!extension.isActive) {
    throw new Error("The installed CtrlZebra extension did not activate.");
  }

  const setting = vscode.workspace.getConfiguration("ctrlZebra.mcp");
  try {
    await setting.update(
      "server",
      {
        version: 1,
        serverId: "vsix_fixture",
        displayName: "VSIX fixture",
        command: "",
        args: [],
      },
      vscode.ConfigurationTarget.Global,
    );
    const rejected = await vscode.commands.executeCommand("ctrlZebra.connectMcpServer");
    if (rejected?.status !== "failed" || rejected?.error?.code !== "configuration-invalid") {
      throw new Error("The installed extension did not enforce the MCP configuration gate.");
    }
    const disconnected = await vscode.commands.executeCommand("ctrlZebra.disconnectMcpServer");
    if (disconnected?.status !== "disconnected") {
      throw new Error("The installed extension did not complete the MCP disconnect path.");
    }
  } finally {
    await vscode.commands.executeCommand("ctrlZebra.disconnectMcpServer");
    await setting.update("server", undefined, vscode.ConfigurationTarget.Global);
  }

  await vscode.commands.executeCommand("ctrlZebra.agentView.focus");
};
