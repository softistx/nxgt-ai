---
'@nxgt/ai-mcp': minor
---

Add `@nxgt/ai-mcp/server`: `mcpServer({ tools, name, version, context?, allowConfirmTools? })` serves `@nxgt/ai-core` tools to MCP clients with `.stdio()`, `.fetch(request)` (stateless Streamable HTTP) and `.connect(transport)`. Input is validated with the tool's schema, the tool context is built per request, a failed call answers `isError` with a code only, and `confirm: true` tools are refused (`INVALID_OPTIONS`) unless `allowConfirmTools` is set.
