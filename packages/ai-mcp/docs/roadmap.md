# Roadmap

A direction, not a commitment. See the [repository roadmap](https://github.com/softistx/nxgt-ai/blob/develop/docs/roadmap.md) for the whole SDK.

## Now

Nothing in progress.

## Next

Nothing yet.

## Later

- **Resources and prompts** — read an MCP server's resources and prompt templates, not only its tools.
- **Telemetry spans per call** — a span for each MCP call, when the other tool packages emit them.

## Not planned

- **Running a server for you** — the client connects to a server you start or configure.
- **Forwarding a server's error text to the model** — errors reach the model as codes.

## Shipped

- **`@nxgt/ai-mcp` 0.1.0** — MCP for `@nxgt/ai-core` agents:
  - `@nxgt/ai-mcp/client`: `mcpTools` returns the tools of an MCP server (stdio or Streamable HTTP) as agent tools, with an allow-list, a name prefix, confirmation for mutations, output framed as untrusted data and code-only errors.
  - `@nxgt/ai-mcp/server`: `mcpServer` serves your own tools over stdio or a `fetch` handler, with the tool context built per request, schema-validated input and code-only errors.

Releases are listed in `CHANGELOG.md`.
