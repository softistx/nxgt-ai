# MCP server

`mcpServer` serves `@nxgt/ai-core` tools to any [Model Context Protocol](https://modelcontextprotocol.io)
client (an IDE, another agent, the [client](client.md) of this package) over
stdio or Streamable HTTP.

- [Serve](#serve)
- [Context per request](#context-per-request)
- [Input and errors](#input-and-errors)
- [Confirm tools](#confirm-tools)
- [What clients read](#what-clients-read)
- [Abort and timeout](#abort-and-timeout)
- [Over fetch: methods and batches](#over-fetch-methods-and-batches)
- [Test your server](#test-your-server)

## Serve

```ts
import { defineTool } from '@nxgt/ai-core';
import { mcpServer } from '@nxgt/ai-mcp/server';
import { z } from 'zod';

const search = defineTool({
	name: 'search_docs',
	description: 'Searches the documentation',
	input: z.object({ query: z.string().describe('Words to look for') }),
	execute: ({ query }, { signal }) => searchDocs(query, { signal }),
});

const server = mcpServer({ tools: [search], name: 'docs', version: '1.0.0' });

// Local: a client spawns your script and talks over stdin and stdout.
const running = await server.stdio();
// await running.close() stops serving.

// Remote: Streamable HTTP, stateless, answered as JSON.
Bun.serve({ port: 3000, fetch: (request) => server.fetch(request) });
```

In a BFF, mount `server.fetch(request)` on one route (`/mcp`) and authenticate
before calling it: the handler does not authenticate. `server.connect(transport)`
serves one client over an SDK `Transport` you built (tests, a custom channel).
Over stdio, never write to stdout yourself: it carries the protocol.

## Context per request

`context` builds `ToolContext.context`, the value every tool receives beside
its input and the abort signal, exactly as in `runAgent`.

```ts
const server = mcpServer({
	tools,
	name: 'docs',
	version: '1.0.0',
	context: async ({ request }) => ({
		viewer: await viewerFromToken(request?.headers.get('authorization')),
	}),
});
```

- Over `fetch`, it runs once per HTTP request, at the first tool call of that
  request, with `{ request }`. Two requests with two tokens get two contexts.
- Over `stdio` and `connect`, it runs before each call with `{}`: there is no
  request.
- A throw answers the call with `TOOL_FAILED`.

## Input and errors

The tool's schema validates the arguments before `execute` runs, as for an
agent. A failure of any kind is an MCP result with `isError: true` and a text
that is a code and nothing else:

| Text                             | Cause                                                     |
| -------------------------------- | --------------------------------------------------------- |
| `{"code":"INVALID_TOOL_INPUT"}`  | the arguments do not match the schema                     |
| `{"code":"UNKNOWN_TOOL"}`        | the name is not served                                    |
| `{"code":"TOOL_FAILED"}`         | the tool or `context` threw                               |
| `{"code":"TOOL_TIMEOUT"}`        | the tool ran past `timeoutMs`                             |
| `{"code":"INVALID_TOOL_OUTPUT"}` | the tool has an `output` schema and its result breaks it  |
| `{"code":"<code>"}`              | the tool threw an `AiError`: its code (`RATE_LIMITED`, …) |

No message, stack or cause is sent, so a database error or a path never
reaches the client. Log in your tool.

## Confirm tools

A tool with `confirm: true` is a mutation that, in `runAgent`, waits for a
human. MCP has no such step. `mcpServer` therefore **throws `INVALID_OPTIONS`**
when `tools` holds one:

```ts
mcpServer({ tools: all.filter((tool) => !tool.confirm), name, version });
```

A tool that is not `confirm` is advertised `readOnlyHint: true`, which other clients may treat as a promise: mark every mutation `confirm`. A tool that throws an `AiError` chooses a public code, so throw only codes you accept to show.

Pass `allowConfirmTools: true` only when the client confirms by itself (it asks
its user) or the mutation is safe to run unattended. Note that the client of
this package decides `confirm` from `readOnlyHint`, see below.

## What clients read

| MCP field           | From                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `name`              | `tool.name`                                                                               |
| `description`       | `tool.description`                                                                        |
| `inputSchema`       | `tool.inputSchema` (JSON Schema, type `object`), unchanged                                |
| `annotations`       | `{ readOnlyHint: true }` for a tool that is not `confirm`; none for a served confirm tool |
| result `content`    | one text block: the output as is if a string, else its JSON                               |
| `structuredContent` | the output when it is a plain object                                                      |

This is what `mcpTools` reads, so a tool served here and used there keeps its
name, description and schema, and a served confirm tool comes back
`confirm: true`.

## Abort and timeout

The signal the tool receives is aborted when:

- the client cancels the request (all transports);
- the connection closes (stdio and `connect`);
- over `fetch`, the HTTP client disconnects: the signal combines the MCP
  request's with the `Request`'s own, because in stateless JSON mode the MCP
  one is never tied to the HTTP connection;
- `timeoutMs` passes.

Pass it to `fetch` and database calls.

```ts
const server = mcpServer({
	tools,
	name: 'docs',
	version: '1.0.0',
	timeoutMs: 10_000,
});
```

`timeoutMs` (default: no limit) aborts the tool's signal and answers
`{"code":"TOOL_TIMEOUT"}` at once, even if the tool ignores its signal (it then
keeps running in the background, so honour the signal). It must be a positive
number, or `mcpServer` throws `INVALID_OPTIONS`.

## Over fetch: methods and batches

`fetch` serves `POST` only. Any other method (`GET` opens an SSE stream in the
SDK, `DELETE` ends a session; there is no session here) answers `405` with
`Allow: POST`, before anything is built.

A JSON-RPC batch (a JSON array body) answers `400` with a JSON-RPC error
(`-32600`): MCP 2025-06-18 dropped batching. Send one message per request.

## Test your server

Link a client to the server in memory. `InMemoryTransport` comes from the MCP SDK (`@modelcontextprotocol/sdk`, installed with this package), not from `@nxgt/ai-mcp`:

```ts
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mcpTools } from '@nxgt/ai-mcp/client';

const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const { tools, close } = await mcpTools({
	transport: { type: 'transport', transport: clientSide },
});
```
