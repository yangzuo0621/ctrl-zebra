import type { Disposable, WebviewView, WebviewViewProvider } from "vscode";

export const agentViewId = "ctrlZebra.agentView";

type WebviewViewRegistrar = (viewId: string, provider: WebviewViewProvider) => Disposable;

class EmptyAgentViewProvider implements WebviewViewProvider {
  resolveWebviewView(webviewView: WebviewView): void {
    webviewView.webview.html = "";
  }
}

export function registerAgentView(registrar: WebviewViewRegistrar): Disposable {
  return registrar(agentViewId, new EmptyAgentViewProvider());
}
