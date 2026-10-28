---
'@nxgt/ai-mcp': minor
---

Add `@nxgt/ai-mcp/client`: `mcpTools({ transport, include?, prefix?, confirm?, maxResultChars? })` connects to an MCP server over stdio or Streamable HTTP and returns its tools as `@nxgt/ai-core` tools plus `close()`. Mutations (no `readOnlyHint`) are `confirm: true`, a failed call answers the model with a code only (`MCP_TOOL_FAILED`, `MCP_UNAVAILABLE`), and output is framed as untrusted data and cut to `maxResultChars`.
