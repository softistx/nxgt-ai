# Roadmap

A direction, not a commitment: entries carry no dates, and the version an entry shipped in is the only number on this page.

## Now

- **Phase 1b: memory, GraphQL tools and HTTP glue** — you get:
  - `@nxgt/ai-memory`: a conversation store scoped by owner on every call, with in-process, MongoDB and Redis stores, a store contract suite for your own implementations, and compaction that trims old tool results first, then keeps a rolling summary without splitting a tool call from its result.
  - `@nxgt/ai-graphql`: expose a GraphQL schema as agent tools from an allow-list of operations, executed in-process, with forbidden fields rejected when the tools are built and every mutation requiring confirmation. A codegen plugin writes the operations manifest.
  - `@nxgt/ai-alxia`: a request middleware (abort signal, language, observers) and a server-sent-events reply for agent events.

## Next

Nothing queued beyond phase 1b.

## Later

- **Phase 1c: MCP client and server** (branch `feat/ai-mcp`) — `@nxgt/ai-mcp`: use tools from an MCP server over stdio or HTTP, and serve your own tools as an MCP server over stdio or a fetch handler.

## Not planned

- **Other model providers (OpenAI, Gemini)** — not for now: the model port is small so a provider can be written outside this repository, and the first two cover hosted and local use.
- **A hosted service** — this is a library; running and billing an agent is the application's job.
- **A vector store or retrieval-augmented generation** — out of scope for the SDK; bring your own retrieval as a tool.
- **Network tools such as web fetch** — agents get only the tools you give them; shipping a fetch tool widens the prompt-injection surface.

## Shipped

- **Phase 1a: agent core, providers, testing and telemetry** — 0.1.0 of all five packages. You get:
  - `@nxgt/ai-core`: typed messages and parts (text, thinking, tool calls and results, proposed actions), usage with cache read/write counts, zod-typed tools (`defineTool`, `jsonSchemaTool`), a model port, and `runAgent` with parallel tool calls, a step limit, a budget, abort and tool errors surfaced as events. Mutating tools can return a proposed action that is only executed once confirmed.
  - `@nxgt/ai-anthropic`: streaming, thinking blocks, automatic prompt-cache breakpoints, token counting, and retries on 429/529 that honour `retry-after`.
  - `@nxgt/ai-ollama`: the same model port over a local Ollama server.
  - `@nxgt/ai-testing`: a scripted `fakeModel` with deterministic chunking, recorded requests and injected errors, to test agents without a network.
  - `@nxgt/ai-telemetry`: an observer that emits `ai.agent.run`, `ai.model.call` and `ai.tool.call` spans with `gen_ai.*` attributes; message content is not recorded unless asked.

Earlier releases are listed in each package's `CHANGELOG.md`.
