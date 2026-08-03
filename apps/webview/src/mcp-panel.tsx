import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import styles from "./mcp-panel.module.css";
import type { McpState } from "./mcp-store.js";
import { Button } from "./ui/button.js";

export function McpPanel({ store }: { readonly store: StoreApi<McpState> }) {
  const state = useStore(store);
  const heading = useRef<HTMLHeadingElement>(null);
  const selectedResource = findSelectedResource(state);
  const selectedPrompt = state.prompts?.prompts.find(
    ({ name }) => name === state.selectedPromptName,
  );

  useEffect(() => {
    if (state.selectedResourceKey !== undefined || state.selectedPromptName !== undefined) {
      heading.current?.focus();
    }
  }, [state.selectedPromptName, state.selectedResourceKey]);

  return (
    <details className={styles.panel}>
      <summary>MCP Server and context</summary>
      <div className={styles.body}>
        <h2 ref={heading} tabIndex={-1}>
          MCP
        </h2>
        <p>
          Connect one configured local stdio Server. Chat remains available while MCP is
          disconnected.
        </p>
        <p>
          <strong>Status:</strong> {state.connection.status}
        </p>
        {state.connection.server === undefined ? null : (
          <p>
            <strong>Server:</strong> {state.connection.server.displayName}
          </p>
        )}
        {state.connection.status === "connected" ? (
          <ul className={styles.compactList} aria-label="MCP Server capabilities">
            <li>Tools: {yesNo(state.connection.capabilities.tools)}</li>
            <li>Resources: {yesNo(state.connection.capabilities.resources)}</li>
            <li>Prompts: {yesNo(state.connection.capabilities.prompts)}</li>
          </ul>
        ) : null}
        {state.connection.status === "failed" ? (
          <p role="alert">{state.connection.error.message}</p>
        ) : null}
        {state.connection.configurationStale ? (
          <p>Configuration changed. Disconnect, then reconnect to apply it.</p>
        ) : null}
        <div className={styles.actions}>
          <Button
            size="sm"
            onClick={() => state.connect()}
            disabled={state.busy !== undefined || state.connection.status === "connected"}
          >
            Connect
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => state.disconnect()}
            disabled={state.busy !== undefined || state.connection.status === "disconnected"}
          >
            Disconnect
          </Button>
          <Button size="sm" variant="ghost" onClick={() => state.openSettings()}>
            Configure
          </Button>
        </div>

        <section aria-labelledby="mcp-tools-title">
          <h3 id="mcp-tools-title">Tools</h3>
          {state.tools?.tools.length ? (
            <ul className={styles.cards}>
              {state.tools.tools.map((tool) => (
                <li key={tool.registryName}>
                  <strong>{tool.title ?? tool.mcpToolName}</strong>
                  <span>Server: {tool.server.displayName}</span>
                  <span>Action: {tool.mcpToolName}</span>
                  {tool.description === undefined ? null : <span>{tool.description}</span>}
                  <span>
                    Execution risk: external Server behavior and side effects may be unknown;
                    approval is still required where applicable.
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No MCP Tools available.</p>
          )}
        </section>

        <section aria-labelledby="mcp-resources-title">
          <h3 id="mcp-resources-title">Resources</h3>
          <label htmlFor="mcp-resource">Resource or template</label>
          <select
            id="mcp-resource"
            value={state.selectedResourceKey ?? ""}
            onChange={(event) => state.selectResource(event.target.value)}
            disabled={state.resources === undefined}
          >
            <option value="">No Resource selected</option>
            {state.resources?.resources.map((item) => (
              <option key={item.uri} value={`resource:${item.uri}`}>
                {item.title ?? item.name}
              </option>
            ))}
            {state.resources?.templates.map((item) => (
              <option key={item.uriTemplate} value={`template:${item.uriTemplate}`}>
                {item.title ?? item.name} (template)
              </option>
            ))}
          </select>
          {selectedResource?.kind === "template"
            ? selectedResource.value.arguments.map(({ name }) => (
                <label key={name}>
                  {name} (required)
                  <input
                    required
                    value={state.resourceArguments[name] ?? ""}
                    onChange={(event) => state.setResourceArgument(name, event.target.value)}
                  />
                </label>
              ))
            : null}
          {selectedResource === undefined ? null : (
            <p>{selectedResource.value.description ?? "No description supplied."}</p>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => state.readResource()}
            disabled={selectedResource === undefined || state.busy !== undefined}
          >
            Read preview
          </Button>
          {state.resourcePreview === undefined ? null : (
            <article className={styles.preview}>
              <h4>Text preview</h4>
              <p>Source: {state.resourcePreview.snapshot.server.displayName}</p>
              <p>
                MIME: {state.resourcePreview.snapshot.mimeType}; truncated:{" "}
                {yesNo(state.resourcePreview.snapshot.truncated)}
              </p>
              <pre>{state.resourcePreview.snapshot.items.map(({ text }) => text).join("")}</pre>
              <Button size="sm" onClick={() => state.attachResource()}>
                Attach to draft
              </Button>
            </article>
          )}
          <DraftItems
            title="Attached Resources"
            empty="No Resources attached."
            items={state.attachments.map((item) => ({
              id: item.snapshotId,
              label: `${item.serverId}: ${item.uri}`,
              remove: () => state.detachResource(item.snapshotId),
            }))}
          />
        </section>

        <section aria-labelledby="mcp-prompts-title">
          <h3 id="mcp-prompts-title">Prompts</h3>
          <label htmlFor="mcp-prompt">Prompt</label>
          <select
            id="mcp-prompt"
            value={state.selectedPromptName ?? ""}
            onChange={(event) => state.selectPrompt(event.target.value)}
            disabled={state.prompts === undefined}
          >
            <option value="">No Prompt selected</option>
            {state.prompts?.prompts.map((prompt) => (
              <option key={prompt.name} value={prompt.name}>
                {prompt.title ?? prompt.name}
              </option>
            ))}
          </select>
          {selectedPrompt?.arguments.map((argument) => (
            <label key={argument.name}>
              {argument.name}
              {argument.required ? " (required)" : " (optional)"}
              <input
                required={argument.required}
                aria-describedby={
                  argument.description === undefined
                    ? undefined
                    : `prompt-${argument.name}-description`
                }
                value={state.promptArguments[argument.name] ?? ""}
                onChange={(event) => state.setPromptArgument(argument.name, event.target.value)}
              />
              {argument.description === undefined ? null : (
                <span id={`prompt-${argument.name}-description`}>{argument.description}</span>
              )}
            </label>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => state.previewPrompt()}
            disabled={selectedPrompt === undefined || state.busy !== undefined}
          >
            Preview Prompt
          </Button>
          {state.promptPreview === undefined ? null : (
            <article className={styles.preview}>
              <h4>Full Prompt preview</h4>
              <p>
                Source: {state.promptPreview.server.displayName}. Content is ordinary user context,
                never System authority.
              </p>
              {state.promptPreview.messages.map((message) => (
                <div key={`${message.sourceRole}:${message.text}`}>
                  <strong>Source role: {message.sourceRole}</strong>
                  <pre>{message.text}</pre>
                </div>
              ))}
              <div className={styles.actions}>
                <Button size="sm" onClick={() => state.confirmPrompt()}>
                  Confirm for draft
                </Button>
                <Button size="sm" variant="secondary" onClick={() => state.cancelPrompt()}>
                  Cancel preview
                </Button>
              </div>
            </article>
          )}
          <DraftItems
            title="Confirmed Prompts"
            empty="No Prompts confirmed."
            items={state.confirmations.map((item) => ({
              id: item.previewId,
              label: `${item.value.serverId}: ${item.value.promptName}`,
              remove: () => state.detachPrompt(item.previewId),
            }))}
          />
        </section>
        <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
          {state.announcement}
        </p>
      </div>
    </details>
  );
}

function DraftItems({
  title,
  empty,
  items,
}: {
  readonly title: string;
  readonly empty: string;
  readonly items: readonly {
    readonly id: string;
    readonly label: string;
    readonly remove: () => void;
  }[];
}) {
  return (
    <div>
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <ul className={styles.compactList}>
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.label}</span>
              <Button size="sm" variant="ghost" onClick={item.remove}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function findSelectedResource(state: McpState) {
  const key = state.selectedResourceKey;
  if (key?.startsWith("resource:")) {
    const value = state.resources?.resources.find(({ uri }) => `resource:${uri}` === key);
    return value === undefined ? undefined : ({ kind: "resource", value } as const);
  }
  const value = state.resources?.templates.find(
    ({ uriTemplate }) => `template:${uriTemplate}` === key,
  );
  return value === undefined ? undefined : ({ kind: "template", value } as const);
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}
