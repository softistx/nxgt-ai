# @nxgt/ai-mcp

## 0.1.1

### Patch Changes

- Updated dependencies [[`62fac94`](https://github.com/softistx/nxgt-ai/commit/62fac94e52e4cc8a4c5dd5379b2968b5af3ff611)]:
  - @nxgt/ai-core@0.3.0

## 0.1.0

### Minor Changes

- [#79](https://github.com/softistx/nxgt-ai/pull/79) [`c870222`](https://github.com/softistx/nxgt-ai/commit/c87022294049fbd0337d425305e06a46cc87a232) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `@nxgt/ai-mcp/client`: `mcpTools({ transport, include?, prefix?, confirm?, maxResultChars? })` connects to an MCP server over stdio or Streamable HTTP and returns its tools as `@nxgt/ai-core` tools plus `close()`. Mutations (no `readOnlyHint`) are `confirm: true`, a failed call answers the model with a code only (`MCP_TOOL_FAILED`, `MCP_UNAVAILABLE`), and output is framed as untrusted data and cut to `maxResultChars`.

- [#79](https://github.com/softistx/nxgt-ai/pull/79) [`c870222`](https://github.com/softistx/nxgt-ai/commit/c87022294049fbd0337d425305e06a46cc87a232) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `@nxgt/ai-mcp/server`: `mcpServer({ tools, name, version, context?, allowConfirmTools? })` serves `@nxgt/ai-core` tools to MCP clients with `.stdio()`, `.fetch(request)` (stateless Streamable HTTP) and `.connect(transport)`. Input is validated with the tool's schema, the tool context is built per request, a failed call answers `isError` with a code only, and `confirm: true` tools are refused (`INVALID_OPTIONS`) unless `allowConfirmTools` is set.

### Patch Changes

- [#79](https://github.com/softistx/nxgt-ai/pull/79) [`c870222`](https://github.com/softistx/nxgt-ai/commit/c87022294049fbd0337d425305e06a46cc87a232) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Harden the MCP client. `tools/list` paging is bounded (a repeated cursor, more than 100 pages or 1000 tools throws `MCP_LIST_FAILED`); a tool description over 2048 characters or an input schema over 32 KiB throws `INVALID_TOOL_DEFINITION`; a bare server code (`{"code":"INVALID_TOOL_INPUT"}`) reaches the model as `serverCode`; a text block that repeats `structuredContent` is dropped; `confirm` overrides use own keys only; the setup codes are now `UNKNOWN_TOOL` and `INVALID_TOOL_DEFINITION`; the default `clientInfo` carries the package version; the SDK range is `~1.32.2`.

- [#79](https://github.com/softistx/nxgt-ai/pull/79) [`c870222`](https://github.com/softistx/nxgt-ai/commit/c87022294049fbd0337d425305e06a46cc87a232) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Harden `@nxgt/ai-mcp/server`: `fetch` answers anything but `POST` with `405` (`Allow: POST`), refuses JSON-RPC batches with `400`, caps the body at 4 MiB (`413`), answers invalid JSON with `400` (`-32700`), closes its per-request server, aborts the tool when the HTTP client disconnects, and takes an optional `timeoutMs` (answers `TOOL_TIMEOUT`). `stdio()` works when destructured. `INVALID_TOOL_OUTPUT` is documented.
