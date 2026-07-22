import { randomBytes } from "node:crypto";

import {
  type Disposable,
  Uri,
  type Webview,
  type WebviewOptions,
  type WebviewView,
  type WebviewViewProvider,
} from "vscode";

import type { ChatRunner } from "./controllers/chat-runner.js";
import type { CheckpointActions } from "./controllers/checkpoint-actions.js";
import type { SessionRecoveryActions } from "./controllers/session-recovery.js";
import {
  type ApprovalUiActions,
  bindWebviewMessageController,
} from "./controllers/webview-message-controller.js";

export const agentViewId = "ctrlZebra.agentView";

type WebviewViewRegistrar = (viewId: string, provider: WebviewViewProvider) => Disposable;

type WebviewResourceResolver = Pick<Webview, "asWebviewUri" | "cspSource">;

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function getWebviewResourceRoot(extensionUri: Uri): Uri {
  return Uri.joinPath(extensionUri, "dist", "webview");
}

export function createAgentViewOptions(extensionUri: Uri): WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [getWebviewResourceRoot(extensionUri)],
  };
}

export function createAgentViewHtml(
  webview: WebviewResourceResolver,
  extensionUri: Uri,
  nonce: string,
): string {
  const resourceRoot = getWebviewResourceRoot(extensionUri);
  const scriptUri = webview.asWebviewUri(Uri.joinPath(resourceRoot, "main.js"));
  const styleUri = webview.asWebviewUri(Uri.joinPath(resourceRoot, "main.css"));
  const contentSecurityPolicy = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(contentSecurityPolicy)}" />
    <link rel="stylesheet" href="${escapeHtmlAttribute(styleUri.toString())}" />
    <title>CtrlZebra</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${escapeHtmlAttribute(nonce)}" src="${escapeHtmlAttribute(scriptUri.toString())}"></script>
  </body>
</html>`;
}

class AgentViewProvider implements WebviewViewProvider {
  constructor(
    private readonly extensionUri: Uri,
    private readonly chatRunner: ChatRunner,
    private readonly approvalActions?: ApprovalUiActions,
    private readonly sessionActions?: SessionRecoveryActions,
    private readonly checkpointActions?: CheckpointActions,
    private readonly reportDeliveryFailure: () => void = () => {},
  ) {}

  resolveWebviewView(webviewView: WebviewView): void {
    webviewView.webview.options = createAgentViewOptions(this.extensionUri);
    const nonce = randomBytes(16).toString("hex");
    webviewView.webview.html = createAgentViewHtml(webviewView.webview, this.extensionUri, nonce);

    bindWebviewMessageController(
      webviewView.webview,
      webviewView,
      this.reportDeliveryFailure,
      this.chatRunner,
      this.approvalActions,
      this.sessionActions,
      this.checkpointActions,
    );
  }
}

export function registerAgentView(
  extensionUri: Uri,
  registrar: WebviewViewRegistrar,
  chatRunner: ChatRunner,
  approvalActions?: ApprovalUiActions,
  sessionActions?: SessionRecoveryActions,
  checkpointActions?: CheckpointActions,
  reportDeliveryFailure?: () => void,
): Disposable {
  return registrar(
    agentViewId,
    new AgentViewProvider(
      extensionUri,
      chatRunner,
      approvalActions,
      sessionActions,
      checkpointActions,
      reportDeliveryFailure,
    ),
  );
}
