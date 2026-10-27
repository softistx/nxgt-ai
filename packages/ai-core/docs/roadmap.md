# Roadmap

A direction, not a commitment. See the [repository roadmap](../../../docs/roadmap.md) for the whole SDK.

## Now

- **`@nxgt/ai-core` 0.1.0** — the provider-neutral core of the SDK:
  - Messages and parts (text, thinking, tool calls and results), usage, and `AiError`.
  - `defineTool` and `jsonSchemaTool`: Zod input validation and JSON Schema generation; `executeTool`.
  - The model port (`ModelAdapter`, `ModelRequest`, `ModelEvent`), `generate` with abort, and the `AgentEvent` union with `agentEventSchema`.
  - `runAgent`: parallel tool calls, `maxSteps`, a token `budget`, abort, tool errors returned to the model, and `AgentObserver` hooks with a stable `runId`.
  - Proposed actions: `confirm: true` tools are proposed, then run or rejected later, with a TTL.
  - Opaque `redacted` thinking data kept for the next turn, and `estimateTokens`.

## Next

- **Exact token counts through the adapter** — let a `ModelAdapter` offer a count, so `budget` can use it instead of the estimate.

## Later

- **Persisting proposed actions** — a documented shape to store and reload a pending action across processes.

## Not planned

- **Provider-specific code in the core** — providers live in their own adapter packages.
- **Built-in tools** — the core defines how tools are written and run, not which ones exist.

## Shipped

Nothing yet. Releases are listed in `CHANGELOG.md`.
