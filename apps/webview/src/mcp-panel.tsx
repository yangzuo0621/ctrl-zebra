import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import styles from "./mcp-panel.module.css";
import type { McpState } from "./mcp-store.js";
import { strings } from "./strings.js";
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
      <summary>{strings.mcp.panelSummary}</summary>
      <div className={styles.body}>
        <h2 ref={heading} tabIndex={-1}>
          {strings.mcp.heading}
        </h2>
        <p>{strings.mcp.description}</p>
        <p>
          <strong>{strings.mcp.status}</strong>{" "}
          {strings.mcp.connectionStatus[state.connection.status]}
        </p>
        {state.connection.server === undefined ? null : (
          <p>
            <strong>{strings.mcp.server}</strong> {state.connection.server.displayName}
          </p>
        )}
        {state.connection.status === "connected" ? (
          <ul className={styles.compactList} aria-label={strings.mcp.capabilitiesLabel}>
            <li>
              {strings.mcp.tools}: {yesNo(state.connection.capabilities.tools)}
            </li>
            <li>
              {strings.mcp.resources}: {yesNo(state.connection.capabilities.resources)}
            </li>
            <li>
              {strings.mcp.prompts}: {yesNo(state.connection.capabilities.prompts)}
            </li>
          </ul>
        ) : null}
        {state.connection.status === "failed" ? (
          <p role="alert">{state.connection.error.message}</p>
        ) : null}
        {state.connection.configurationStale ? <p>{strings.mcp.configurationChanged}</p> : null}
        <div className={styles.actions}>
          <Button
            size="sm"
            onClick={() => state.connect()}
            disabled={state.busy !== undefined || state.connection.status === "connected"}
          >
            {strings.mcp.connect}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => state.disconnect()}
            disabled={state.busy !== undefined || state.connection.status === "disconnected"}
          >
            {strings.mcp.disconnect}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => state.openSettings()}>
            {strings.mcp.configure}
          </Button>
        </div>

        {state.diagnostics === undefined ? null : (
          <section aria-labelledby="mcp-diagnostics-title">
            <h3 id="mcp-diagnostics-title">{strings.mcp.diagnostics}</h3>
            {state.diagnostics.kind === "protocol-incompatible" ? (
              <div>
                <p>{strings.mcp.diagnosticConfiguredMode}</p>
                <p>{strings.mcp.diagnosticSupportedVersion}</p>
                <p>{strings.mcp.diagnosticNextStep}</p>
                <Button size="sm" variant="secondary" onClick={() => state.openSettings()}>
                  {strings.mcp.diagnosticOpenSettings}
                </Button>
              </div>
            ) : (
              <>
                {state.diagnostics.kind === "tool-rejections" ? (
                  <>
                    <h4>{strings.mcp.diagnosticsSkipped}</h4>
                    <ul className={styles.compactList}>
                      {state.diagnostics.skippedTools.map((tool) => (
                        <li key={`${tool.mcpToolName}:${tool.reason}`}>
                          <span>{tool.mcpToolName}</span>
                          <span aria-hidden="true">{" — "}</span>
                          <span>{diagnosticReason(tool.reason)}</span>
                        </li>
                      ))}
                    </ul>
                    {state.diagnostics.skippedToolsTruncated ? (
                      <p>{strings.mcp.diagnosticsTruncated}</p>
                    ) : null}
                  </>
                ) : (
                  <p>{diagnosticFailure(state.diagnostics.code)}</p>
                )}
                {state.diagnostics.recoveryAction === "refresh-tools" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => state.refreshTools()}
                    disabled={state.busy !== undefined || state.connection.status !== "connected"}
                  >
                    {strings.mcp.diagnosticRefresh}
                  </Button>
                ) : state.diagnostics.recoveryAction === "reconnect" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => state.connect()}
                    disabled={state.busy !== undefined}
                  >
                    {strings.mcp.diagnosticReconnect}
                  </Button>
                ) : null}
              </>
            )}
          </section>
        )}

        <section aria-labelledby="mcp-tools-title">
          <h3 id="mcp-tools-title">{strings.mcp.tools}</h3>
          {state.tools?.tools.length ? (
            <ul className={styles.cards}>
              {state.tools.tools.map((tool) => (
                <li key={tool.registryName}>
                  <strong>{tool.title ?? tool.mcpToolName}</strong>
                  <span>
                    {strings.mcp.server} {tool.server.displayName}
                  </span>
                  <span>{strings.mcp.action(tool.mcpToolName)}</span>
                  {tool.description === undefined ? null : <span>{tool.description}</span>}
                  <span>{strings.mcp.executionRiskDetail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>{strings.mcp.noTools}</p>
          )}
        </section>

        <section aria-labelledby="mcp-resources-title">
          <h3 id="mcp-resources-title">{strings.mcp.resources}</h3>
          <label htmlFor="mcp-resource">{strings.mcp.resourceOrTemplate}</label>
          <select
            id="mcp-resource"
            value={state.selectedResourceKey ?? ""}
            onChange={(event) => state.selectResource(event.target.value)}
            disabled={state.resources === undefined}
          >
            <option value="">{strings.mcp.noResource}</option>
            {state.resources?.resources.map((item) => (
              <option key={item.uri} value={`resource:${item.uri}`}>
                {item.title ?? item.name}
              </option>
            ))}
            {state.resources?.templates.map((item) => (
              <option key={item.uriTemplate} value={`template:${item.uriTemplate}`}>
                {item.title ?? item.name}
                {strings.mcp.templateSuffix}
              </option>
            ))}
          </select>
          {selectedResource?.kind === "template"
            ? selectedResource.value.arguments.map(({ name }) => (
                <label key={name}>
                  {name}
                  {strings.mcp.requiredSuffix}
                  <input
                    required
                    value={state.resourceArguments[name] ?? ""}
                    onChange={(event) => state.setResourceArgument(name, event.target.value)}
                  />
                </label>
              ))
            : null}
          {selectedResource === undefined ? null : (
            <p>{selectedResource.value.description ?? strings.mcp.noDescription}</p>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => state.readResource()}
            disabled={selectedResource === undefined || state.busy !== undefined}
          >
            {strings.mcp.readPreview}
          </Button>
          {state.resourcePreview === undefined ? null : (
            <article className={styles.preview}>
              <h4>{strings.mcp.textPreview}</h4>
              <p>{strings.mcp.source(state.resourcePreview.snapshot.server.displayName)}</p>
              <p>
                {strings.mcp.mime(
                  state.resourcePreview.snapshot.mimeType,
                  yesNo(state.resourcePreview.snapshot.truncated),
                )}
              </p>
              <pre>{state.resourcePreview.snapshot.items.map(({ text }) => text).join("")}</pre>
              <Button size="sm" onClick={() => state.attachResource()}>
                {strings.mcp.attachToDraft}
              </Button>
            </article>
          )}
          <DraftItems
            title={strings.mcp.attachedResources}
            empty={strings.mcp.noResourcesAttached}
            items={state.attachments.map((item) => ({
              id: item.snapshotId,
              label: `${item.serverId}: ${item.uri}`,
              remove: () => state.detachResource(item.snapshotId),
            }))}
          />
        </section>

        <section aria-labelledby="mcp-prompts-title">
          <h3 id="mcp-prompts-title">{strings.mcp.prompts}</h3>
          <label htmlFor="mcp-prompt">{strings.mcp.prompt}</label>
          <select
            id="mcp-prompt"
            value={state.selectedPromptName ?? ""}
            onChange={(event) => state.selectPrompt(event.target.value)}
            disabled={state.prompts === undefined}
          >
            <option value="">{strings.mcp.noPrompt}</option>
            {state.prompts?.prompts.map((prompt) => (
              <option key={prompt.name} value={prompt.name}>
                {prompt.title ?? prompt.name}
              </option>
            ))}
          </select>
          {selectedPrompt?.arguments.map((argument) => (
            <label key={argument.name}>
              {argument.name}
              {argument.required ? strings.mcp.requiredSuffix : strings.mcp.optionalSuffix}
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
            {strings.mcp.previewPrompt}
          </Button>
          {state.promptPreview === undefined ? null : (
            <article className={styles.preview}>
              <h4>{strings.mcp.fullPromptPreview}</h4>
              <p>
                {strings.mcp.source(state.promptPreview.server.displayName)}{" "}
                {strings.mcp.promptContextNotice}
              </p>
              {state.promptPreview.messages.map((message) => (
                <div key={`${message.sourceRole}:${message.text}`}>
                  <strong>{strings.mcp.promptSource(message.sourceRole)}</strong>
                  <pre>{message.text}</pre>
                </div>
              ))}
              <div className={styles.actions}>
                <Button size="sm" onClick={() => state.confirmPrompt()}>
                  {strings.mcp.confirmForDraft}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => state.cancelPrompt()}>
                  {strings.mcp.cancelPreview}
                </Button>
              </div>
            </article>
          )}
          <DraftItems
            title={strings.mcp.confirmedPrompts}
            empty={strings.mcp.noPromptsConfirmed}
            items={state.confirmations.map((item) => ({
              id: item.previewId,
              label: `${item.value.serverId}: ${item.value.promptName}`,
              remove: () => state.detachPrompt(item.previewId),
            }))}
          />
        </section>
        <p
          className={styles.srOnly}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={strings.mcp.announcementLabel}
        >
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
                {strings.mcp.remove}
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
  return value ? strings.mcp.yes : strings.mcp.no;
}

function diagnosticReason(reason: string): string {
  const labels = {
    "forbidden-keyword": "Unsupported schema feature.",
    "unknown-keyword": "Unknown schema feature.",
    "invalid-reference": "Invalid schema reference.",
    "non-object-root": "Tool input schema must be an object.",
    "schema-invalid": "Tool schema could not be accepted.",
    "limit-exceeded": "Tool exceeded a safety limit.",
  } as const;
  return labels[reason as keyof typeof labels] ?? "Tool schema was not accepted.";
}

function diagnosticFailure(code: string): string {
  const labels = {
    "invalid-schema": "The Tool schema could not be accepted.",
    "limit-exceeded": "The Tool list exceeded a safety limit.",
    "malformed-message": "The Tool list was malformed.",
  } as const;
  return labels[code as keyof typeof labels] ?? "Tool discovery failed.";
}
