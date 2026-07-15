import {
  type Disposable,
  Uri,
  type Webview,
  type WebviewView,
  type WebviewViewProvider,
} from "vscode";

export const agentViewId = "ctrlZebra.agentView";

type WebviewViewRegistrar = (viewId: string, provider: WebviewViewProvider) => Disposable;

type WebviewResourceResolver = Pick<Webview, "asWebviewUri">;

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function createAgentViewHtml(webview: WebviewResourceResolver, extensionUri: Uri): string {
  const scriptUri = webview.asWebviewUri(Uri.joinPath(extensionUri, "dist", "webview", "main.js"));
  const styleUri = webview.asWebviewUri(Uri.joinPath(extensionUri, "dist", "webview", "main.css"));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${escapeHtmlAttribute(styleUri.toString())}" />
    <title>CtrlZebra</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${escapeHtmlAttribute(scriptUri.toString())}"></script>
  </body>
</html>`;
}

class AgentViewProvider implements WebviewViewProvider {
  constructor(private readonly extensionUri: Uri) {}

  resolveWebviewView(webviewView: WebviewView): void {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = createAgentViewHtml(webviewView.webview, this.extensionUri);
  }
}

export function registerAgentView(extensionUri: Uri, registrar: WebviewViewRegistrar): Disposable {
  return registrar(agentViewId, new AgentViewProvider(extensionUri));
}
