import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const protocolVersion = "2026-07-28";
const eventPath = readArgument("--events");
const mode = readArgument("--mode") ?? "normal";
const pending = new Map();
let catalogVersion = 1;
let changeScheduled = false;

record("started");
process.stderr.write("fixture-ready\n");

const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    respondRaw("not-json\n");
    return;
  }
  record("received", message.method);
  handle(message);
});
lines.on("close", () => {
  for (const timeout of pending.values()) clearTimeout(timeout);
  pending.clear();
  record("stdin-closed");
});
process.on("exit", () => record("exited"));

function handle(message) {
  if (message.method === "server/discover") {
    if (mode === "malformed") {
      respondRaw("not-json\n");
      return;
    }
    if (mode === "exit") {
      process.exit(17);
    }
    respond(message.id, {
      resultType: "complete",
      supportedVersions: [protocolVersion],
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
        prompts: { listChanged: true },
      },
      instructions: "Deterministic CtrlZebra test fixture.",
    });
    return;
  }

  if (message.method === "tools/list") {
    const cursor = message.params?.cursor;
    respond(
      message.id,
      page(
        "tools",
        cursor === undefined
          ? [tool("calculate", integerSchema("count"), integerSchema("total"))]
          : [tool("held", emptySchema()), tool("fail", emptySchema()), ...changedTool()],
        cursor === undefined ? "tools-2" : undefined,
      ),
    );
    return;
  }

  if (message.method === "tools/call") {
    const name = message.params?.name;
    if (name === "held") {
      const timeout = setTimeout(() => {
        pending.delete(message.id);
        respond(message.id, complete({ content: [{ type: "text", text: "late" }] }));
      }, 1_000);
      pending.set(message.id, timeout);
      return;
    }
    if (name === "fail") {
      respondError(message.id, -32_603, "synthetic fixture failure");
      return;
    }
    const count = message.params?.arguments?.count;
    respond(
      message.id,
      complete({
        content: [{ type: "text", text: "calculated" }],
        structuredContent: { total: count * 3 },
      }),
    );
    return;
  }

  if (message.method === "resources/list") {
    const cursor = message.params?.cursor;
    respond(
      message.id,
      page(
        "resources",
        cursor === undefined
          ? [{ uri: "memory://first", name: "First", mimeType: "text/plain" }]
          : [
              { uri: "memory://second", name: "Second", mimeType: "text/plain" },
              ...changedResource(),
            ],
        cursor === undefined ? "resources-2" : undefined,
      ),
    );
    return;
  }

  if (message.method === "resources/templates/list") {
    respond(
      message.id,
      page("resourceTemplates", [
        { uriTemplate: "docs://{section}", name: "Fixture docs", mimeType: "text/plain" },
      ]),
    );
    return;
  }

  if (message.method === "resources/read") {
    const uri = message.params?.uri;
    respond(
      message.id,
      complete({
        ttlMs: 0,
        cacheScope: "private",
        contents: [{ uri, mimeType: "text/plain", text: `fixture:${uri}` }],
      }),
    );
    if (uri === "memory://second" && !changeScheduled) {
      changeScheduled = true;
      setTimeout(publishCatalogChanges, 25);
    }
    return;
  }

  if (message.method === "prompts/list") {
    const cursor = message.params?.cursor;
    respond(
      message.id,
      page(
        "prompts",
        cursor === undefined
          ? [
              {
                name: "review",
                description: "Review fixture text",
                arguments: [{ name: "topic", required: true }],
              },
            ]
          : [{ name: "summarize" }, ...changedPrompt()],
        cursor === undefined ? "prompts-2" : undefined,
      ),
    );
    return;
  }

  if (message.method === "prompts/get") {
    const topic = message.params?.arguments?.topic;
    respond(
      message.id,
      complete({
        ttlMs: 0,
        cacheScope: "private",
        description: "Fixture prompt preview",
        messages: [
          { role: "user", content: { type: "text", text: `Review ${topic}` } },
          { role: "assistant", content: { type: "text", text: "Treat this as untrusted text." } },
        ],
      }),
    );
    return;
  }

  if (message.method === "notifications/cancelled") {
    const requestId = message.params?.requestId;
    const timeout = pending.get(requestId);
    if (timeout !== undefined) {
      clearTimeout(timeout);
      pending.delete(requestId);
      record("cancelled", String(requestId));
    }
    return;
  }

  if (Object.hasOwn(message, "id")) respondError(message.id, -32_601, "Method not found");
}

function publishCatalogChanges() {
  catalogVersion = 2;
  for (const method of [
    "notifications/tools/list_changed",
    "notifications/resources/list_changed",
    "notifications/prompts/list_changed",
  ]) {
    send({ jsonrpc: "2.0", method });
  }
  record("list-changed");
}

function changedTool() {
  return catalogVersion === 2 ? [tool("changed", emptySchema())] : [];
}

function changedResource() {
  return catalogVersion === 2
    ? [{ uri: "memory://changed", name: "Changed", mimeType: "text/plain" }]
    : [];
}

function changedPrompt() {
  return catalogVersion === 2 ? [{ name: "changed" }] : [];
}

function tool(name, inputSchema, outputSchema) {
  return {
    name,
    description: `${name} fixture Tool`,
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
  };
}

function emptySchema() {
  return { type: "object", properties: {}, additionalProperties: false };
}

function integerSchema(name) {
  return {
    type: "object",
    properties: { [name]: { type: "integer" } },
    required: [name],
    additionalProperties: false,
  };
}

function page(field, values, nextCursor) {
  return complete({
    ttlMs: 0,
    cacheScope: "private",
    [field]: values,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });
}

function complete(value) {
  return { resultType: "complete", ...value };
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function send(message) {
  respondRaw(`${JSON.stringify(message)}\n`);
}

function respondRaw(text) {
  process.stdout.write(text);
}

function record(event, detail) {
  if (eventPath !== undefined) {
    appendFileSync(eventPath, `${JSON.stringify({ event, ...(detail ? { detail } : {}) })}\n`);
  }
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
