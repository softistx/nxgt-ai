---
'@nxgt/ai-mcp': patch
---

Harden `@nxgt/ai-mcp/server`: `fetch` answers anything but `POST` with `405` (`Allow: POST`), refuses JSON-RPC batches with `400`, caps the body at 4 MiB (`413`), answers invalid JSON with `400` (`-32700`), closes its per-request server, aborts the tool when the HTTP client disconnects, and takes an optional `timeoutMs` (answers `TOOL_TIMEOUT`). `stdio()` works when destructured. `INVALID_TOOL_OUTPUT` is documented.
