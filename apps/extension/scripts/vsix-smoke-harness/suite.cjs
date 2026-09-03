const { createServer } = require("node:http");
const { readdir, readFile } = require("node:fs/promises");
const { join } = require("node:path");

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

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "ctrlZebra.checkProviderConnection",
    "ctrlZebra.clearLocalData",
    "ctrlZebra.deleteOpenAIApiKey",
    "ctrlZebra.deleteGeminiApiKey",
    "ctrlZebra.deleteOpenAICompatibleApiKey",
  ]) {
    if (!commands.includes(command)) {
      throw new Error(`The installed extension is missing the ${command} lifecycle command.`);
    }
  }

  const providerServer = await startProviderMetadataServer();
  const providerSetting = vscode.workspace.getConfiguration("ctrlZebra.provider");
  const mcpSetting = vscode.workspace.getConfiguration("ctrlZebra.mcp");
  try {
    await providerSetting.update("id", "openai-compatible", vscode.ConfigurationTarget.Global);
    await providerSetting.update("model", "marketplace-smoke", vscode.ConfigurationTarget.Global);
    await providerSetting.update(
      "endpoint",
      providerServer.endpoint,
      vscode.ConfigurationTarget.Global,
    );
    await providerSetting.update(
      "capabilities",
      ["text-streaming", "tool-calling"],
      vscode.ConfigurationTarget.Global,
    );
    const providerReport = await settleNotificationCommand(
      vscode.commands.executeCommand("ctrlZebra.checkProviderConnection"),
    );
    if (
      providerReport?.outcome !== "completed" ||
      providerReport?.provider !== "openai-compatible" ||
      providerReport?.modelId !== "marketplace-smoke"
    ) {
      throw new Error("The installed extension did not complete the loopback Provider check.");
    }
    if (providerServer.requestCount() !== 1) {
      throw new Error("The installed Provider check did not make exactly one metadata request.");
    }

    await mcpSetting.update(
      "server",
      {
        version: 1,
        serverId: "marketplace_smoke",
        displayName: "Marketplace smoke",
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
    await mcpSetting.update("server", undefined, vscode.ConfigurationTarget.Global);
    await providerSetting.update("capabilities", undefined, vscode.ConfigurationTarget.Global);
    await providerSetting.update("endpoint", undefined, vscode.ConfigurationTarget.Global);
    await providerSetting.update("model", undefined, vscode.ConfigurationTarget.Global);
    await providerSetting.update("id", undefined, vscode.ConfigurationTarget.Global);
    await providerServer.close();
  }

  await vscode.commands.executeCommand("ctrlZebra.agentView.focus");
  await waitForStructuredLogEvent("agent_view_first_displayed");
};

async function waitForStructuredLogEvent(event) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await logContainsEvent(event)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`The installed extension did not emit ${event} after focusing the Agent view.`);
}

async function logContainsEvent(event) {
  const logRoot = process.env.CTRL_ZEBRA_SMOKE_USER_DATA_DIR;
  if (logRoot === undefined) {
    throw new Error(
      "The installed-extension smoke harness cannot locate its isolated user-data directory.",
    );
  }
  for (const logPath of await findFiles(logRoot, "CtrlZebra.log")) {
    if ((await readFile(logPath, "utf8")).includes(`"event":"${event}"`)) {
      return true;
    }
  }
  return false;
}

async function findFiles(directory, fileName) {
  const matches = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return matches;
  }
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await findFiles(entryPath, fileName)));
    } else if (entry.isFile() && entry.name === fileName) {
      matches.push(entryPath);
    }
  }
  return matches;
}

async function startProviderMetadataServer() {
  let requests = 0;
  const server = createServer((request, response) => {
    if (
      request.method !== "GET" ||
      request.url !== "/v1/models/marketplace-smoke" ||
      request.headers.authorization !== undefined
    ) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end('{"error":"invalid-request"}');
      return;
    }
    requests += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"id":"marketplace-smoke"}');
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("The installed smoke Provider did not bind to loopback TCP.");
  }
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    requestCount: () => requests,
    close: () => closeServer(server),
  };
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function settleNotificationCommand(command) {
  let settled = false;
  void command.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  const deadline = Date.now() + 10_000;
  while (!settled && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await vscode.commands.executeCommand("notifications.clearAll");
  }
  if (!settled) {
    throw new Error("The installed Provider check did not settle after closing its notification.");
  }
  return await command;
}
