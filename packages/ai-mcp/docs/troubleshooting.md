# Troubleshooting

- [`McpClientError` INVALID_OPTIONS](#mcpclienterror-invalid_options)
- [`McpClientError` MCP_UNAVAILABLE](#mcpclienterror-mcp_unavailable)
- [`McpClientError` MCP_LIST_FAILED](#mcpclienterror-mcp_list_failed)
- [`McpClientError` TOOL_NOT_FOUND](#mcpclienterror-tool_not_found)
- [`McpClientError` INVALID_TOOL](#mcpclienterror-invalid_tool)
- [`McpClientError` DUPLICATE_TOOL](#mcpclienterror-duplicate_tool)
- [The model sees `MCP_TOOL_FAILED`](#the-model-sees-mcp_tool_failed)
- [The model sees `MCP_UNAVAILABLE`](#the-model-sees-mcp_unavailable)
- [The model sees `{ truncated: true, preview }`](#the-model-sees--truncated-true-preview-)
- [A mutation never runs](#a-mutation-never-runs)
- [The stdio server process stays up](#the-stdio-server-process-stays-up)
- [An abort does not stop the server's work](#an-abort-does-not-stop-the-servers-work)

## `McpClientError` INVALID_OPTIONS

**When:** `mcpTools` throws `maxResultChars must be an integer of at least 100…` or `transport.type must be…`.
**Why:** `maxResultChars` is below 100 (a truncation marker needs room) or not an integer, or `transport.type` is not `stdio`, `http` or `transport`.
**Fix:** pass a valid value.

```ts
await mcpTools({
	transport: { type: 'stdio', command: 'my-server' },
	maxResultChars: 8000,
});
```

## `McpClientError` MCP_UNAVAILABLE

**When:** `mcpTools` throws `Could not connect to the MCP server.`
**Why:** the command did not start, the child exited before the handshake, the URL refused the connection or answered an HTTP error (a missing or wrong `Authorization` header gives a 401), the `http.url` is not a valid URL,, or `signal` aborted.
**Fix:** read `error.cause` in your logs. Check the command is on `PATH`, the URL is the server's MCP endpoint and the headers are right.

```ts
try {
	await mcpTools({ transport });
} catch (error) {
	if (error instanceof McpClientError && error.code === 'MCP_UNAVAILABLE') {
		console.error(error.cause);
	}
}
```

## `McpClientError` MCP_LIST_FAILED

**When:** `mcpTools` throws `The MCP server did not list its tools.`
**Why:** the server connected but failed `tools/list`, or it has no `tools` capability.
**Fix:** read `error.cause`. Use a server that serves tools; this package uses tools only.

## `McpClientError` TOOL_NOT_FOUND

**When:** `mcpTools` throws `The MCP server lists no tool named "…"`.
**Why:** a name in `include` is not among the server's tools (a typo, or the server changed). `error.tool` names it.
**Fix:** use the server's own name, not the prefixed one.

```ts
await mcpTools({ transport, include: ['search_docs'], prefix: 'docs_' });
```

## `McpClientError` INVALID_TOOL

**When:** `mcpTools` throws `The tool name "…" is not 1 to 64 letters, digits…` or `…has no usable object input schema.`
**Why:** a tool, once `prefix` is added, has a name the model providers refuse (a dot, a space, over 64 characters), or its input schema is not a JSON Schema of type `object`. `error.tool` names it. Only the tools you expose are checked.
**Fix:** allow-list the tools you want with `include`, or shorten `prefix`.

## `McpClientError` DUPLICATE_TOOL

**When:** `mcpTools` throws `Two tools are named "…".`
**Why:** the server lists the same name twice.
**Fix:** none on your side besides `include`; report it to the server's author.

## The model sees `MCP_TOOL_FAILED`

**When:** a call answers `TOOL_FAILED` with `The MCP tool failed: {"code":"MCP_TOOL_FAILED"}`.
**Why:** the server answered with `isError: true`, or with a protocol error (unknown tool, invalid arguments). The message is never shown to the model or the client, on purpose.
**Fix:** read `error.cause` where you run the tool (a protocol error carries it), or the server's logs. An `isError` result keeps no cause: its text is dropped.

## The model sees `MCP_UNAVAILABLE`

**When:** a call answers `TOOL_FAILED` with `{"code":"MCP_UNAVAILABLE"}`.
**Why:** the connection is gone (the stdio child exited, the HTTP server went away, a request timed out) or `close()` was already called.
**Fix:** call `mcpTools` again for a new connection; keep `close()` for the end of the run.

## The model sees `{ truncated: true, preview }`

**When:** a result is a truncation marker.
**Why:** the serialised output is longer than `maxResultChars` (default 20000).
**Fix:** raise `maxResultChars`, or make the tool return less; the marker's note asks the model to narrow its arguments.

## A mutation never runs

**When:** a tool is proposed but nothing happens.
**Why:** a tool without `readOnlyHint: true` is `confirm: true`: `runAgent` proposes it and waits for `runConfirmedAction`.
**Fix:** confirm it, or set `confirm: { tool_name: false }` for a tool you know is safe.

## The stdio server process stays up

**When:** your program does not exit, or a child process is left running.
**Why:** `close()` was not called, so the child's pipes stay open.
**Fix:** call `close()` in a `finally`.

```ts
const { tools, close } = await mcpTools({ transport });
try {
	await work(tools);
} finally {
	await close();
}
```

## An abort does not stop the server's work

**When:** a run is aborted, but the server keeps working.
**Why:** an abort sends a cancellation to the server and stops waiting; whether the server obeys is its choice.
**Fix:** none from the client; make the server honour the cancellation.
