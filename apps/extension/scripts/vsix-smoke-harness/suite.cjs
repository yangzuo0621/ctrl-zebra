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

  await vscode.commands.executeCommand("ctrlZebra.agentView.focus");
};
