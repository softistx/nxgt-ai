# Roadmap

A direction, not a commitment. See the [repository roadmap](../../../docs/roadmap.md) for the whole SDK.

## Now

Nothing in progress.

## Next

- **Exact token counts through the adapter** — let a `ModelAdapter` offer a count, so `budget` can use it instead of the estimate.

## Later

- **Persisting proposed actions** — a documented shape to store and reload a pending action across processes.

## Not planned

- **Provider-specific code in the core** — providers live in their own adapter packages.
- **Built-in tools** — the core defines how tools are written and run, not which ones exist.

## Shipped

- **`@nxgt/ai-core` 0.2.0** — Proposed actions, abort and thinking:
  - `summarize(input)` on `defineTool` and `jsonSchemaTool` fills a proposed action's summary for the confirmation UI; `actionOutcomeMessage` tells the model how an action ended (confirmed, rejected, failed or expired).
  - After an abort the run no longer waits for a tool that ignores its signal: the tool answers `ABORTED` at once.
  - `AgentObserver.onToolCall` receives `proposed`, true when the call became a pending proposed action.
  - Thinking `mode: 'adaptive'`, `effort` and `display`, and the `INVALID_REQUEST` error code for contradictory options.

- **`@nxgt/ai-core` 0.1.0** — The provider-neutral core of the SDK:
  - Messages and parts (text, thinking, tool calls and results), usage, and `AiError`.
  - `defineTool` and `jsonSchemaTool`: Zod input validation and JSON Schema generation; `executeTool`.
  - The model port (`ModelAdapter`, `ModelRequest`, `ModelEvent`), `generate` with abort, and the `AgentEvent` union with `agentEventSchema`.
  - `runAgent`: parallel tool calls, `maxSteps`, a token `budget`, abort, tool errors returned to the model, and `AgentObserver` hooks with a stable `runId`.
  - Proposed actions: `confirm: true` tools are proposed, then run or rejected later, with a TTL.
  - Opaque `redacted` thinking data kept for the next turn, and `estimateTokens`.

Earlier releases are listed in `CHANGELOG.md`.
