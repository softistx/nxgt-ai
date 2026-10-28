---
'@nxgt/ai-mcp': patch
---

Harden the MCP client. `tools/list` paging is bounded (a repeated cursor, more than 100 pages or 1000 tools throws `MCP_LIST_FAILED`); a tool description over 2048 characters or an input schema over 32 KiB throws `INVALID_TOOL_DEFINITION`; a bare server code (`{"code":"INVALID_TOOL_INPUT"}`) reaches the model as `serverCode`; a text block that repeats `structuredContent` is dropped; `confirm` overrides use own keys only; the setup codes are now `UNKNOWN_TOOL` and `INVALID_TOOL_DEFINITION`; the default `clientInfo` carries the package version; the SDK range is `~1.32.2`.
