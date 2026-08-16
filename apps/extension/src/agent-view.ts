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
import type { DiagnosticsExportController } from "./controllers/diagnostic-export.js";
import type { EditorContextEntryController } from "./controllers/editor-context-entry.js";
import type { McpPromptActions } from "./controllers/mcp-prompt-actions.js";
import type { McpResourceActions } from "./controllers/mcp-resource-actions.js";
import type { McpWebviewActions } from "./controllers/mcp-webview-actions.js";
import type { ProviderOnboardingController } from "./controllers/provider-onboarding-controller.js";
import type { SessionRecoveryActions } from "./controllers/session-recovery.js";
import {
  type ApprovalUiActions,
  bindWebviewMessageController,
  type LocalDataClearUiActions,
} from "./controllers/webview-message-controller.js";
import type { HostRunStatus } from "./controllers/webview-run-message-handler.js";
import type { WorkspaceFileReferenceActions } from "./controllers/workspace-file-reference-actions.js";

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
  constructor(private readonly options: AgentViewProviderOptions) {}

  resolveWebviewView(webviewView: WebviewView): void {
    webviewView.webview.options = createAgentViewOptions(this.options.extensionUri);
    const nonce = randomBytes(16).toString("hex");
    webviewView.webview.html = createAgentViewHtml(
      webviewView.webview,
      this.options.extensionUri,
      nonce,
    );

    bindWebviewMessageController({
      channel: webviewView.webview,
      lifetime: webviewView,
      reportDeliveryFailure: this.options.reportDeliveryFailure,
      chatRunner: this.options.chatRunner,
      approvalActions: this.options.approvalActions,
      sessionActions: this.options.sessionActions,
      checkpointActions: this.options.checkpointActions,
      reportRunFailure: this.options.reportRunFailure,
      reportRunStatus: this.options.reportRunStatus,
      resourceActions: this.options.createResourceActions?.(),
      promptActions: this.options.createPromptActions?.(),
      mcpActions: this.options.createMcpActions?.(),
      providerOnboarding: this.options.createProviderOnboarding?.(),
      openExternalLink: this.options.openExternalLink,
      editorContextActions: this.options.editorContext?.attachView(
        webviewView.webview,
        webviewView,
      ),
      workspaceFileActions: this.options.createWorkspaceFileReferenceActions?.(),
      localDataClear: this.options.localDataClear,
      diagnosticsExport: this.options.diagnosticsExport,
    });
    this.options.reportDisplay?.();
  }
}

interface AgentViewProviderOptions {
  readonly extensionUri: Uri;
  readonly chatRunner: ChatRunner;
  readonly approvalActions?: ApprovalUiActions;
  readonly sessionActions?: SessionRecoveryActions;
  readonly checkpointActions?: CheckpointActions;
  readonly reportDeliveryFailure?: () => void;
  readonly reportDisplay?: () => void;
  readonly reportRunFailure?: (error: unknown) => void;
  readonly reportRunStatus?: (status: HostRunStatus) => void;
  readonly createResourceActions?: () => McpResourceActions;
  readonly createPromptActions?: () => McpPromptActions;
  readonly createMcpActions?: () => McpWebviewActions;
  readonly createWorkspaceFileReferenceActions?: () => WorkspaceFileReferenceActions;
  readonly createProviderOnboarding?: () => ProviderOnboardingController;
  readonly openExternalLink?: (href: string) => void;
  readonly editorContext?: EditorContextEntryController;
  readonly localDataClear?: LocalDataClearUiActions;
  readonly diagnosticsExport?: DiagnosticsExportController;
}

interface RegisterAgentViewOptions extends AgentViewProviderOptions {
  readonly registrar: WebviewViewRegistrar;
}

export function registerAgentView({
  registrar,
  ...providerOptions
}: RegisterAgentViewOptions): Disposable {
  return registrar(agentViewId, new AgentViewProvider(providerOptions));
}
