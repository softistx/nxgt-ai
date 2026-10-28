# Roadmap

A direction, not a commitment. See the [repository roadmap](https://github.com/softistx/nxgt-ai/blob/develop/docs/roadmap.md) for the whole SDK.

## Now

- **MCP client** — `@nxgt/ai-mcp/client`: use the tools of an MCP server over stdio or Streamable HTTP, with an allow-list, a name prefix, confirmation for mutations and code-only errors ([#20](https://github.com/softistx/nxgt-ai/issues/20)).

- **MCP server** — `@nxgt/ai-mcp/server`: serve your own tools to MCP clients over stdio or a `fetch` handler, with the tool context built per request, schema-validated input and code-only errors ([#21](https://github.com/softistx/nxgt-ai/issues/21)).

## Next

The package is private until its first release ([#22](https://github.com/softistx/nxgt-ai/issues/22)).

## Later

- **Resources and prompts** — read an MCP server's resources and prompt templates, not only its tools.
- **Telemetry spans per call** — a span for each MCP call, when the other tool packages emit them.

## Not planned

- **Running a server for you** — the client connects to a server you start or configure.
- **Forwarding a server's error text to the model** — errors reach the model as codes.

## Shipped

Nothing yet.
