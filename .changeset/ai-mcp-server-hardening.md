---
'@nxgt/ai-mcp': patch
---

Harden `@nxgt/ai-mcp/server`: `fetch` answers anything but `POST` with `405` (`Allow: POST`) and refuses JSON-RPC batches with `400`, closes its per-request server, aborts the tool when the HTTP client disconnects, and takes an optional `timeoutMs` (answers `TOOL_TIMEOUT`). `stdio()` works when destructured. `INVALID_TOOL_OUTPUT` is documented.
