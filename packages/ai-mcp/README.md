# @nxgt/ai-mcp

The tools of a [Model Context Protocol](https://modelcontextprotocol.io) server
as [`@nxgt/ai-core`](https://www.npmjs.com/package/@nxgt/ai-core) tools, over
stdio or Streamable HTTP. `@modelcontextprotocol/sdk` is its only runtime
dependency. Peers: `@nxgt/ai-core`, `zod` (the SDK needs it).

```ts
import { runAgent } from '@nxgt/ai-core';
import { mcpTools } from '@nxgt/ai-mcp/client';

const { tools, close } = await mcpTools({
	// A local server over stdio ...
	transport: { type: 'stdio', command: 'bunx', args: ['some-mcp-server'] },
	// ... or a remote one:
	// transport: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { authorization: `Bearer ${token}` } },
	include: ['search_docs', 'create_ticket'], // the allow-list, by the server's names
	prefix: 'docs_', // the model sees docs_search_docs
	maxResultChars: 8000,
});

try {
	const run = runAgent({ model, messages, tools });
	for await (const event of run) console.log(event.type);
} finally {
	await close();
}
```

`search_docs` runs directly if the server marks it `readOnlyHint`. A tool
without that hint (`create_ticket`) is `confirm: true`: the loop proposes it and
runs it only after `runConfirmedAction`.

## API

| Export                                     | What it is                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `mcpTools(options)`                        | Connects, lists, returns `{ tools, close }`; throws `McpClientError`                                                                 |
| `McpToolsOptions`                          | `{ transport, include?, prefix?, confirm?, maxResultChars?, clientInfo?, signal? }`                                                  |
| `McpStdioTransport`, `McpHttpTransport`    | `{ type: 'stdio', command, args?, env?, cwd? }`, `{ type: 'http', url, headers? }`                                                   |
| `McpCustomTransport`                       | `{ type: 'transport', transport }`: an SDK `Transport` you built (in memory, tests)                                                  |
| `McpClientError`, `MCP_CLIENT_ERROR_CODES` | `INVALID_OPTIONS`, `MCP_UNAVAILABLE`, `MCP_LIST_FAILED`, `TOOL_NOT_FOUND`, `INVALID_TOOL`, `DUPLICATE_TOOL`; carries `tool`, `cause` |
| `McpToolOutput`, `McpContent`              | What a call returns: `{ source: 'mcp', notice, content, structuredContent? }`                                                        |
| `TruncatedMcpOutput`                       | `{ truncated: true, originalChars, preview, note }`, when the result exceeds `maxResultChars`                                        |
| `DEFAULT_MAX_RESULT_CHARS`                 | 20000                                                                                                                                |

## Traps

- **The model never reads a server's error text.** A call that fails answers `TOOL_FAILED` with `MCP_TOOL_FAILED` (the server reported an error) or `MCP_UNAVAILABLE` (the connection is gone or closed) in the message. The server's own error is in the error's `cause`, for your logs only.
- **Tool output is untrusted data.** It is returned under `source: 'mcp'` with a `notice` saying so. That lowers the risk of prompt injection; it does not remove it. Allow-list the tools (`include`) and keep mutations behind their confirmation.
- A tool is `confirm: true` unless the server's annotations say `readOnlyHint: true`. Annotations come from the server and are hints, not guarantees: pin the decision with `confirm: { tool_name: true }` for a server you do not control.
- Without `include`, every tool the server lists is exposed, and one whose name (with `prefix`) is not 1 to 64 letters, digits, `_` or `-` makes `mcpTools` throw `INVALID_TOOL`. Use `include`.
- The tool input is not validated here: the model's arguments go to the server, which validates them against the schema it published.
- Images, audio and binary resources are not forwarded; the model reads `{ type: 'omitted', kind }` in their place.
- `maxResultChars` is at least 100. A longer result becomes `{ truncated: true, originalChars, preview, note }`.
- An abort cancels the request to the server; whether the server stops its work is up to it.
- `close()` stops a stdio child process. Call it when the run is done, or the process stays up.
- Only tools are used: resources and prompts are not (see the roadmap).

## Install

```sh
bun add @nxgt/ai-mcp @nxgt/ai-core zod
```

Imports carry no file extension. Requires `"moduleResolution": "bundler"` in your `tsconfig.json`.
See the [guide](docs/guide/client.md).

## Documentation

See [docs/](docs/README.md): the guide, troubleshooting and the roadmap.
